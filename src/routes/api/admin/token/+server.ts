import { getToken } from "@mmailaender/convex-better-auth-svelte/sveltekit";
import { json, type RequestHandler } from "@sveltejs/kit";

/**
 * Expose the Better Auth JWT to the browser so the Convex WebSocket can
 * authenticate. See `src/routes/admin/+layout.svelte` for the consumer —
 * `setupAuth()` calls `fetchAccessToken` whenever the Convex client needs
 * a token, and that callback fetches this endpoint.
 *
 * Why this exists: admin `useQuery()` calls (kanban, crm, quotes, etc.)
 * call `requireAuth(ctx)` on the Convex side. Before this endpoint, the
 * browser WebSocket was unauthenticated (sidestepping the
 * `createSvelteAuthClient` pause bug), so those queries all returned
 * "Not authenticated" and every admin list rendered empty. Providing
 * the token directly to `setupAuth` — instead of subscribing through
 * `authClient.useSession()` — gets authed queries back without
 * re-introducing the pause.
 *
 * Why it's safe to hand the JWT to the browser: Convex auth is
 * token-based. To authenticate a WebSocket, the token has to be in JS
 * memory anyway — this is how every Convex client works, including
 * `createSvelteAuthClient`. The HttpOnly cookie is still the primary
 * store; we're only exposing a copy at the request of the Convex
 * client. Better Auth rotates the token on cookie refresh and Convex
 * rejects expired/tampered tokens via its JWT verifier.
 *
 * Returns 401 with `{ error }` when no cookie is present. The
 * `fetchAccessToken` callback in `+layout.svelte` should translate that
 * to `null` so the Convex client enters unauthenticated mode cleanly.
 */
export const GET: RequestHandler = async ({ cookies }) => {
	const token = getToken(cookies);
	if (!token) {
		return json({ error: "Unauthorized" }, { status: 401 });
	}
	return json({ token });
};
