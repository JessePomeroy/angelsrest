import type Stripe from "stripe";
import { env } from "$env/dynamic/private";
import { ApiErrorCode, apiError } from "$lib/server/apiError";
import type { ResolvedCheckoutItem } from "$lib/server/checkoutCatalog";
import { resolveCheckoutItem } from "$lib/server/checkoutCatalog";
import type { CheckoutSnapshotReservationClient } from "$lib/server/checkoutSnapshotReservationClient";
import {
	checkoutSnapshotMode,
	createHandleCheckoutSession,
	validateCheckoutAttempt,
} from "$lib/server/handleCheckout";
import { logStructured } from "$lib/server/logger";
import {
	buildCheckoutLineItem,
	createPaymentCheckoutSession,
} from "$lib/server/stripeCheckoutSession";
import { buildTenantCheckoutOptions, type StripeTenantAccount } from "$lib/server/stripeConnect";

type CheckoutFetcher = Parameters<typeof resolveCheckoutItem>[0];
type CheckoutBody = Record<string, unknown>;
type ResolveCheckoutItem = (body: CheckoutBody) => Promise<ResolvedCheckoutItem>;
type CheckoutLogger = typeof logStructured;

export interface CreateDirectCheckoutSessionOptions {
	body: unknown;
	stripe: Stripe;
	siteUrl: string;
	tenant?: StripeTenantAccount;
	fetcher: CheckoutFetcher;
	bindSession: (sessionId: string) => void;
	resolveItem?: ResolveCheckoutItem;
	log?: CheckoutLogger;
	snapshotMode?: string;
	reservationClient?: CheckoutSnapshotReservationClient;
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

function buildCheckoutMetadata(item: ResolvedCheckoutItem): Stripe.MetadataParam {
	const fulfillment = item.legacyFulfillment;
	return {
		productId: item.productId,
		productSlug: item.productId,
		isDigital: fulfillment.isDigital ? "true" : "false",
		isPrintSet: fulfillment.isPrintSet ? "true" : "false",
		imageUrls: fulfillment.isPrintSet ? JSON.stringify(fulfillment.imageUrls) : "",
		imageUrl: !fulfillment.isPrintSet ? fulfillment.imageUrl || "" : "",
		paperName: fulfillment.paper?.name || "",
		paperSubcategoryId: fulfillment.paper?.subcategoryId?.toString() || "",
		paperWidth: fulfillment.paper?.width?.toString() || "",
		paperHeight: fulfillment.paper?.height?.toString() || "",
		borderWidth: fulfillment.paper?.borderWidth?.toString() || "",
		frameSubcategoryId: fulfillment.paper?.frameSubcategoryId?.toString() || "",
		canvasSubcategoryId: fulfillment.paper?.canvasSubcategoryId?.toString() || "",
		canvasWrapHex: fulfillment.paper?.canvasWrapHex || "",
		couponCode: "",
		originalPrice: (item.unitPriceCents / 100).toString(),
		discountAmount: "0",
	};
}

export async function createDirectCheckoutSession({
	body: rawBody,
	stripe,
	siteUrl,
	tenant,
	fetcher,
	bindSession,
	resolveItem,
	log = logStructured,
	snapshotMode = env.CHECKOUT_SNAPSHOT_MODE,
	reservationClient,
	now = Date.now(),
}: CreateDirectCheckoutSessionOptions): Promise<DirectCheckoutSessionResult> {
	rejectCouponAttempt(rawBody);
	const body = normalizeCheckoutBody(rawBody);
	const mode = checkoutSnapshotMode(snapshotMode);
	if (mode === "handle-v2") validateCheckoutAttempt(body.attempt, body.attemptStartedAt, now);
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

	const item = resolveItem
		? await resolveItem(body)
		: await resolveCheckoutItem(fetcher, body, mode === "handle-v2");
	const finalPrice = item.unitPriceCents / 100;
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
	if (mode === "handle-v2") {
		if (!item.snapshot) throw new Error("Checkout snapshot identity is unavailable");
		return await createHandleCheckoutSession({
			attempt: body.attempt,
			attemptStartedAt: body.attemptStartedAt,
			site: String(tenantCheckout.metadata.commerceTenantSiteUrl),
			account: tenant?.stripeConnectedAccountId?.trim() || null,
			catalogProvider: "sanity",
			snapshotItems: [item.snapshot],
			stripe,
			lineItems,
			successUrl,
			cancelUrl,
			shippingAllowedCountries: fulfillment.isDigital ? undefined : ["US"],
			tenantCheckout,
			bindSession,
			reservationClient,
			now,
		});
	}

	const session = await createPaymentCheckoutSession({
		stripe,
		shippingAllowedCountries: fulfillment.isDigital ? undefined : ["US"],
		lineItems,
		successUrl,
		cancelUrl,
		metadata: buildCheckoutMetadata(item),
		tenantCheckout,
	});

	log({
		event: "checkout.session_created",
		meta: {
			sessionId: session.sessionId,
			productId: item.productId,
			isPrintSet: fulfillment.isPrintSet,
			finalPrice,
			hasCoupon: false,
			platformFeeAmount: tenantCheckout.platformFeeAmount,
		},
	});

	bindSession(session.sessionId);
	return session;
}
