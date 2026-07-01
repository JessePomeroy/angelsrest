import { createAdminAuthValidator, createAdminTokenHandler } from "@jessepomeroy/admin/server";
import { getToken } from "@mmailaender/convex-better-auth-svelte/sveltekit";
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
export const adminAuth = createAdminAuthValidator({
	getToken,
	getConvexUrl: () => publicEnv.PUBLIC_CONVEX_URL,
	whoami: api.adminAuth.whoami,
});

export const { requireAuth, requireAuthWithIdentity } = adminAuth;
export const adminTokenHandler = createAdminTokenHandler({ getToken });
