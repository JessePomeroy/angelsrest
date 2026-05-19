import type Stripe from "stripe";
import { ApiErrorCode, apiError } from "$lib/server/apiError";
import type { ResolvedCheckoutItem } from "$lib/server/checkoutCatalog";
import { resolveCheckoutItem } from "$lib/server/checkoutCatalog";
import { type CouponResult, validateAndApplyCoupon } from "$lib/server/coupon";
import { logStructured } from "$lib/server/logger";

type CheckoutFetcher = Parameters<typeof resolveCheckoutItem>[0];
type CheckoutBody = Record<string, unknown>;
type ResolveCheckoutItem = (body: CheckoutBody) => Promise<ResolvedCheckoutItem>;
type ValidateCoupon = (
	couponCode: string,
	productSlug: string,
	productCategory: string | undefined,
	price: number,
) => Promise<CouponResult>;
type CheckoutLogger = typeof logStructured;

export interface CreateDirectCheckoutSessionOptions {
	body: unknown;
	stripe: Stripe;
	siteUrl: string;
	fetcher: CheckoutFetcher;
	bindSession: (sessionId: string) => void;
	resolveItem?: ResolveCheckoutItem;
	validateCoupon?: ValidateCoupon;
	log?: CheckoutLogger;
}

export interface DirectCheckoutSessionResult {
	sessionId: string;
	url: string | null;
}

function normalizeCheckoutBody(rawBody: unknown): CheckoutBody {
	return rawBody && typeof rawBody === "object" && !Array.isArray(rawBody)
		? (rawBody as CheckoutBody)
		: {};
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

function buildCheckoutMetadata(
	item: ResolvedCheckoutItem,
	appliedCoupon: string | null,
	discountAmount: number,
): Stripe.MetadataParam {
	return {
		productId: item.productId,
		productSlug: item.productId,
		isDigital: item.isDigital ? "true" : "false",
		isPrintSet: item.isPrintSet ? "true" : "false",
		imageUrls: item.isPrintSet ? JSON.stringify(item.images) : "",
		imageUrl: !item.isPrintSet ? item.image || "" : "",
		paperName: item.paper?.name || "",
		paperSubcategoryId: item.paper?.subcategoryId?.toString() || "",
		paperWidth: item.paper?.width?.toString() || "",
		paperHeight: item.paper?.height?.toString() || "",
		borderWidth: item.paper?.borderWidth?.toString() || "",
		frameSubcategoryId: item.paper?.frameSubcategoryId?.toString() || "",
		canvasSubcategoryId: item.paper?.canvasSubcategoryId?.toString() || "",
		canvasWrapHex: item.paper?.canvasWrapHex || "",
		couponCode: appliedCoupon || "",
		originalPrice: item.price.toString(),
		discountAmount: discountAmount.toString(),
	};
}

export async function createDirectCheckoutSession({
	body: rawBody,
	stripe,
	siteUrl,
	fetcher,
	bindSession,
	resolveItem = (body) => resolveCheckoutItem(fetcher, body),
	validateCoupon = validateAndApplyCoupon,
	log = logStructured,
}: CreateDirectCheckoutSessionOptions): Promise<DirectCheckoutSessionResult> {
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

	const item = await resolveItem(body);
	const coupon = typeof body.coupon === "string" ? body.coupon : null;

	let discountAmount = 0;
	let appliedCoupon: string | null = null;
	if (coupon) {
		const result = await validateCoupon(
			coupon,
			item.productId,
			item.productCategory ?? undefined,
			item.price,
		);
		discountAmount = result.discountAmount;
		appliedCoupon = result.appliedCoupon;
	}

	const finalPrice = Math.max(0, item.price - discountAmount);

	const session = await stripe.checkout.sessions.create({
		payment_method_types: ["card"],
		...(item.isDigital
			? {}
			: {
					shipping_address_collection: {
						allowed_countries: ["US"],
					},
				}),
		line_items: [
			{
				price_data: {
					currency: "usd",
					product_data: {
						name: item.title,
						images: item.image ? [item.image] : [],
					},
					unit_amount: Math.round(finalPrice * 100),
				},
				quantity: 1,
			},
		],
		mode: "payment",
		success_url: `${siteUrl}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
		cancel_url: `${siteUrl}/checkout/cancel`,
		metadata: buildCheckoutMetadata(item, appliedCoupon, discountAmount),
	});

	log({
		event: "checkout.session_created",
		meta: {
			sessionId: session.id,
			productId: item.productId,
			isPrintSet: item.isPrintSet,
			finalPrice,
			hasCoupon: !!appliedCoupon,
		},
	});

	bindSession(session.id);

	return { sessionId: session.id, url: session.url };
}
