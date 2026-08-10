import { env } from "$env/dynamic/private";
import { normalizeCommerceTenantSiteUrl } from "$lib/server/stripeConnect";

const MAX_REGISTRY_BYTES = 4_096;
const EXPECTED_TENANTS = ["angelsrest.online", "zippymiggy.com"] as const;
const EXPECTED_TENANT_SET = new Set<string>(EXPECTED_TENANTS);
const encoder = new TextEncoder();

export type CommerceControlState = "open" | "closed";
export interface CommerceControlDecision {
	state: CommerceControlState;
	generation: number | null;
	valid: boolean;
}

export class NewOrderCheckoutClosedError extends Error {
	constructor() {
		super("New order Checkout is closed");
		this.name = "NewOrderCheckoutClosedError";
	}
}

export function newOrderCheckoutDecision(
	siteUrl: string,
	rawValue = env.NEW_ORDER_CHECKOUT_CONTROL,
): CommerceControlDecision {
	const parsed = parseRegistry(rawValue);
	const entry = parsed?.get(normalizeCommerceTenantSiteUrl(siteUrl));
	return entry
		? { state: entry.state, generation: entry.generation, valid: true }
		: { state: "closed", generation: null, valid: false };
}

export function assertNewOrderCheckoutOpen(
	siteUrl: string,
	rawValue = env.NEW_ORDER_CHECKOUT_CONTROL,
) {
	const decision = newOrderCheckoutDecision(siteUrl, rawValue);
	if (!decision.valid || decision.state !== "open" || decision.generation === null) {
		throw new NewOrderCheckoutClosedError();
	}
	return { state: "open" as const, generation: decision.generation };
}

function parseRegistry(rawValue: string | undefined) {
	if (
		typeof rawValue !== "string" ||
		rawValue.length === 0 ||
		encoder.encode(rawValue).byteLength > MAX_REGISTRY_BYTES
	)
		return null;
	let value: unknown;
	try {
		value = JSON.parse(rawValue);
	} catch {
		return null;
	}
	if (!exactObject(value, ["version", "tenants"]) || value.version !== 1) return null;
	if (!Array.isArray(value.tenants) || value.tenants.length !== EXPECTED_TENANTS.length) {
		return null;
	}
	const result = new Map<string, { state: CommerceControlState; generation: number }>();
	for (const candidate of value.tenants) {
		if (!exactObject(candidate, ["siteUrl", "state", "generation"])) return null;
		if (
			typeof candidate.siteUrl !== "string" ||
			!EXPECTED_TENANT_SET.has(candidate.siteUrl) ||
			candidate.siteUrl !== candidate.siteUrl.trim() ||
			(candidate.state !== "open" && candidate.state !== "closed") ||
			!Number.isSafeInteger(candidate.generation) ||
			Number(candidate.generation) < 1 ||
			result.has(candidate.siteUrl)
		)
			return null;
		result.set(candidate.siteUrl, {
			state: candidate.state,
			generation: Number(candidate.generation),
		});
	}
	return result.size === EXPECTED_TENANTS.length ? result : null;
}

function exactObject(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
	return (
		value !== null &&
		typeof value === "object" &&
		!Array.isArray(value) &&
		Object.keys(value).length === keys.length &&
		keys.every((key) => Object.hasOwn(value, key))
	);
}
