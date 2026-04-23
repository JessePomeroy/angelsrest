import { json } from "@sveltejs/kit";
import { PUBLIC_SITE_URL } from "$env/static/public";
import { client } from "$lib/sanity/client";
import { ApiErrorCode, apiError } from "$lib/server/apiError";
import { bindCheckoutSession } from "$lib/server/checkoutBinding";
import { validateAndApplyCoupon } from "$lib/server/coupon";
import { logStructured } from "$lib/server/logger";
import { getStripe } from "$lib/server/stripeClient";

export async function POST({ request, cookies }) {
	const stripe = getStripe();
	try {
		const body = await request.json();
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

		const { productId, title, price, image, paper, coupon, isPrintSet, images } = body;
		// Audit H33: redact values — only log presence/types, not raw paper or image.
		logStructured({
			event: "checkout.payload_parsed",
			meta: {
				hasProductId: typeof productId === "string",
				hasTitle: typeof title === "string",
				hasPrice: typeof price === "number",
				hasPaper: !!paper,
				hasImage: !!image,
				isPrintSet: !!isPrintSet,
				imagesLength: Array.isArray(images) ? images.length : 0,
			},
		});

		if (!productId || !title || !price) {
			logStructured({
				event: "checkout.missing_fields",
				level: "warn",
				meta: {
					hasProductId: !!productId,
					hasTitle: !!title,
					hasPrice: !!price,
				},
			});
			throw apiError(
				400,
				ApiErrorCode.MISSING_FIELD,
				"Missing required fields: productId, title, price",
			);
		}

		const product = await client.fetch(
			`*[_type == "product" && slug.current == $slug][0]{ category }`,
			{ slug: productId },
		);
		const productCategory = product?.category;
		const isDigital = productCategory === "digital";

		let discountAmount = 0;
		let appliedCoupon: string | null = null;
		if (coupon) {
			const result = await validateAndApplyCoupon(coupon, productId, productCategory, price);
			discountAmount = result.discountAmount;
			appliedCoupon = result.appliedCoupon;
		}

		const finalPrice = Math.max(0, price - discountAmount);

		const session = await stripe.checkout.sessions.create({
			payment_method_types: ["card"],

			...(isDigital
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
							name: title,
							images: image ? [image] : [],
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
				productId,
				productSlug: productId,
				isDigital: isDigital ? "true" : "false",
				isPrintSet: isPrintSet ? "true" : "false",
				imageUrls: isPrintSet && images ? JSON.stringify(images) : "",
				imageUrl: !isPrintSet ? image || "" : "",
				paperName: paper?.name || "",
				paperSubcategoryId: paper?.subcategoryId?.toString() || "",
				paperWidth: paper?.width?.toString() || "",
				paperHeight: paper?.height?.toString() || "",
				couponCode: appliedCoupon || "",
				originalPrice: price.toString(),
				discountAmount: discountAmount.toString(),
			},
		});

		console.log("Stripe session created, metadata:", session.metadata);

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
