import { isPrivateCapabilityResponsePath } from "$lib/capabilityPrivacy";

/** Apply privacy and cache controls to bearer-capability page/action responses. */
export function applyCapabilityResponsePrivacy(headers: Headers, pathname: string) {
	if (!isPrivateCapabilityResponsePath(pathname)) return;
	headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
	// Stripe setup uses a session, not a bearer URL. Native form posts need the
	// same-origin policy to retain Origin for CSRF checks; external links stay private.
	headers.set(
		"Referrer-Policy",
		pathname.startsWith("/portal/stripe/") ? "same-origin" : "no-referrer",
	);
	headers.set("Cache-Control", "private, no-store");
}
