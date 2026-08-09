const CLASS_ORDER = [
	"unresolved_none",
	"unresolved_multiple",
	"fulfillment_not_lumaprints",
	"preparation_only",
	"provider_number_present",
	"session_not_live",
	"session_not_unique",
] as const;

type TargetConflictClass = (typeof CLASS_ORDER)[number];

export type ProviderTargetConflictClassification =
	| { outcome: "source_conflict" | "live_effect_conflict" | "no_target_conflict" }
	| { outcome: "target_conflict"; classes: TargetConflictClass[] };

export const PROVIDER_TARGET_CLASSIFIER_FUNCTION =
	"orderReset:classifyProviderTargetConflict" as const;

export type ProviderTargetConflictClassifierResult =
	| "provider_target_classifier:source_conflict"
	| "provider_target_classifier:live_effect_conflict"
	| "provider_target_classifier:no_target_conflict"
	| `provider_target_classifier:target_conflict:${string}`
	| "provider_target_classifier:configuration_error"
	| "provider_target_classifier:operation_unavailable";

export function providerTargetClassifierCliArguments(deployment: string) {
	return [
		"run",
		PROVIDER_TARGET_CLASSIFIER_FUNCTION,
		"{}",
		"--deployment",
		deployment,
		"--typecheck",
		"disable",
		"--codegen",
		"disable",
	] as const;
}

export function providerTargetClassifierChildEnvironment(
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

interface ProviderTargetClassifierExecutionOptions {
	cwd: string;
	timeout: number;
	maxBuffer: number;
	encoding: "utf8";
	env: Record<string, string | undefined>;
}

export async function readProviderTargetConflictClassification(dependencies: {
	execute: (
		file: string,
		args: string[],
		options: ProviderTargetClassifierExecutionOptions,
	) => Promise<{ stdout: string }>;
	convexBinary: string;
	crmDirectory: string;
	deployment: string;
	environment: Record<string, string | undefined>;
}) {
	const { stdout } = await dependencies.execute(
		dependencies.convexBinary,
		[...providerTargetClassifierCliArguments(dependencies.deployment)],
		{
			cwd: dependencies.crmDirectory,
			timeout: 30_000,
			maxBuffer: 16 * 1024,
			encoding: "utf8",
			env: providerTargetClassifierChildEnvironment(dependencies.environment),
		},
	);
	return stdout.trim();
}

export function providerTargetClassifierEnvironmentReady(
	environment: Record<string, string | undefined>,
	operationId: string,
	expectedConvexUrl: string,
) {
	return (
		environment.ORDER_RESET_PROVIDER_TARGET_CLASSIFIER_ID === operationId &&
		environment.ORDER_PRODUCERS_STATE === "closed" &&
		environment.PUBLIC_CONVEX_URL === expectedConvexUrl
	);
}

function object(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function parseProviderTargetConflictClassification(
	value: string,
): ProviderTargetConflictClassification {
	let parsed: unknown;
	try {
		parsed = JSON.parse(value) as unknown;
	} catch {
		throw new Error("invalid");
	}
	if (!object(parsed)) throw new Error("invalid");
	if (
		(parsed.outcome === "source_conflict" ||
			parsed.outcome === "live_effect_conflict" ||
			parsed.outcome === "no_target_conflict") &&
		Object.keys(parsed).length === 1
	)
		return { outcome: parsed.outcome };
	if (
		parsed.outcome !== "target_conflict" ||
		Object.keys(parsed).length !== 2 ||
		!Array.isArray(parsed.classes) ||
		parsed.classes.length === 0
	)
		throw new Error("invalid");
	const classes = parsed.classes.filter(
		(value): value is TargetConflictClass =>
			typeof value === "string" && CLASS_ORDER.includes(value as TargetConflictClass),
	);
	const canonical = CLASS_ORDER.filter((classification) => classes.includes(classification));
	if (
		classes.length !== parsed.classes.length ||
		classes.length !== canonical.length ||
		classes.some((classification, index) => classification !== canonical[index])
	)
		throw new Error("invalid");
	return { outcome: "target_conflict", classes };
}

export function formatProviderTargetConflictClassification(
	classification: ProviderTargetConflictClassification,
): ProviderTargetConflictClassifierResult {
	return classification.outcome === "target_conflict"
		? `provider_target_classifier:target_conflict:${classification.classes.join("+")}`
		: `provider_target_classifier:${classification.outcome}`;
}

export async function runProviderTargetConflictClassifier(dependencies: {
	claimAttempt: () => Promise<boolean>;
	readClassification: () => Promise<string>;
	environment: Record<string, string | undefined>;
	operationId: string;
	expectedConvexUrl: string;
}): Promise<ProviderTargetConflictClassifierResult> {
	if (!(await dependencies.claimAttempt())) {
		return "provider_target_classifier:operation_unavailable";
	}
	if (
		!providerTargetClassifierEnvironmentReady(
			dependencies.environment,
			dependencies.operationId,
			dependencies.expectedConvexUrl,
		)
	)
		return "provider_target_classifier:configuration_error";
	try {
		return formatProviderTargetConflictClassification(
			parseProviderTargetConflictClassification(await dependencies.readClassification()),
		);
	} catch {
		return "provider_target_classifier:configuration_error";
	}
}
