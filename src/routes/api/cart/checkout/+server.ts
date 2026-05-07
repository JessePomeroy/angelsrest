/**
 * Cart Checkout API Endpoint (cart PR C of the cart stack).
 *
 * Counterpart to /api/checkout for multi-item shopping cart purchases.
 * Accepts an array of CartItem and creates ONE Stripe checkout session
 * with one Stripe line item per cart entry, then writes a webhook-friendly
 * metadata payload that the existing webhook handler decodes.
 *
 * The pure validation + metadata-encoding logic lives in
 * `$lib/server/cartCheckoutHelpers` so the unit tests can import them
 * directly. SvelteKit `+server.ts` files only allow specific named
 * exports (HTTP method handlers + underscore-prefixed names), so any
 * exported helper would have to live behind an underscore prefix —
 * extracting them to a normal module is cleaner.
 *
 * Coupon support is intentionally OUT OF SCOPE for v1 of the cart
 * checkout. The legacy single-product flow has per-product coupon
 * validation that doesn't translate cleanly to multi-item carts. We'll
 * add cart-level coupons in a follow-up once the basic flow is in
 * production.
 *
 * Print sets in the cart are also OUT OF SCOPE for PR C — `validateCart`
 * explicitly rejects them. PR E will rework the print set flow to
 * convert sets into cart line items.
 */

import { error, json } from "@sveltejs/kit";
import type Stripe from "stripe";
import { PUBLIC_SITE_URL } from "$env/static/public";
import { client as sanityClient } from "$lib/sanity/client";
import { buildCartMetadata, validateCart } from "$lib/server/cartCheckoutHelpers";
import { bindCheckoutSession } from "$lib/server/checkoutBinding";
import { resolveCheckoutItem } from "$lib/server/checkoutCatalog";
import { getStripe } from "$lib/server/stripeClient";
import type { CartItem } from "$lib/shop/cart";

interface CartCheckoutRequest {
	items: CartItem[];
}

export async function POST({ request, cookies }) {
	const stripe = getStripe();
	try {
		const body = (await request.json()) as CartCheckoutRequest;
		const { items } = body;

		const validationError = validateCart(items);
		if (validationError) {
			throw error(400, validationError);
		}

		const resolvedItems = await Promise.all(
			items.map(async (item) => {
				const resolved = await resolveCheckoutItem(sanityClient.fetch.bind(sanityClient), {
					productId: item.productSlug,
					isPrintSet: item.type === "set",
					paperSlug: item.paperSlug,
					sizeSlug: item.sizeSlug,
					paperIndex: item.paperIndex,
					borderWidth: item.borderWidthValue ?? item.borderWidth?.toString(),
					frame: item.frameValue,
				});
				return {
					...item,
					title: resolved.title,
					imageUrl: resolved.image ?? "",
					imageUrls: resolved.isPrintSet ? resolved.images : undefined,
					paperName: resolved.paper?.name,
					paperSubcategoryId: resolved.paper?.subcategoryId,
					paperWidth: resolved.paper?.width,
					paperHeight: resolved.paper?.height,
					borderWidth: resolved.paper?.borderWidth,
					frameSubcategoryId: resolved.paper?.frameSubcategoryId,
					canvasSubcategoryId: resolved.paper?.canvasSubcategoryId,
					canvasWrapHex: resolved.paper?.canvasWrapHex,
					unitPriceCents: Math.round(resolved.price * 100),
				} satisfies CartItem;
			}),
		);

		const resolvedValidationError = validateCart(resolvedItems);
		if (resolvedValidationError) {
			throw error(400, resolvedValidationError);
		}

		// Build one Stripe line item per cart entry. Stripe expects each
		// line item with its own price_data and quantity — perfect for
		// our shape after the server resolves current catalog prices.
		// Non-print merch (no paper info) gets a simpler product name with
		// no paper/size suffix.
		const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = resolvedItems.map((item) => {
			const hasPaper = typeof item.paperSubcategoryId === "number";
			const name = hasPaper
				? `${item.title} — ${item.paperName}, ${item.paperWidth}×${item.paperHeight}`
				: item.title;
			return {
				price_data: {
					currency: "usd",
					product_data: {
						name,
						images: item.imageUrl ? [item.imageUrl] : [],
					},
					unit_amount: item.unitPriceCents,
				},
				quantity: item.quantity,
			};
		});

		const session = await stripe.checkout.sessions.create({
			payment_method_types: ["card"],
			// Cart purchases are physical prints (sets and digital deferred
			// to later PRs), so we always collect shipping for now.
			shipping_address_collection: { allowed_countries: ["US"] },
			line_items: lineItems,
			mode: "payment",
			success_url: `${PUBLIC_SITE_URL}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
			cancel_url: `${PUBLIC_SITE_URL}/checkout/cancel`,
			metadata: buildCartMetadata(resolvedItems),
		});

		// Bind this browser to the session so /checkout/success can verify
		// the caller is the buyer before returning customer PII (audit H30).
		bindCheckoutSession(cookies, session.id);

		return json({ sessionId: session.id, url: session.url });
	} catch (err: unknown) {
		// Re-throw SvelteKit-shaped errors so the 4xx status survives
		if (err && typeof err === "object" && "status" in err) throw err;
		const message = err instanceof Error ? err.message : "unknown error";
		console.error("Cart checkout error:", message);
		throw error(500, message || "Failed to create cart checkout session");
	}
}
