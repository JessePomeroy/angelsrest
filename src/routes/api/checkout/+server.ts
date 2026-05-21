import { json } from "@sveltejs/kit";
import { PUBLIC_SITE_URL } from "$env/static/public";
import { client } from "$lib/sanity/client";
import { ApiErrorCode, apiError } from "$lib/server/apiError";
import { bindCheckoutSession } from "$lib/server/checkoutBinding";
import { createDirectCheckoutSession } from "$lib/server/directCheckout";
import { logStructured } from "$lib/server/logger";
import { getStripe } from "$lib/server/stripeClient";
import { resolveStripeTenantForSite } from "$lib/server/stripeTenant";

export async function POST({ request, cookies }) {
	const stripe = getStripe();
	try {
		const rawBody = await request.json();
		const tenant = await resolveStripeTenantForSite(PUBLIC_SITE_URL);
		const session = await createDirectCheckoutSession({
			body: rawBody,
			stripe,
			siteUrl: PUBLIC_SITE_URL,
			tenant,
			fetcher: client.fetch.bind(client),
			bindSession: (sessionId) => bindCheckoutSession(cookies, sessionId),
		});

		return json(session);
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
