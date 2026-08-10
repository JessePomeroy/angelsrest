import type Stripe from "stripe";
import { env } from "$env/dynamic/private";
import { ApiErrorCode, apiError } from "$lib/server/apiError";
import type { ResolvedCheckoutItem } from "$lib/server/checkoutCatalog";
import { resolveCheckoutItem } from "$lib/server/checkoutCatalog";
import { resolveCheckoutCommerce } from "$lib/server/checkoutCommerce";
import type {
	CheckoutAdmissionIdentity,
	CheckoutSessionAdmissionClient,
} from "$lib/server/checkoutSessionAdmissionClient";
import type { CheckoutSnapshotReservationClient } from "$lib/server/checkoutSnapshotReservationClient";
import {
	checkoutSnapshotMode,
	createAdmittedOrderCheckoutSession,
	createHandleCheckoutSession,
} from "$lib/server/handleCheckout";
import { logStructured } from "$lib/server/logger";
import { buildCheckoutLineItem } from "$lib/server/stripeCheckoutSession";
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
	resolveCommerce?: typeof resolveCheckoutCommerce;
	log?: CheckoutLogger;
	snapshotMode?: string;
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
	resolveCommerce = resolveCheckoutCommerce,
	log = logStructured,
	snapshotMode = env.CHECKOUT_SNAPSHOT_MODE,
	reservationClient,
	admissionClient,
	attemptIdentity,
	hostGeneration,
	now = Date.now(),
}: CreateDirectCheckoutSessionOptions): Promise<DirectCheckoutSessionResult> {
	rejectCouponAttempt(rawBody);
	const body = normalizeCheckoutBody(rawBody);
	const mode = checkoutSnapshotMode(snapshotMode);
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

	const commerce =
		mode === "handle-v2"
			? await resolveCommerce(fetcher, [body], {
					resolveSanity: resolveItem ? () => resolveItem(body) : undefined,
				})
			: null;
	const item =
		commerce?.items[0] ??
		(resolveItem ? await resolveItem(body) : await resolveCheckoutItem(fetcher, body));
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
			attempt: attemptIdentity.attempt,
			attemptStartedAt: attemptIdentity.attemptStartedAt,
			attemptProofClass: attemptIdentity.proofClass,
			site: String(tenantCheckout.metadata.commerceTenantSiteUrl),
			account: tenant?.stripeConnectedAccountId?.trim() || null,
			catalogProvider: commerce?.provider ?? "sanity",
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

	const session = await createAdmittedOrderCheckoutSession({
		identity: attemptIdentity,
		site: String(tenantCheckout.metadata.commerceTenantSiteUrl),
		account: tenant?.stripeConnectedAccountId?.trim() || null,
		hostGeneration,
		stripe,
		shippingAllowedCountries: fulfillment.isDigital ? undefined : ["US"],
		lineItems,
		successUrl,
		cancelUrl,
		metadata: buildCheckoutMetadata(item),
		tenantCheckout,
		admissionClient,
		bindSession,
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

	return session;
}
