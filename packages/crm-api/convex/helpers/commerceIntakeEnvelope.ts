import type Stripe from "stripe";
import {
	COMMERCE_TENANT_ID_METADATA_KEY,
	COMMERCE_TENANT_METADATA_KEY,
	STRIPE_API_VERSION,
} from "../../src/stripeContract";
import { isStripeCheckoutSessionId, isStripeConnectedAccountId } from "./checkoutSnapshot";
import { isTenantId } from "./tenantContext";

export const MAX_INTAKE_ENVELOPE_BYTES = 64 * 1024;
export type CommerceIntakeRole = "your-account" | "connected-accounts";

/** Only these Session fields cross the durable replay boundary. */
export type CheckoutIntakeSession = Pick<Stripe.Checkout.Session,
	| "id" | "mode" | "metadata" | "amount_total" | "amount_subtotal"
	| "payment_status" | "currency" | "livemode" | "created" | "expires_at"
	| "customer_email" | "payment_intent"
> & {
	customer_details: { email: string | null; name: string | null } | null;
	collected_information?: Pick<Stripe.Checkout.Session.CollectedInformation, "shipping_details"> | null;
	// SDK reads and the existing synchronous fallback may supply expanded line items.
	// They are fetched by intake, not copied into the retained event envelope.
	line_items?: Stripe.Checkout.Session["line_items"];
};

export type CommerceIntakeEvent = {
	id: string;
	type: "checkout.session.completed";
	api_version: typeof STRIPE_API_VERSION;
	created: number;
	livemode: boolean;
	account?: string;
	data: { object: CheckoutIntakeSession };
};

function invalid(): never { throw new Error("Invalid commerce intake envelope"); }

function isObject(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function object(value: unknown): Record<string, unknown> {
	if (!isObject(value)) return invalid();
	return value;
}

function closed(value: unknown, keys: readonly string[]) {
	const result = object(value);
	if (Object.keys(result).length !== keys.length || keys.some(key => !Object.hasOwn(result, key))) invalid();
	return result;
}

function text(value: unknown, maximum: number) {
	if (typeof value !== "string" || value.length > maximum) return invalid();
	return value;
}

function nullableText(value: unknown, maximum: number) {
	return value === null ? null : text(value, maximum);
}

function integer(value: unknown) {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return invalid();
	return value;
}

function amount(value: unknown) { return value === null ? null : integer(value); }

function seconds(value: unknown) {
	const result = integer(value);
	if (result > 8_640_000_000_000) invalid();
	return result;
}

function boolean(value: unknown) {
	if (typeof value !== "boolean") return invalid();
	return value;
}

function metadata(value: unknown) {
	if (value === null) return null;
	const source = object(value);
	if (Object.keys(source).length > 50) invalid();
	return Object.fromEntries(Object.keys(source).sort().map(key => {
		if (!key || key.length > 40) invalid();
		return [key, text(source[key], 500)];
	}));
}

function customer(value: unknown) {
	if (value === null) return null;
	const input = closed(value, ["email", "name"]);
	return { email: nullableText(input.email, 320), name: nullableText(input.name, 500) };
}

function shipping(value: unknown) {
	if (value === null) return null;
	const input = closed(value, ["name", "address"]);
	const address = closed(input.address, ["city", "country", "line1", "line2", "postal_code", "state"]);
	return {
		name: text(input.name, 500),
		address: {
			city: nullableText(address.city, 500), country: nullableText(address.country, 2),
			line1: nullableText(address.line1, 500), line2: nullableText(address.line2, 500),
			postal_code: nullableText(address.postal_code, 100), state: nullableText(address.state, 500),
		},
	};
}

/** Rebuild a closed projection instead of asserting that arbitrary JSON is a full Stripe event. */
export function parseCommerceIntakeEnvelope(raw: string) {
	if (new TextEncoder().encode(raw).byteLength > MAX_INTAKE_ENVELOPE_BYTES) invalid();
	let input: unknown;
	try { input = JSON.parse(raw); } catch { return invalid(); }
	const envelope = closed(input, ["version", "role", "event"]);
	if (envelope.version !== 1 || !["your-account", "connected-accounts"].includes(String(envelope.role))) invalid();
	const role: CommerceIntakeRole = envelope.role === "your-account" ? "your-account" : "connected-accounts";
	const source = closed(envelope.event, ["id", "type", "api_version", "created", "livemode", "account", "session"]);
	const id = text(source.id, 128);
	if (!/^evt_[A-Za-z0-9]{16,120}$/.test(id) || source.type !== "checkout.session.completed"
		|| source.api_version !== STRIPE_API_VERSION) invalid();
	const livemode = boolean(source.livemode);
	const account = source.account === null ? undefined : text(source.account, 128);
	if (account !== undefined && !isStripeConnectedAccountId(account)) invalid();
	if ((role === "connected-accounts") !== (account !== undefined)) invalid();
	const session = closed(source.session, ["id", "mode", "metadata", "amount_total", "amount_subtotal",
		"payment_status", "currency", "livemode", "created", "expires_at", "customer_email",
		"payment_intent", "customer_details", "shipping_details"]);
	if (!isStripeCheckoutSessionId(session.id) || session.mode !== "payment"
		|| boolean(session.livemode) !== livemode
		|| !session.id.startsWith(livemode ? "cs_live_" : "cs_test_")) invalid();
	const meta = metadata(session.metadata);
	if (meta?.type === "invoice_payment" || meta?.type === "platform_subscription") invalid();
	const paymentStatus = session.payment_status;
	if (paymentStatus !== "paid" && paymentStatus !== "unpaid" && paymentStatus !== "no_payment_required") invalid();
	const currency = nullableText(session.currency, 3);
	if (currency !== null && !/^[a-z]{3}$/.test(currency)) invalid();
	const paymentIntent = nullableText(session.payment_intent, 128);
	if (paymentIntent !== null && !/^pi_[A-Za-z0-9]{16,120}$/.test(paymentIntent)) invalid();
	const created = seconds(session.created);
	const expiresAt = seconds(session.expires_at);
	if (expiresAt < created) invalid();
	const event: CommerceIntakeEvent = {
		id, type: "checkout.session.completed", api_version: STRIPE_API_VERSION,
		created: seconds(source.created), livemode, ...(account ? { account } : {}),
		data: { object: {
			id: session.id, mode: "payment", metadata: meta,
			amount_total: amount(session.amount_total), amount_subtotal: amount(session.amount_subtotal),
			payment_status: paymentStatus, currency, livemode, created, expires_at: expiresAt,
			customer_email: nullableText(session.customer_email, 320), payment_intent: paymentIntent,
			customer_details: customer(session.customer_details),
			collected_information: { shipping_details: shipping(session.shipping_details) },
		} },
	};
	const site = meta?.[COMMERCE_TENANT_METADATA_KEY]?.trim();
	const tenantId = meta?.[COMMERCE_TENANT_ID_METADATA_KEY];
	if (tenantId !== undefined && (!isTenantId(tenantId) || !site)) invalid();
	if (site !== undefined && (!site || site.length > 253)) invalid();
	const eventJson = JSON.stringify(project(event, role));
	if (new TextEncoder().encode(eventJson).byteLength > MAX_INTAKE_ENVELOPE_BYTES) invalid();
	return {
		event, role, eventJson,
		routingFacts: {
			stripeSessionId: event.data.object.id,
			...(account ? { stripeConnectedAccountId: account } : {}),
			...(site ? { stripeTenantMetadataSiteUrl: site } : {}),
			...(tenantId ? { stripeTenantMetadataTenantId: tenantId } : {}),
		},
	};
}

function project(event: CommerceIntakeEvent, role: CommerceIntakeRole) {
	const session = event.data.object;
	const paymentIntent = session.payment_intent;
	return {
		version: 1, role,
		event: {
			id: event.id, type: event.type, api_version: event.api_version,
			created: event.created, livemode: event.livemode, account: event.account ?? null,
			session: {
				id: session.id, mode: session.mode, metadata: session.metadata,
				amount_total: session.amount_total, amount_subtotal: session.amount_subtotal,
				payment_status: session.payment_status, currency: session.currency,
				livemode: session.livemode, created: session.created, expires_at: session.expires_at,
				customer_email: session.customer_email,
				payment_intent: typeof paymentIntent === "string" ? paymentIntent : paymentIntent?.id ?? null,
				customer_details: session.customer_details
					? { email: session.customer_details.email, name: session.customer_details.name } : null,
				shipping_details: session.collected_information?.shipping_details ?? null,
			},
		},
	};
}

/** The caller has already verified the Stripe signature, API version and destination. */
export function serializeCommerceIntakeEnvelope(
	event: Omit<CommerceIntakeEvent, "api_version"> & { api_version: string | null },
	role: CommerceIntakeRole,
) {
	if (event.api_version !== STRIPE_API_VERSION) invalid();
	return parseCommerceIntakeEnvelope(JSON.stringify(project({ ...event, api_version: STRIPE_API_VERSION }, role))).eventJson;
}

export async function intakeEnvelopeDigest(eventJson: string) {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(eventJson));
	return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}
