import { adminTokenHandler } from "$lib/server/adminAuth";

/**
 * Expose the Better Auth JWT to the browser so the Convex WebSocket can
 * authenticate. See `src/routes/admin/+layout.svelte` for the consumer —
 * `setupAuth()` calls `fetchAccessToken` whenever the Convex client needs
 * a token, and that callback fetches this endpoint.
 *
 * Admin `useQuery()` calls require Convex auth. Providing the token directly to
 * `setupAuth` avoids the historical navigation pause caused by subscribing
 * through `createSvelteAuthClient` while keeping queries authenticated.
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
export const GET = adminTokenHandler;
