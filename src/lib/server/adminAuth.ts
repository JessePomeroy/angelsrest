import { getToken } from "@mmailaender/convex-better-auth-svelte/sveltekit";
import type { Cookies } from "@sveltejs/kit";
import { error } from "@sveltejs/kit";
import { ConvexHttpClient } from "convex/browser";
import { api } from "$convex/api";
import { env as publicEnv } from "$env/dynamic/public";

/**
 * Verify the request has a valid Better Auth session.
 *
 * Audit H3: previously this only checked cookie presence, meaning any stale
 * / forged cookie that parsed as a token passed through. Now it validates
 * the token against Convex via `api.adminAuth.whoami` — Convex parses the
 * JWT with its configured public key and returns null if it's expired or
 * tampered with. If that check fails, we throw 401 here.
 *
 * Throws 401 if:
 *   - no cookie is present
 *   - the cookie is present but Convex rejects it
 *   - the Convex call itself throws (fail-closed)
 *
 * Returns the validated session token. Callers that need the identity
 * (email, subject, etc.) should use `requireAuthWithIdentity` instead.
 */
export async function requireAuth(cookies: Cookies): Promise<string> {
	const { token } = await requireAuthWithIdentity(cookies);
	return token;
}

/**
 * Same as `requireAuth` but also returns the resolved identity. Prefer this
 * when the caller needs the user's email or subject for logging or further
 * authorization checks.
 */
export async function requireAuthWithIdentity(cookies: Cookies): Promise<{
	token: string;
	identity: { email: string | null; name: string | null; subject: string };
}> {
	const token = getToken(cookies);
	if (!token) {
		throw error(401, "Unauthorized");
	}
	const convexUrl = publicEnv.PUBLIC_CONVEX_URL;
	if (!convexUrl) {
		// Misconfigured deployment — fail closed.
		throw error(500, "Auth backend not configured");
	}
	const client = new ConvexHttpClient(convexUrl);
	client.setAuth(token);
	try {
		const identity = await client.query(api.adminAuth.whoami, {});
		if (!identity) {
			throw error(401, "Unauthorized");
		}
		return { token, identity };
	} catch (err) {
		if (err && typeof err === "object" && "status" in err) throw err;
		throw error(401, "Unauthorized");
	}
}
