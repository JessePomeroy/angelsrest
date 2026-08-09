const APPLY_OUTCOMES = [
	"applied",
	"already_applied",
	"source_overflow",
	"source_empty",
	"live_effect",
	"conflict",
] as const;

const VERIFY_OUTCOMES = [
	"complete",
	"missing",
	"source_present",
	"source_overflow",
	"conflict",
] as const;

type ApplyOutcome = (typeof APPLY_OUTCOMES)[number];
type VerifyOutcome = (typeof VERIFY_OUTCOMES)[number];

export const OWNER_TEST_ORDER_RESET_AUTHORITY =
	"owner_test_orders_disposable_residual_provider_effects_accepted_20260809" as const;
export const OWNER_TEST_ORDER_RESET_FUNCTION = "orderReset:applyOwnerTestOrders" as const;
export const OWNER_TEST_ORDER_RESET_VERIFY_FUNCTION = "orderReset:verify" as const;

export type OwnerTestOrderResetResult =
	| "owner_test_order_reset:applied_verified"
	| "owner_test_order_reset:already_applied_verified"
	| "owner_test_order_reset:applied_verification_conflict"
	| "owner_test_order_reset:already_applied_verification_conflict"
	| "owner_test_order_reset:applied_verification_unavailable"
	| "owner_test_order_reset:already_applied_verification_unavailable"
	| "owner_test_order_reset:application_response_lost_verified"
	| "owner_test_order_reset:application_outcome_unknown"
	| "owner_test_order_reset:source_overflow"
	| "owner_test_order_reset:source_empty"
	| "owner_test_order_reset:live_effect"
	| "owner_test_order_reset:conflict"
	| "owner_test_order_reset:configuration_error"
	| "owner_test_order_reset:operation_unavailable";

export function ownerTestOrderResetCliArguments(deployment: string) {
	return [
		"run",
		OWNER_TEST_ORDER_RESET_FUNCTION,
		JSON.stringify({ authority: OWNER_TEST_ORDER_RESET_AUTHORITY }),
		"--deployment",
		deployment,
		"--typecheck",
		"disable",
		"--codegen",
		"disable",
	] as const;
}

export function ownerTestOrderResetVerifyCliArguments(deployment: string) {
	return [
		"run",
		OWNER_TEST_ORDER_RESET_VERIFY_FUNCTION,
		"{}",
		"--deployment",
		deployment,
		"--typecheck",
		"disable",
		"--codegen",
		"disable",
	] as const;
}

export function ownerTestOrderResetChildEnvironment(
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

interface OwnerTestOrderResetExecutionOptions {
	cwd: string;
	timeout: number;
	maxBuffer: number;
	encoding: "utf8";
	env: Record<string, string | undefined>;
}

interface OwnerTestOrderResetReadDependencies {
	execute: (
		file: string,
		args: string[],
		options: OwnerTestOrderResetExecutionOptions,
	) => Promise<{ stdout: string }>;
	convexBinary: string;
	crmDirectory: string;
	deployment: string;
	environment: Record<string, string | undefined>;
}

async function readResult(
	dependencies: OwnerTestOrderResetReadDependencies,
	args: readonly string[],
) {
	const { stdout } = await dependencies.execute(dependencies.convexBinary, [...args], {
		cwd: dependencies.crmDirectory,
		timeout: 30_000,
		maxBuffer: 16 * 1024,
		encoding: "utf8",
		env: ownerTestOrderResetChildEnvironment(dependencies.environment),
	});
	return stdout.trim();
}

export async function applyOwnerTestOrderReset(dependencies: OwnerTestOrderResetReadDependencies) {
	return await readResult(dependencies, ownerTestOrderResetCliArguments(dependencies.deployment));
}

export async function verifyOwnerTestOrderReset(dependencies: OwnerTestOrderResetReadDependencies) {
	return await readResult(
		dependencies,
		ownerTestOrderResetVerifyCliArguments(dependencies.deployment),
	);
}

export function ownerTestOrderResetEnvironmentReady(
	environment: Record<string, string | undefined>,
	operationId: string,
	expectedConvexUrl: string,
) {
	return (
		environment.ORDER_RESET_OWNER_TEST_OPERATION_ID === operationId &&
		environment.ORDER_PRODUCERS_STATE === "closed" &&
		environment.PUBLIC_CONVEX_URL === expectedConvexUrl
	);
}

function object(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseOutcome<T extends string>(value: string, outcomes: readonly T[]): T {
	let parsed: unknown;
	try {
		parsed = JSON.parse(value) as unknown;
	} catch {
		throw new Error("invalid");
	}
	if (
		!object(parsed) ||
		Object.keys(parsed).length !== 1 ||
		typeof parsed.outcome !== "string" ||
		!outcomes.includes(parsed.outcome as T)
	)
		throw new Error("invalid");
	return parsed.outcome as T;
}

export function parseOwnerTestOrderResetResult(value: string): ApplyOutcome {
	return parseOutcome(value, APPLY_OUTCOMES);
}

export function parseOwnerTestOrderResetVerification(value: string): VerifyOutcome {
	return parseOutcome(value, VERIFY_OUTCOMES);
}

export async function runOwnerTestOrderReset(dependencies: {
	claimAttempt: () => Promise<boolean>;
	applyReset: () => Promise<string>;
	verifyReset: () => Promise<string>;
	environment: Record<string, string | undefined>;
	operationId: string;
	expectedConvexUrl: string;
}): Promise<OwnerTestOrderResetResult> {
	try {
		if (!(await dependencies.claimAttempt())) {
			return "owner_test_order_reset:operation_unavailable";
		}
	} catch {
		return "owner_test_order_reset:operation_unavailable";
	}
	if (
		!ownerTestOrderResetEnvironmentReady(
			dependencies.environment,
			dependencies.operationId,
			dependencies.expectedConvexUrl,
		)
	)
		return "owner_test_order_reset:configuration_error";

	let applied: ApplyOutcome;
	try {
		applied = parseOwnerTestOrderResetResult(await dependencies.applyReset());
	} catch {
		try {
			return parseOwnerTestOrderResetVerification(await dependencies.verifyReset()) === "complete"
				? "owner_test_order_reset:application_response_lost_verified"
				: "owner_test_order_reset:application_outcome_unknown";
		} catch {
			return "owner_test_order_reset:application_outcome_unknown";
		}
	}
	if (applied !== "applied" && applied !== "already_applied") {
		return `owner_test_order_reset:${applied}`;
	}

	let verified: VerifyOutcome;
	try {
		verified = parseOwnerTestOrderResetVerification(await dependencies.verifyReset());
	} catch {
		return `owner_test_order_reset:${applied}_verification_unavailable`;
	}
	return verified === "complete"
		? `owner_test_order_reset:${applied}_verified`
		: `owner_test_order_reset:${applied}_verification_conflict`;
}
