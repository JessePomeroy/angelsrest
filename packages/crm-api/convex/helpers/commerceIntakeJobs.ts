import { type Infer, v } from "convex/values";

export const INTAKE_LEASE_MS = 150_000;
export const INTAKE_DISPATCH_TIMEOUT_MS = 115_000;
export const INTAKE_DISPATCH_REQUIRED_REMAINING_MS = 125_000;
export const INTAKE_MAX_CYCLE_AGE_MS = 23 * 60 * 60 * 1000;
export const INTAKE_MAX_CYCLE_ATTEMPTS = 12;
export const INTAKE_MAX_RECOVERIES = 3;
export const INTAKE_MAX_RECOVERY_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export const intakeState = v.union(v.literal("pending"), v.literal("processing"),
	v.literal("retry"), v.literal("done"), v.literal("blocked"));
export const intakeFailure = v.union(
	v.literal("runner_unavailable"), v.literal("processing_failed"), v.literal("payload_invalid"),
	v.literal("scope_conflict"), v.literal("missing_order"), v.literal("receipt_pending"),
	v.literal("receipt_uncertain"), v.literal("handoff_unproven"), v.literal("financial_recovery"),
	v.literal("attempts_exhausted"), v.literal("age_exceeded"),
);
export type IntakeFailure = Infer<typeof intakeFailure>;
export const intakeRole = v.union(v.literal("your-account"), v.literal("connected-accounts"));
export const intakeRecoveryReason = v.union(
	v.literal("dependencies_restored"), v.literal("input_repaired"),
	v.literal("routing_restored"), v.literal("schedule_restored"), v.literal("persisted_outcome_verified"),
);

export const commerceIntakeFields = {
	protocolVersion: v.literal(1), stripeEventId: v.string(), stripeSessionId: v.string(),
	stripeEventCreatedSeconds: v.number(), livemode: v.boolean(), accountScope: v.string(),
	stripeConnectedAccountId: v.optional(v.string()), role: intakeRole,
	siteUrl: v.string(), tenantId: v.optional(v.string()),
	eventJson: v.string(), digest: v.string(),
	state: intakeState, version: v.number(), acceptedAt: v.number(), nextAt: v.number(),
	attempts: v.number(), cycleAttempts: v.number(), cycleStartedAt: v.number(), recoveryCount: v.number(),
	firstClaimAt: v.optional(v.number()), lastClaimAt: v.optional(v.number()),
	leaseToken: v.optional(v.string()), leaseExpiresAt: v.optional(v.number()),
	errorCode: v.optional(intakeFailure), lastAttemptCode: v.optional(intakeFailure),
	orderId: v.optional(v.id("orders")), completedAt: v.optional(v.number()), blockedAt: v.optional(v.number()),
	completion: v.optional(v.union(v.literal("order_intake"), v.literal("retired_session"))),
};

export function intakeRetryDelay(attempts: number) {
	return Math.min(30_000 * 2 ** Math.max(0, attempts - 1), 120_000);
}

/** Missing configuration keeps new acceptance off; malformed configuration fails closed. */
export function intakeScopeEnabled(raw: string | undefined, siteUrl: string, livemode: boolean) {
	if (!raw) return false;
	const invalid = () => { throw new Error("Commerce intake scope configuration is invalid"); };
	if (raw.length > 16_384) return invalid();
	let value: unknown;
	try { value = JSON.parse(raw); } catch { return invalid(); }
	if (!value || typeof value !== "object" || Array.isArray(value)
		|| !("version" in value) || value.version !== 1 || !("sites" in value)
		|| !Array.isArray(value.sites) || value.sites.length > 32 || Object.keys(value).length !== 2) return invalid();
	const seen = new Set<string>();
	let enabled = false;
	for (const item of value.sites) {
		if (!item || typeof item !== "object" || Array.isArray(item)
			|| !("siteUrl" in item) || typeof item.siteUrl !== "string" || !item.siteUrl
			|| item.siteUrl.length > 253 || item.siteUrl !== item.siteUrl.trim()
			|| !("mode" in item) || (item.mode !== "test" && item.mode !== "live")
			|| Object.keys(item).length !== 2) return invalid();
		const key = `${item.siteUrl}:${item.mode}`;
		if (seen.has(key)) return invalid();
		seen.add(key);
		if (item.siteUrl === siteUrl && item.mode === (livemode ? "live" : "test")) enabled = true;
	}
	return enabled;
}
