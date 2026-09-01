import { isPrivateCapabilityResponsePath } from "$lib/capabilityPrivacy";

/** Apply privacy and cache controls to bearer-capability page/action responses. */
export function applyCapabilityResponsePrivacy(headers: Headers, pathname: string) {
	if (!isPrivateCapabilityResponsePath(pathname)) return;
	headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
	headers.set("Referrer-Policy", "no-referrer");
	headers.set("Cache-Control", "private, no-store");
}
