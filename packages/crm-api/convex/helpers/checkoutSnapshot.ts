import { type Infer, v } from "convex/values";
import { catalogProductKindValidator } from "./catalogProductValidators";

const nullableKey = v.union(v.string(), v.null());
const encoder = new TextEncoder();
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const STRIPE_CONNECTED_ACCOUNT_ID = /^acct_[A-Za-z0-9]{16,64}$/;
const STRIPE_CHECKOUT_SESSION_ID = /^cs_(?:test|live)_[A-Za-z0-9]{16,120}$/;
export const STRIPE_SESSION_MIN_LIFETIME_SECONDS = 30 * 60;
export const STRIPE_SESSION_MAX_LIFETIME_SECONDS = 24 * 60 * 60;
export const STRIPE_CLOCK_SKEW_SECONDS = 5 * 60;
const PRODUCT_KINDS = new Set([
	"print", "print_set", "postcard", "tapestry", "digital_download", "merchandise",
]);
const ITEM_KEYS = [
	"productKey", "revisionId", "productKind", "variantKey", "materialOptionKey",
	"sizeOptionKey", "borderOptionKey", "frameOptionKey",
] as const;

/** Immutable provider-neutral routing identity captured when checkout resolves. */
export const checkoutSnapshotValidator = v.object({
	schemaVersion: v.literal(1),
	catalogProvider: v.union(v.literal("sanity"), v.literal("convex")),
	items: v.array(
		v.object({
			productKey: v.string(),
			revisionId: v.string(),
			productKind: catalogProductKindValidator,
			variantKey: nullableKey,
			materialOptionKey: v.optional(nullableKey),
			sizeOptionKey: v.optional(nullableKey),
			borderOptionKey: v.optional(nullableKey),
			frameOptionKey: v.optional(nullableKey),
		}),
	),
});

/** Reservation rows use one normalized shape; legacy inline order inputs stay compatible. */
export const reservedCheckoutSnapshotValidator = v.object({
	schemaVersion: v.literal(1),
	catalogProvider: v.union(v.literal("sanity"), v.literal("convex")),
	items: v.array(v.object({
		productKey: v.string(), revisionId: v.string(), productKind: catalogProductKindValidator,
		variantKey: nullableKey, materialOptionKey: nullableKey, sizeOptionKey: nullableKey,
		borderOptionKey: nullableKey, frameOptionKey: nullableKey,
	})),
});
export type ReservedCheckoutSnapshot = Infer<typeof reservedCheckoutSnapshotValidator>;

function exactRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value)
		&& Object.keys(value).length === keys.length
		&& keys.every((key) => Object.hasOwn(value, key));
}

function boundedString(value: unknown) {
	return typeof value === "string" && value.length > 0 && value === value.trim()
		&& encoder.encode(value).byteLength <= 128 ? value : null;
}

function nullableString(value: unknown) {
	return value === null ? null : boundedString(value);
}

function siteString(value: unknown) {
	return typeof value === "string" && value.length > 0 && value.length <= 253
		&& value === value.trim() ? value : null;
}

export function parseReservedCheckoutSnapshot(value: unknown): ReservedCheckoutSnapshot | null {
	if (!exactRecord(value, ["schemaVersion", "catalogProvider", "items"])) return null;
	if (value.schemaVersion !== 1 || (value.catalogProvider !== "sanity" && value.catalogProvider !== "convex")) return null;
	const catalogProvider: "sanity" | "convex" = value.catalogProvider;
	if (!Array.isArray(value.items) || value.items.length < 1 || value.items.length > 40) return null;
	const items: ReservedCheckoutSnapshot["items"] = [];
	for (const item of value.items) {
		if (!exactRecord(item, ITEM_KEYS)) return null;
		const productKey = boundedString(item.productKey);
		const revisionId = boundedString(item.revisionId);
		const variantKey = nullableString(item.variantKey);
		const materialOptionKey = nullableString(item.materialOptionKey);
		const sizeOptionKey = nullableString(item.sizeOptionKey);
		const borderOptionKey = nullableString(item.borderOptionKey);
		const frameOptionKey = nullableString(item.frameOptionKey);
		if (!productKey || !revisionId || !PRODUCT_KINDS.has(String(item.productKind))
			|| variantKey === null && item.variantKey !== null
			|| materialOptionKey === null && item.materialOptionKey !== null
			|| sizeOptionKey === null && item.sizeOptionKey !== null
			|| borderOptionKey === null && item.borderOptionKey !== null
			|| frameOptionKey === null && item.frameOptionKey !== null) return null;
		items.push({ productKey, revisionId, productKind: item.productKind as ReservedCheckoutSnapshot["items"][number]["productKind"],
			variantKey, materialOptionKey, sizeOptionKey, borderOptionKey, frameOptionKey });
	}
	const snapshot = { schemaVersion: 1 as const, catalogProvider, items };
	return encoder.encode(JSON.stringify(snapshot)).byteLength <= 64 * 1024 ? snapshot : null;
}

export function isStripeConnectedAccountId(value: unknown): value is string {
	return typeof value === "string" && STRIPE_CONNECTED_ACCOUNT_ID.test(value);
}

export function isStripeCheckoutSessionId(value: unknown): value is string {
	return typeof value === "string" && STRIPE_CHECKOUT_SESSION_ID.test(value);
}

export function isBoundedStripeExpiration(
	value: unknown,
	nowSeconds = Math.floor(Date.now() / 1000),
) {
	if (!Number.isSafeInteger(value) || !Number.isSafeInteger(nowSeconds)) return false;
	const expiresAt = Number(value);
	return expiresAt >= nowSeconds + STRIPE_SESSION_MIN_LIFETIME_SECONDS - STRIPE_CLOCK_SKEW_SECONDS
		&& expiresAt <= nowSeconds + STRIPE_SESSION_MAX_LIFETIME_SECONDS + STRIPE_CLOCK_SKEW_SECONDS
		&& Number.isSafeInteger(expiresAt * 1000);
}

export function parseReservationRequest(value: unknown) {
	if (!exactRecord(value, ["version", "site", "attempt", "account", "snapshot"])) return null;
	const site = siteString(value.site);
	const account = value.account === null ? null : value.account;
	const snapshot = parseReservedCheckoutSnapshot(value.snapshot);
	return value.version === 1 && site && UUID_V4.test(String(value.attempt)) && snapshot
		&& (account === null || isStripeConnectedAccountId(account))
		? { site, attempt: value.attempt as string, account, snapshot } : null;
}

export function parseReservationBindRequest(value: unknown) {
	if (!exactRecord(value, ["version", "site", "handle", "account", "session", "stripeExpiresAt"])) return null;
	const site = siteString(value.site);
	const account = value.account === null ? null : value.account;
	return value.version === 1 && site && UUID_V4.test(String(value.handle))
		&& (account === null || isStripeConnectedAccountId(account))
		&& isStripeCheckoutSessionId(value.session)
		&& isBoundedStripeExpiration(value.stripeExpiresAt)
		? { site, handle: value.handle as string, account, session: value.session,
			stripeExpiresAt: value.stripeExpiresAt as number } : null;
}

export function parseReservationCandidate(value: unknown) {
	return exactRecord(value, ["version", "handle"]) && value.version === 2
		&& UUID_V4.test(String(value.handle)) ? value.handle as string : null;
}

async function digest(value: string) {
	return new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

function hex(bytes: Uint8Array) {
	return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function reservationHandle(site: string, attempt: string) {
	const bytes = (await digest(`checkout-snapshot-handle-v2\0${site}\0${attempt}`)).slice(0, 16);
	bytes[6] = (bytes[6]! & 0x0f) | 0x40;
	bytes[8] = (bytes[8]! & 0x3f) | 0x80;
	const value = hex(bytes);
	return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

export async function reservationHandleHash(site: string, handle: string) {
	return hex(await digest(`checkout-snapshot-reservation-v2\0${site}\0${handle}`));
}

export async function reservationSnapshotDigest(snapshot: ReservedCheckoutSnapshot) {
	return hex(await digest(JSON.stringify(snapshot)));
}

export function stripeAccountScope(account: string | null | undefined) {
	return account ? `connected:${account}` : "platform";
}
