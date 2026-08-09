const NORMALIZED_OUTCOMES = [
	"source_conflict",
	"live_effect_conflict",
	"state_changed",
	"lookup_shape_eligible",
	"lookup_shape_ineligible",
] as const;

type ProviderMultiLookupEligibilityOutcome = (typeof NORMALIZED_OUTCOMES)[number];

export type ProviderMultiLookupEligibilityClassification = {
	outcome: ProviderMultiLookupEligibilityOutcome;
};

export const PROVIDER_MULTI_LOOKUP_ELIGIBILITY_CLASSIFIER_FUNCTION =
	"orderReset:classifyProviderMultiLookupEligibility" as const;

export type ProviderMultiLookupEligibilityClassifierResult =
	| `provider_multi_lookup_eligibility_classifier:${ProviderMultiLookupEligibilityOutcome}`
	| "provider_multi_lookup_eligibility_classifier:configuration_error"
	| "provider_multi_lookup_eligibility_classifier:operation_unavailable";

export function providerMultiLookupEligibilityClassifierCliArguments(deployment: string) {
	return [
		"run",
		PROVIDER_MULTI_LOOKUP_ELIGIBILITY_CLASSIFIER_FUNCTION,
		"{}",
		"--deployment",
		deployment,
		"--typecheck",
		"disable",
		"--codegen",
		"disable",
	] as const;
}

export function providerMultiLookupEligibilityClassifierChildEnvironment(
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

interface ProviderMultiLookupEligibilityClassifierExecutionOptions {
	cwd: string;
	timeout: number;
	maxBuffer: number;
	encoding: "utf8";
	env: Record<string, string | undefined>;
}

export async function readProviderMultiLookupEligibilityClassification(dependencies: {
	execute: (
		file: string,
		args: string[],
		options: ProviderMultiLookupEligibilityClassifierExecutionOptions,
	) => Promise<{ stdout: string }>;
	convexBinary: string;
	crmDirectory: string;
	deployment: string;
	environment: Record<string, string | undefined>;
}) {
	const { stdout } = await dependencies.execute(
		dependencies.convexBinary,
		[...providerMultiLookupEligibilityClassifierCliArguments(dependencies.deployment)],
		{
			cwd: dependencies.crmDirectory,
			timeout: 30_000,
			maxBuffer: 16 * 1024,
			encoding: "utf8",
			env: providerMultiLookupEligibilityClassifierChildEnvironment(dependencies.environment),
		},
	);
	return stdout.trim();
}

export function providerMultiLookupEligibilityClassifierEnvironmentReady(
	environment: Record<string, string | undefined>,
	operationId: string,
	expectedConvexUrl: string,
) {
	return (
		environment.ORDER_RESET_PROVIDER_MULTI_LOOKUP_ELIGIBILITY_CLASSIFIER_ID === operationId &&
		environment.ORDER_PRODUCERS_STATE === "closed" &&
		environment.PUBLIC_CONVEX_URL === expectedConvexUrl
	);
}

function object(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizedOutcome(value: unknown): value is ProviderMultiLookupEligibilityOutcome {
	return typeof value === "string" && (NORMALIZED_OUTCOMES as readonly string[]).includes(value);
}

export function parseProviderMultiLookupEligibilityClassification(
	value: string,
): ProviderMultiLookupEligibilityClassification {
	let parsed: unknown;
	try {
		parsed = JSON.parse(value) as unknown;
	} catch {
		throw new Error("invalid");
	}
	if (!object(parsed) || Object.keys(parsed).length !== 1 || !normalizedOutcome(parsed.outcome))
		throw new Error("invalid");
	return { outcome: parsed.outcome };
}

export function formatProviderMultiLookupEligibilityClassification(
	classification: ProviderMultiLookupEligibilityClassification,
): ProviderMultiLookupEligibilityClassifierResult {
	return `provider_multi_lookup_eligibility_classifier:${classification.outcome}`;
}

export async function runProviderMultiLookupEligibilityClassifier(dependencies: {
	claimAttempt: () => Promise<boolean>;
	readClassification: () => Promise<string>;
	environment: Record<string, string | undefined>;
	operationId: string;
	expectedConvexUrl: string;
}): Promise<ProviderMultiLookupEligibilityClassifierResult> {
	if (!(await dependencies.claimAttempt())) {
		return "provider_multi_lookup_eligibility_classifier:operation_unavailable";
	}
	if (
		!providerMultiLookupEligibilityClassifierEnvironmentReady(
			dependencies.environment,
			dependencies.operationId,
			dependencies.expectedConvexUrl,
		)
	)
		return "provider_multi_lookup_eligibility_classifier:configuration_error";
	try {
		return formatProviderMultiLookupEligibilityClassification(
			parseProviderMultiLookupEligibilityClassification(await dependencies.readClassification()),
		);
	} catch {
		return "provider_multi_lookup_eligibility_classifier:configuration_error";
	}
}
