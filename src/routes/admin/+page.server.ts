import { api } from "$convex/api";
import { SITE_DOMAIN } from "$lib/config/site";
import { getConvex } from "$lib/server/convexClient";

const convex = getConvex();

export async function load({ parent, cookies }) {
	const { isAuthenticated } = await parent();
	// Skip the Convex query entirely for unauthenticated requests so we
	// don't leak the inquiry count (or burn a request on what would be a
	// 401 anyway). AuthGuard on the client renders the login form.
	if (!isAuthenticated) {
		return { newInquiryCount: 0 };
	}
	let newInquiryCount = 0;
	try {
		// Forward the Better Auth session cookie as a Convex token so the
		// `requireAuth` on `api.inquiries.countNew` sees the caller's
		// identity. Without this, the HTTP-client fetch has no auth header
		// and the query throws — caught below, but spammy in logs.
		const { getToken } = await import("@mmailaender/convex-better-auth-svelte/sveltekit");
		const token = getToken(cookies);
		if (token) convex.setAuth(token);
		newInquiryCount = await convex.query(api.inquiries.countNew, {
			siteUrl: SITE_DOMAIN,
		});
	} catch (err) {
		console.error("Failed to fetch inquiry count:", err);
	}

	return {
		newInquiryCount,
	};
}
