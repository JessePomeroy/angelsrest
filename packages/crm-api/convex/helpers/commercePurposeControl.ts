export const COMMERCE_CONTROL_VERSION = 1 as const;
export const COMMERCE_CONTROL_MAX_BYTES = 4096;
export const COMMERCE_TENANTS = ["angelsrest.online", "zippymiggy.com"] as const;

export type CommerceTenant = (typeof COMMERCE_TENANTS)[number];
export type CommerceControlState = "closed" | "open";
export type CommerceBackendPurpose = "new_order_admission" | "new_provider_submission";

export const COMMERCE_CONTROL_ENV: Record<CommerceBackendPurpose, string> = {
	new_order_admission: "NEW_ORDER_ADMISSION_CONTROL",
	new_provider_submission: "NEW_PROVIDER_SUBMISSION_CONTROL",
};

export type CommerceControlDecision = {
	state: CommerceControlState;
	generation: number | null;
	valid: boolean;
};

const encoder = new TextEncoder();
const tenantSet = new Set<string>(COMMERCE_TENANTS);

function isExactObject(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
	return value !== null
		&& typeof value === "object"
		&& !Array.isArray(value)
		&& Object.keys(value).length === keys.length
		&& keys.every((key) => Object.hasOwn(value, key));
}

export function isCommerceTenant(value: unknown): value is CommerceTenant {
	return typeof value === "string" && tenantSet.has(value);
}

/**
 * Parse one exact, complete registry. Invalid or missing input is closed without
 * exposing any fragment of the supplied configuration.
 */
export function parseCommerceControlRegistry(
	value: unknown,
	queriedSiteUrl: unknown,
): CommerceControlDecision {
	const closed: CommerceControlDecision = { state: "closed", generation: null, valid: false };
	if (!isCommerceTenant(queriedSiteUrl) || typeof value !== "string") return closed;
	if (value.length === 0 || encoder.encode(value).byteLength > COMMERCE_CONTROL_MAX_BYTES) {
		return closed;
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(value);
	} catch {
		return closed;
	}
	if (!isExactObject(parsed, ["version", "tenants"]) || parsed.version !== COMMERCE_CONTROL_VERSION) {
		return closed;
	}
	if (!Array.isArray(parsed.tenants) || parsed.tenants.length !== COMMERCE_TENANTS.length) {
		return closed;
	}

	const entries = new Map<CommerceTenant, { state: CommerceControlState; generation: number }>();
	for (const entry of parsed.tenants) {
		if (!isExactObject(entry, ["siteUrl", "state", "generation"])) return closed;
		if (!isCommerceTenant(entry.siteUrl) || entries.has(entry.siteUrl)) return closed;
		if (entry.state !== "open" && entry.state !== "closed") return closed;
		if (!Number.isSafeInteger(entry.generation) || Number(entry.generation) < 1) return closed;
		entries.set(entry.siteUrl, {
			state: entry.state,
			generation: Number(entry.generation),
		});
	}
	if (entries.size !== COMMERCE_TENANTS.length) return closed;
	const decision = entries.get(queriedSiteUrl);
	return decision ? { ...decision, valid: true } : closed;
}

export function commerceControlDecisionFromEnvironment(
	purpose: CommerceBackendPurpose,
	siteUrl: unknown,
): CommerceControlDecision {
	return parseCommerceControlRegistry(process.env[COMMERCE_CONTROL_ENV[purpose]], siteUrl);
}

export function assertSafeCommerceGeneration(value: unknown): asserts value is number {
	if (!Number.isSafeInteger(value) || Number(value) < 1) {
		throw new Error("Commerce control generation is invalid");
	}
}

export function checkedAcceptUntilMs(cutoffCreatedSeconds: number) {
	if (!Number.isSafeInteger(cutoffCreatedSeconds) || cutoffCreatedSeconds < 0) {
		throw new Error("Commerce cutoff is invalid");
	}
	const cutoffMs = cutoffCreatedSeconds * 1000;
	const acceptUntilMs = cutoffMs + 3_222_000_000;
	if (!Number.isSafeInteger(cutoffMs) || !Number.isSafeInteger(acceptUntilMs)) {
		throw new Error("Commerce cutoff is unsafe");
	}
	return acceptUntilMs;
}
