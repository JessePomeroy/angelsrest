import { json } from "@sveltejs/kit";
import { PUBLIC_SITE_URL } from "$env/static/public";
import { ApiErrorCode, apiError } from "$lib/server/apiError";
import { bindCheckoutSession } from "$lib/server/checkoutBinding";
import { runCheckoutSessionStage } from "$lib/server/checkoutFailures";
import { throwCheckoutRouteFailure } from "$lib/server/checkoutRouteFailure";
import { isCheckoutSnapshotReservationConflict } from "$lib/server/checkoutSnapshotReservationClient";
import {
	assertNewOrderCheckoutOpen,
	NewOrderCheckoutClosedError,
} from "$lib/server/commercePurposeControls";
import { createDirectCheckoutSession, rejectCouponAttempt } from "$lib/server/directCheckout";
import { validateSameOriginCheckoutAttemptRequest } from "$lib/server/handleCheckout";
import { getStripe } from "$lib/server/stripeClient";
import { resolveStripeTenantForSite } from "$lib/server/stripeTenant";

export async function POST({ request, cookies }) {
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
		const stripe = await runCheckoutSessionStage("checkout_stripe", () => getStripe());
		const tenant = await runCheckoutSessionStage("checkout_tenant", () =>
			resolveStripeTenantForSite(PUBLIC_SITE_URL),
		);
		const session = await createDirectCheckoutSession({
			body: rawBody,
			stripe,
			siteUrl: PUBLIC_SITE_URL,
			tenant,
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
		if (err && typeof err === "object" && "status" in err && "body" in err) throw err;
		throwCheckoutRouteFailure(err, "checkout");
	}
}
