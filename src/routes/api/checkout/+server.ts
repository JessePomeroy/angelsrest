import { json } from "@sveltejs/kit";
import { env } from "$env/dynamic/private";
import { PUBLIC_SITE_URL } from "$env/static/public";
import { client } from "$lib/sanity/client";
import { ApiErrorCode, apiError } from "$lib/server/apiError";
import { bindCheckoutSession } from "$lib/server/checkoutBinding";
import { isCheckoutSnapshotReservationConflict } from "$lib/server/checkoutSnapshotReservationClient";
import {
	assertNewOrderCheckoutOpen,
	NewOrderCheckoutClosedError,
} from "$lib/server/commercePurposeControls";
import { createDirectCheckoutSession, rejectCouponAttempt } from "$lib/server/directCheckout";
import {
	checkoutSnapshotMode,
	validateSameOriginCheckoutAttemptRequest,
} from "$lib/server/handleCheckout";
import { logStructured } from "$lib/server/logger";
import { getStripe } from "$lib/server/stripeClient";
import { resolveStripeTenantForSite } from "$lib/server/stripeTenant";

export async function POST({ request, cookies }) {
	const mode = checkoutSnapshotMode(env.CHECKOUT_SNAPSHOT_MODE);
	try {
		const rawBody = await request.json();
		rejectCouponAttempt(rawBody);
		const control = assertNewOrderCheckoutOpen(PUBLIC_SITE_URL);
		const attemptIdentity = validateSameOriginCheckoutAttemptRequest(
			PUBLIC_SITE_URL,
			rawBody?.attempt,
			rawBody?.attemptStartedAt,
			rawBody?.attemptProof,
		);
		const stripe = getStripe();
		const tenant = await resolveStripeTenantForSite(PUBLIC_SITE_URL);
		const session = await createDirectCheckoutSession({
			body: rawBody,
			stripe,
			siteUrl: PUBLIC_SITE_URL,
			tenant,
			fetcher: client.fetch.bind(client),
			bindSession: (sessionId) => bindCheckoutSession(cookies, sessionId),
			attemptIdentity,
			hostGeneration: control.generation,
		});

		return json(session);
	} catch (err: unknown) {
		if (err instanceof NewOrderCheckoutClosedError) {
			throw apiError(503, ApiErrorCode.UNAVAILABLE, "Checkout is temporarily unavailable");
		}
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
