import { json } from "@sveltejs/kit";
import { env } from "$env/dynamic/private";
import { PUBLIC_SITE_URL } from "$env/static/public";
import { client } from "$lib/sanity/client";
import { ApiErrorCode, apiError } from "$lib/server/apiError";
import { bindCheckoutSession } from "$lib/server/checkoutBinding";
import { isCheckoutSnapshotReservationConflict } from "$lib/server/checkoutSnapshotReservationClient";
import { createDirectCheckoutSession } from "$lib/server/directCheckout";
import { checkoutSnapshotMode, validateCheckoutAttemptRequest } from "$lib/server/handleCheckout";
import { logStructured } from "$lib/server/logger";
import { getStripe } from "$lib/server/stripeClient";
import { resolveStripeTenantForSite } from "$lib/server/stripeTenant";

export async function POST({ request, cookies }) {
	const stripe = getStripe();
	const mode = checkoutSnapshotMode(env.CHECKOUT_SNAPSHOT_MODE);
	try {
		const rawBody = await request.json();
		if (mode === "handle-v2") {
			validateCheckoutAttemptRequest(rawBody?.attempt, rawBody?.attemptStartedAt);
		}
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
		if (isCheckoutSnapshotReservationConflict(err)) {
			throw apiError(409, ApiErrorCode.CHECKOUT_ATTEMPT_REJECTED, "Checkout attempt rejected");
		}
		if (err && typeof err === "object" && "status" in err && (mode === "legacy" || "body" in err))
			throw err;
		if (mode === "handle-v2") {
			logStructured({ event: "checkout.failed", level: "error", stage: "stripe_session_create" });
			throw apiError(500, ApiErrorCode.UPSTREAM_FAILED, "Checkout failed. Please try again.");
		}

		logStructured({
			event: "checkout.failed",
			level: "error",
			stage: "stripe_session_create",
			error: err,
		});

		throw apiError(500, ApiErrorCode.UPSTREAM_FAILED, "Checkout failed. Please try again.");
	}
}
