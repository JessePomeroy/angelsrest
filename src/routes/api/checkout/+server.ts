import { json } from "@sveltejs/kit";
import { PUBLIC_SITE_URL } from "$env/static/public";
import { client } from "$lib/sanity/client";
import { ApiErrorCode, apiError } from "$lib/server/apiError";
import { bindCheckoutSession } from "$lib/server/checkoutBinding";
import { resolveCheckoutItem } from "$lib/server/checkoutCatalog";
import { validateAndApplyCoupon } from "$lib/server/coupon";
import { logStructured } from "$lib/server/logger";
import { getStripe } from "$lib/server/stripeClient";

export async function POST({ request, cookies }) {
	const stripe = getStripe();
	try {
		const rawBody = await request.json();
		const body: Record<string, unknown> =
			rawBody && typeof rawBody === "object" && !Array.isArray(rawBody)
				? (rawBody as Record<string, unknown>)
				: {};
		// Audit H33: log only request shape, not values — body contains
		// customer image URLs (PII) that must not land in access logs.
		const bodyKeys = body && typeof body === "object" ? Object.keys(body) : [];
		logStructured({
			event: "checkout.request_received",
			meta: {
				keys: bodyKeys,
				keyCount: bodyKeys.length,
				hasImages: Array.isArray(body?.images) ? body.images.length : 0,
			},
		});

		const { productId } = body;
		const coupon = typeof body?.coupon === "string" ? body.coupon : null;
		// Audit H33: redact values — only log presence/types, not raw paper or image.
		logStructured({
			event: "checkout.payload_parsed",
			meta: {
				hasProductId: typeof productId === "string",
				hasPaperSlug: typeof body?.paperSlug === "string",
				hasSizeSlug: typeof body?.sizeSlug === "string",
				hasPaperIndex: typeof body?.paperIndex === "number",
				isPrintSet: body?.isPrintSet === true,
			},
		});

		if (!productId) {
			logStructured({
				event: "checkout.missing_fields",
				level: "warn",
				meta: {
					hasProductId: !!productId,
				},
			});
			throw apiError(400, ApiErrorCode.MISSING_FIELD, "Missing required field: productId");
		}

		const item = await resolveCheckoutItem(client.fetch.bind(client), body);

		let discountAmount = 0;
		let appliedCoupon: string | null = null;
		if (coupon) {
			const result = await validateAndApplyCoupon(
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
						// Stripe expects cents
						unit_amount: Math.round(finalPrice * 100),
					},
					quantity: 1,
				},
			],

			mode: "payment",

			// {CHECKOUT_SESSION_ID} is replaced by Stripe on redirect
			success_url: `${PUBLIC_SITE_URL}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
			cancel_url: `${PUBLIC_SITE_URL}/checkout/cancel`,

			metadata: {
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
			},
		});

		logStructured({
			event: "checkout.session_created",
			meta: {
				sessionId: session.id,
				productId: item.productId,
				isPrintSet: item.isPrintSet,
				finalPrice,
				hasCoupon: !!appliedCoupon,
			},
		});

		// Bind this browser to the session so /checkout/success can verify
		// the caller is the buyer before returning customer PII (audit H30).
		bindCheckoutSession(cookies, session.id);

		return json({ sessionId: session.id, url: session.url });
	} catch (err: unknown) {
		// Re-throw SvelteKit-shaped errors (from apiError / validateAndApplyCoupon)
		// so their status + structured body survive the catch.
		if (err && typeof err === "object" && "status" in err) throw err;

		logStructured({
			event: "checkout.failed",
			level: "error",
			stage: "stripe_session_create",
			error: err,
		});

		throw apiError(500, ApiErrorCode.UPSTREAM_FAILED, "Checkout failed. Please try again.");
	}
}
