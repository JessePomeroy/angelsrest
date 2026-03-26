/**
 * Digital Download Endpoint
 *
 * Securely serves digital product files after verifying payment.
 * The Sanity file URL is never exposed to the client.
 *
 * GET /api/download?session_id=cs_xxx&slug=product-slug
 */

import { error } from "@sveltejs/kit";
import Stripe from "stripe";
import { STRIPE_SECRET_KEY } from "$env/static/private";
import { client } from "$lib/sanity/client";

const stripe = new Stripe(STRIPE_SECRET_KEY);

export async function GET({ url }) {
	const sessionId = url.searchParams.get("session_id");
	const slug = url.searchParams.get("slug");

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

	// Fetch the file from Sanity CDN and stream it to the buyer
	const fileResponse = await fetch(product.fileUrl);

	if (!fileResponse.ok) {
		console.error("Failed to fetch file from Sanity:", fileResponse.status);
		throw error(500, "Failed to retrieve file");
	}

	const blob = await fileResponse.blob();

	return new Response(blob, {
		headers: {
			"Content-Type": "application/zip",
			"Content-Disposition": `attachment; filename="${slug}.zip"`,
			"Cache-Control": "no-store",
		},
	});
}
