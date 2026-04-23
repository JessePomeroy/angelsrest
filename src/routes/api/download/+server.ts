/**
 * Digital Download Endpoint
 *
 * Securely serves digital product files after verifying payment.
 * The Sanity file URL is never exposed to the client.
 *
 * GET /api/download?session_id=cs_xxx&slug=product-slug[&email=buyer@example.com]
 *
 * Audit H36 — the old version accepted `session_id` + `slug` alone. Anyone
 * who saw those values in a log, screenshot, or referrer header could
 * download the digital product for free. Now we require one of:
 *
 *   1. The httpOnly binding cookie set when the Stripe session was
 *      created — same mechanism as /checkout/success (audit H30).
 *   2. An `email` query param matching the Stripe session's customer
 *      email — so a buyer can re-download from a different device by
 *      clicking their own confirmation-email link.
 *
 * No cookie + no email match → 403.
 *
 * Audit H35 — response body is now streamed from the Sanity CDN directly
 * to the buyer instead of buffered via `.blob()`. Fixes OOM risk on large
 * (multi-GB) digital products.
 */

import { error } from "@sveltejs/kit";
import Stripe from "stripe";
import { STRIPE_SECRET_KEY } from "$env/static/private";
import { client } from "$lib/sanity/client";
import { isCheckoutSessionOwner } from "$lib/server/checkoutBinding";

const stripe = new Stripe(STRIPE_SECRET_KEY);

export async function GET({ url, cookies }) {
	const sessionId = url.searchParams.get("session_id");
	const slug = url.searchParams.get("slug");
	const emailParam = url.searchParams.get("email")?.toLowerCase();

	if (!sessionId || !slug) {
		throw error(400, "Missing session_id or slug");
	}

	// Verify the Stripe session is paid
	let session: Stripe.Checkout.Session;
	try {
		session = await stripe.checkout.sessions.retrieve(sessionId);
	} catch (err) {
		console.error("Failed to retrieve Stripe session:", err);
		throw error(400, "Invalid session");
	}

	if (session.payment_status !== "paid") {
		throw error(403, "Payment not completed");
	}

	// Verify the session was for this product
	if (session.metadata?.productSlug !== slug) {
		throw error(403, "Session does not match product");
	}

	// Verify this is a digital product
	if (session.metadata?.isDigital !== "true") {
		throw error(400, "This product is not a digital download");
	}

	// Audit H36: require proof of ownership. Either the cookie binding
	// from the buyer's own browser (immediate post-checkout path) OR an
	// `email` query param matching the Stripe session's customer email
	// (email-link path from any device).
	const cookieOwner = isCheckoutSessionOwner(cookies, sessionId);
	if (!cookieOwner) {
		const sessionEmail = session.customer_details?.email?.toLowerCase();
		if (!emailParam || !sessionEmail || emailParam !== sessionEmail) {
			throw error(
				403,
				"Access denied. To download, complete checkout in this browser or include your order email in the URL.",
			);
		}
	}

	// Fetch the digital file URL from Sanity
	const product = await client.fetch(
		`*[_type == "product" && slug.current == $slug][0]{
			"fileUrl": digitalFile.asset->url,
			title
		}`,
		{ slug },
	);

	if (!product?.fileUrl) {
		throw error(404, "Digital file not found");
	}

	// Fetch the file from Sanity CDN and stream it to the buyer.
	// Audit H35: stream the response body directly instead of buffering
	// via `.blob()`. For multi-hundred-MB digital products this avoids
	// holding the whole file in memory in the SvelteKit function.
	const fileResponse = await fetch(product.fileUrl);

	if (!fileResponse.ok || !fileResponse.body) {
		console.error("Failed to fetch file from Sanity:", fileResponse.status);
		throw error(500, "Failed to retrieve file");
	}

	const contentLength = fileResponse.headers.get("Content-Length");
	return new Response(fileResponse.body, {
		headers: {
			"Content-Type": fileResponse.headers.get("Content-Type") ?? "application/zip",
			"Content-Disposition": `attachment; filename="${slug}.zip"`,
			"Cache-Control": "no-store",
			// Forward Content-Length when the upstream provides it so
			// browsers can show accurate download progress.
			...(contentLength ? { "Content-Length": contentLength } : {}),
		},
	});
}
