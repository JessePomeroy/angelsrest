/**
 * Checkout session binding (audit H30).
 *
 * The `/checkout/success` page used to return full customer PII (name,
 * email, shipping address) keyed only on the `session_id` query param.
 * Anyone who saw a session_id — in a server log, a referrer header, over
 * a shoulder — could view those details. There was no verification that
 * the caller was the buyer.
 *
 * We fix this by binding the Stripe session to the buyer's browser via
 * an httpOnly cookie set when the checkout session is created. The
 * success page requires that cookie to match the `session_id` in the
 * URL; otherwise it returns a minimal success state (no PII).
 *
 * The cookie is:
 *   - httpOnly (JS can't read it)
 *   - sameSite=lax (survives the top-level redirect back from Stripe)
 *   - secure in production
 *   - 1h max-age (enough for the immediate redirect back; returning
 *     users go through `/orders` lookup instead)
 *   - scoped to the site root so the checkout success page can read it
 */

import type { Cookies } from "@sveltejs/kit";
import { dev } from "$app/environment";

const COOKIE_NAME = "ar_checkout_sid";
const MAX_AGE_SECONDS = 60 * 60; // 1 hour

/**
 * Mark the caller's browser as the buyer for this Stripe checkout session.
 * Called once at the moment the SvelteKit checkout endpoint creates a
 * Stripe session, before returning the Stripe-hosted URL to the client.
 */
export function bindCheckoutSession(cookies: Cookies, sessionId: string): void {
	cookies.set(COOKIE_NAME, sessionId, {
		path: "/",
		httpOnly: true,
		sameSite: "lax",
		secure: !dev,
		maxAge: MAX_AGE_SECONDS,
	});
}

/**
 * Verify the caller's browser is the buyer for this Stripe checkout
 * session. Called by the `/checkout/success` page loader before it
 * decides whether to fetch and return PII from Stripe.
 *
 * Returns `true` only when the cookie is present AND equals the URL's
 * `session_id`. No cookie → false. Mismatched cookie → false. Works
 * with `sameSite=lax` through the Stripe-hosted redirect because the
 * browser treats the redirect as a top-level navigation to our origin.
 */
export function isCheckoutSessionOwner(
	cookies: Cookies,
	sessionId: string | null | undefined,
): boolean {
	if (!sessionId) return false;
	const bound = cookies.get(COOKIE_NAME);
	return Boolean(bound) && bound === sessionId;
}

/**
 * Clear the binding cookie once the buyer has landed on the success
 * page. Keeps the cookie short-lived and prevents replay if the same
 * machine is later used by someone else who has the session_id.
 */
export function clearCheckoutSession(cookies: Cookies): void {
	cookies.delete(COOKIE_NAME, { path: "/" });
}
