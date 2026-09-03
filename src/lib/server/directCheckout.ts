import type Stripe from "stripe";
import { ApiErrorCode, apiError } from "$lib/server/apiError";
import { CurrentCheckoutCommerceError } from "$lib/server/checkoutFailures";
import type {
	CheckoutAdmissionIdentity,
	CheckoutSessionAdmissionClient,
} from "$lib/server/checkoutSessionAdmissionClient";
import type { CheckoutSnapshotReservationClient } from "$lib/server/checkoutSnapshotReservationClient";
import { resolveCurrentCheckoutCommerce } from "$lib/server/current/currentCheckoutCommerce.server";
import { createHandleCheckoutSession } from "$lib/server/handleCheckout";
import { logStructured } from "$lib/server/logger";
import { buildCheckoutLineItem } from "$lib/server/stripeCheckoutSession";
import { buildTenantCheckoutOptions, type StripeTenantAccount } from "$lib/server/stripeConnect";

type CheckoutBody = Record<string, unknown>;
type CheckoutLogger = typeof logStructured;

export interface CreateDirectCheckoutSessionOptions {
	body: unknown;
	stripe: Stripe;
	siteUrl: string;
	tenant?: StripeTenantAccount;
	bindSession: (sessionId: string) => void;
	resolveCommerce?: typeof resolveCurrentCheckoutCommerce;
	log?: CheckoutLogger;
	reservationClient?: CheckoutSnapshotReservationClient;
	admissionClient?: CheckoutSessionAdmissionClient;
	attemptIdentity: CheckoutAdmissionIdentity;
	hostGeneration: number;
	now?: number;
}

export interface DirectCheckoutSessionResult {
	sessionId: string;
	url: string | null;
	expiresAt?: number;
}

function normalizeCheckoutBody(rawBody: unknown): CheckoutBody {
	return rawBody && typeof rawBody === "object" && !Array.isArray(rawBody)
		? (rawBody as CheckoutBody)
		: {};
}

export function rejectCouponAttempt(rawBody: unknown) {
	const body = normalizeCheckoutBody(rawBody);
	if (Object.hasOwn(body, "coupon") && body.coupon !== null && body.coupon !== "") {
		throw apiError(400, ApiErrorCode.INVALID_COUPON, "Coupons are not accepted");
	}
}

function logRequestShape(body: CheckoutBody, log: CheckoutLogger) {
	const bodyKeys = Object.keys(body);
	log({
		event: "checkout.request_received",
		meta: {
			keys: bodyKeys,
			keyCount: bodyKeys.length,
			hasImages: Array.isArray(body.images) ? body.images.length : 0,
		},
	});

	log({
		event: "checkout.payload_parsed",
		meta: {
			hasProductId: typeof body.productId === "string",
			hasPaperSlug: typeof body.paperSlug === "string",
			hasSizeSlug: typeof body.sizeSlug === "string",
			hasPaperIndex: typeof body.paperIndex === "number",
			isPrintSet: body.isPrintSet === true,
		},
	});
}

export async function createDirectCheckoutSession({
	body: rawBody,
	stripe,
	siteUrl,
	tenant,
	bindSession,
	resolveCommerce = resolveCurrentCheckoutCommerce,
	log = logStructured,
	reservationClient,
	admissionClient,
	attemptIdentity,
	hostGeneration,
	now = Date.now(),
}: CreateDirectCheckoutSessionOptions): Promise<DirectCheckoutSessionResult> {
	rejectCouponAttempt(rawBody);
	const body = normalizeCheckoutBody(rawBody);
	logRequestShape(body, log);

	const productId = body.productId;
	if (!productId) {
		log({
			event: "checkout.missing_fields",
			level: "warn",
			meta: { hasProductId: !!productId },
		});
		throw apiError(400, ApiErrorCode.MISSING_FIELD, "Missing required field: productId");
	}

	const commerce = await resolveCommerce([body]);
	const item = commerce.items[0];
	if (!item || commerce.items.length !== 1) {
		throw new CurrentCheckoutCommerceError("invalid_authority", "authority");
	}
	const subtotalCents = item.unitPriceCents;
	const fulfillment = item.legacyFulfillment;
	const tenantCheckout = buildTenantCheckoutOptions({
		tenant: tenant ?? { siteUrl },
		kind: fulfillment.paper ? "print" : "service",
		subtotalCents,
	});
	const lineItems = [
		buildCheckoutLineItem({
			name: item.title,
			imageUrl: item.publicImage ?? undefined,
			unitAmountCents: subtotalCents,
		}),
	];
	const successUrl = `${siteUrl}/checkout/success?session_id={CHECKOUT_SESSION_ID}`;
	const cancelUrl = `${siteUrl}/checkout/cancel`;
	if (!item.snapshot) throw new CurrentCheckoutCommerceError("invalid_authority", "authority");
	return await createHandleCheckoutSession({
		attempt: attemptIdentity.attempt,
		attemptStartedAt: attemptIdentity.attemptStartedAt,
		attemptProofClass: attemptIdentity.proofClass,
		site: String(tenantCheckout.metadata.commerceTenantSiteUrl),
		account: tenant?.stripeConnectedAccountId?.trim() || null,
		catalogProvider: "convex",
		snapshotItems: [item.snapshot],
		stripe,
		lineItems,
		successUrl,
		cancelUrl,
		shippingAllowedCountries: fulfillment.isDigital ? undefined : ["US"],
		tenantCheckout,
		bindSession,
		reservationClient,
		admissionClient,
		hostGeneration,
		now,
	});
}
