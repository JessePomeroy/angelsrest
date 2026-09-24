import { isPrivateCapabilityResponsePath } from "$lib/capabilityPrivacy";

/** Apply privacy and cache controls to portal and delivery responses. */
export function applyCapabilityResponsePrivacy(headers: Headers, pathname: string) {
	if (!isPrivateCapabilityResponsePath(pathname)) return;
	headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
	// Stripe setup and refunds use sessions, not bearer URLs. Native form posts need the
	// same-origin policy to retain Origin for CSRF checks; external links stay private.
	headers.set(
		"Referrer-Policy",
		/^\/portal\/(stripe|refunds)\//.test(pathname) ? "same-origin" : "no-referrer",
	);
	headers.set("Cache-Control", "private, no-store");
}
