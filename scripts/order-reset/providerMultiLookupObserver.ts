import { isStripeCheckoutSessionId } from "../../packages/crm-api/convex/helpers/checkoutSnapshot";
import {
	observeProviderMatches,
	type ProviderConfiguration,
	productionProviderModeIsSafe,
} from "./providerInvestigation";

const MAX_TARGETS = 50;
const OBSERVATIONS = ["all_observed", "some_observed", "none_observed", "inconclusive"] as const;

type ProviderMultiLookupObservation = (typeof OBSERVATIONS)[number];

export type ProviderMultiLookupObserverTargets =
	| { outcome: "ready"; externalIds: string[] }
	| { outcome: "source_conflict" | "target_conflict" | "live_effect_conflict" };

export type ProviderMultiLookupObserverResult =
	| `provider_multi_lookup_observer:${ProviderMultiLookupObservation}`
	| "provider_multi_lookup_observer:source_conflict"
	| "provider_multi_lookup_observer:target_conflict"
	| "provider_multi_lookup_observer:live_effect_conflict"
	| "provider_multi_lookup_observer:configuration_error"
	| "provider_multi_lookup_observer:operation_unavailable";

export const PROVIDER_MULTI_LOOKUP_OBSERVER_FUNCTION =
	"orderReset:providerMultiLookupEligibleTargets" as const;

export function providerMultiLookupObserverCliArguments(deployment: string) {
	return [
		"run",
		PROVIDER_MULTI_LOOKUP_OBSERVER_FUNCTION,
		"{}",
		"--deployment",
		deployment,
		"--typecheck",
		"disable",
		"--codegen",
		"disable",
	] as const;
}

export function providerMultiLookupObserverChildEnvironment(
	environment: Record<string, string | undefined>,
) {
	return {
		HOME: environment.HOME,
		PATH: environment.PATH,
		XDG_CONFIG_HOME: environment.XDG_CONFIG_HOME,
		XDG_CACHE_HOME: environment.XDG_CACHE_HOME,
		NO_COLOR: "1",
	};
}

interface ProviderMultiLookupObserverExecutionOptions {
	cwd: string;
	timeout: number;
	maxBuffer: number;
	encoding: "utf8";
	env: Record<string, string | undefined>;
}

export async function readProviderMultiLookupObserverTargets(dependencies: {
	execute: (
		file: string,
		args: string[],
		options: ProviderMultiLookupObserverExecutionOptions,
	) => Promise<{ stdout: string }>;
	convexBinary: string;
	crmDirectory: string;
	deployment: string;
	environment: Record<string, string | undefined>;
}) {
	const { stdout } = await dependencies.execute(
		dependencies.convexBinary,
		[...providerMultiLookupObserverCliArguments(dependencies.deployment)],
		{
			cwd: dependencies.crmDirectory,
			timeout: 30_000,
			maxBuffer: 16 * 1024,
			encoding: "utf8",
			env: providerMultiLookupObserverChildEnvironment(dependencies.environment),
		},
	);
	return stdout.trim();
}

export function providerMultiLookupObserverConfiguration(
	environment: Record<string, string | undefined>,
	operationId: string,
	expectedConvexUrl: string,
): ProviderConfiguration | null {
	const storeId = environment.LUMAPRINTS_STORE_ID;
	if (
		environment.ORDER_RESET_PROVIDER_MULTI_LOOKUP_OBSERVER_ID !== operationId ||
		environment.ORDER_PRODUCERS_STATE !== "closed" ||
		environment.PUBLIC_CONVEX_URL !== expectedConvexUrl ||
		!productionProviderModeIsSafe(environment.LUMAPRINTS_USE_SANDBOX) ||
		!environment.LUMAPRINTS_API_KEY ||
		!environment.LUMAPRINTS_API_SECRET ||
		!storeId ||
		!/^\d+$/.test(storeId)
	)
		return null;
	const numericStoreId = Number(storeId);
	if (!Number.isSafeInteger(numericStoreId) || numericStoreId <= 0) return null;
	return {
		apiKey: environment.LUMAPRINTS_API_KEY,
		apiSecret: environment.LUMAPRINTS_API_SECRET,
		storeId: numericStoreId,
		baseUrl: "https://us.api.lumaprints.com",
	};
}

function object(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function parseProviderMultiLookupObserverTargets(
	value: string,
): ProviderMultiLookupObserverTargets {
	let parsed: unknown;
	try {
		parsed = JSON.parse(value) as unknown;
	} catch {
		throw new Error("invalid");
	}
	if (!object(parsed)) throw new Error("invalid");
	const externalIds = parsed.externalIds;
	if (
		parsed.outcome === "ready" &&
		Object.keys(parsed).length === 2 &&
		Array.isArray(externalIds) &&
		externalIds.length >= 2 &&
		externalIds.length <= MAX_TARGETS &&
		externalIds.every(isStripeCheckoutSessionId) &&
		externalIds.every((externalId, index) => index === 0 || externalIds[index - 1] < externalId)
	)
		return { outcome: "ready", externalIds: [...externalIds] };
	if (
		(parsed.outcome === "source_conflict" ||
			parsed.outcome === "target_conflict" ||
			parsed.outcome === "live_effect_conflict") &&
		Object.keys(parsed).length === 1
	)
		return { outcome: parsed.outcome };
	throw new Error("invalid");
}

function normalizedObservation(value: unknown): value is ProviderMultiLookupObservation {
	return typeof value === "string" && (OBSERVATIONS as readonly string[]).includes(value);
}

export async function runProviderMultiLookupObserver(dependencies: {
	claimAttempt: () => Promise<boolean>;
	readTargets: () => Promise<string>;
	environment: Record<string, string | undefined>;
	operationId: string;
	expectedConvexUrl: string;
	observeMatches?: typeof observeProviderMatches;
}): Promise<ProviderMultiLookupObserverResult> {
	try {
		if (!(await dependencies.claimAttempt())) {
			return "provider_multi_lookup_observer:operation_unavailable";
		}
	} catch {
		return "provider_multi_lookup_observer:operation_unavailable";
	}
	const configuration = providerMultiLookupObserverConfiguration(
		dependencies.environment,
		dependencies.operationId,
		dependencies.expectedConvexUrl,
	);
	if (configuration === null) return "provider_multi_lookup_observer:configuration_error";

	let targets: ProviderMultiLookupObserverTargets;
	try {
		targets = parseProviderMultiLookupObserverTargets(await dependencies.readTargets());
	} catch {
		return "provider_multi_lookup_observer:configuration_error";
	}
	if (targets.outcome !== "ready") return `provider_multi_lookup_observer:${targets.outcome}`;

	let observation: ProviderMultiLookupObservation = "inconclusive";
	try {
		const observed = await (dependencies.observeMatches ?? observeProviderMatches)(
			targets.externalIds,
			configuration,
		);
		if (normalizedObservation(observed)) observation = observed;
	} catch {
		// Provider and parser failures remain a fixed aggregate inconclusive result.
	}

	let confirmed: ProviderMultiLookupObserverTargets;
	try {
		confirmed = parseProviderMultiLookupObserverTargets(await dependencies.readTargets());
	} catch {
		return "provider_multi_lookup_observer:target_conflict";
	}
	if (
		confirmed.outcome !== "ready" ||
		confirmed.externalIds.length !== targets.externalIds.length ||
		confirmed.externalIds.some((externalId, index) => externalId !== targets.externalIds[index])
	)
		return "provider_multi_lookup_observer:target_conflict";
	return `provider_multi_lookup_observer:${observation}`;
}
