import type { Cookies } from "@sveltejs/kit";
import { dev } from "$app/environment";

const COOKIE_NAME = "ar_checkout_sid";
const MAX_AGE_SECONDS = 60 * 60; // 1 hour

export function bindCheckoutSession(cookies: Cookies, sessionId: string): void {
	cookies.set(COOKIE_NAME, sessionId, {
		path: "/",
		httpOnly: true,
		sameSite: "lax",
		secure: !dev,
		maxAge: MAX_AGE_SECONDS,
	});
}

export function isCheckoutSessionOwner(
	cookies: Cookies,
	sessionId: string | null | undefined,
): boolean {
	if (!sessionId) return false;
	const bound = cookies.get(COOKIE_NAME);
	return Boolean(bound) && bound === sessionId;
}

export function clearCheckoutSession(cookies: Cookies): void {
	cookies.delete(COOKIE_NAME, { path: "/" });
}
