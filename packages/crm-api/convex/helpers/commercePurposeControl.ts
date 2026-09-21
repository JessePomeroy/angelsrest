import { isTenantId } from "./tenantContext";

const LEGACY_MAX_BYTES = 4096;
const MAX_REGISTRY_BYTES = 65_536;
const MAX_REGISTRY_TENANTS = 100;
const LEGACY_TENANTS = new Set(["angelsrest.online", "zippymiggy.com"]);

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
	tenantId?: string;
};

const encoder = new TextEncoder();

function isExactObject(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
	return value !== null
		&& typeof value === "object"
		&& !Array.isArray(value)
		&& Object.keys(value).length === keys.length
		&& keys.every((key) => Object.hasOwn(value, key));
}

/** Syntax only. Credentials, explicit registry intent and durable activation authorize a tenant. */
export function isCommerceTenantSite(value: unknown): value is string {
	if (typeof value !== "string" || value.length > 253 || value.startsWith("www.")) return false;
	const labels = value.split(".");
	return labels.length >= 2
		&& labels.every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
		&& /^[a-z]/.test(labels[labels.length - 1]);
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
	if (!isCommerceTenantSite(queriedSiteUrl) || typeof value !== "string") return closed;
	const byteLength = encoder.encode(value).byteLength;
	if (byteLength === 0 || byteLength > MAX_REGISTRY_BYTES) {
		return closed;
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(value);
	} catch {
		return closed;
	}
	if (!isExactObject(parsed, ["version", "tenants"]) || (parsed.version !== 1 && parsed.version !== 2)) {
		return closed;
	}
	const legacy = parsed.version === 1;
	if (!Array.isArray(parsed.tenants)
		|| parsed.tenants.length > MAX_REGISTRY_TENANTS
		|| legacy && (byteLength > LEGACY_MAX_BYTES || parsed.tenants.length !== LEGACY_TENANTS.size)) {
		return closed;
	}

	const entries = new Map<string, { state: CommerceControlState; generation: number; tenantId?: string }>();
	for (const entry of parsed.tenants) {
		if (!isExactObject(entry, legacy ? ["siteUrl", "state", "generation"] : ["siteUrl", "tenantId", "state", "generation"])) return closed;
		if (!isCommerceTenantSite(entry.siteUrl) || entries.has(entry.siteUrl)) return closed;
		if (legacy ? !LEGACY_TENANTS.has(entry.siteUrl) : !isTenantId(entry.tenantId)) return closed;
		if (entry.state !== "open" && entry.state !== "closed") return closed;
		if (!Number.isSafeInteger(entry.generation) || Number(entry.generation) < 1) return closed;
		entries.set(entry.siteUrl, {
			state: entry.state,
			generation: Number(entry.generation),
			...(isTenantId(entry.tenantId) ? { tenantId: entry.tenantId } : {}),
		});
	}
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
