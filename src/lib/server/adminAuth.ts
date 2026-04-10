import { getToken } from "@mmailaender/convex-better-auth-svelte/sveltekit";
import type { Cookies } from "@sveltejs/kit";
import { error } from "@sveltejs/kit";

/**
 * Verify the request has a valid Better Auth session.
 * Throws 401 if no session token is present.
 */
export function requireAuth(cookies: Cookies): string {
	const token = getToken(cookies);
	if (!token) {
		throw error(401, "Unauthorized");
	}
	return token;
}
