import { json, type RequestHandler } from "@sveltejs/kit";
import { ConvexHttpClient } from "convex/browser";
import { api } from "$convex/api";
import { env as publicEnv } from "$env/dynamic/public";
import { requireAuth } from "$lib/server/adminAuth";

/**
 * Universal admin mutation proxy.
 *
 * The browser Convex WebSocket in this app is intentionally unauthenticated
 * (see `src/routes/admin/+layout.svelte` for why — `createSvelteAuthClient`
 * has a WebSocket-pause bug on SvelteKit client-side nav under
 * `better-auth@1.5.x`). Without auth on the socket, every admin mutation
 * fails on the backend's `requireAuth`/`requireSiteAdmin` checks.
 *
 * This endpoint bridges the gap: the admin-dashboard package's
 * `useAdminClient()` (when its `mutationTransport` is `"http"`) forwards
 * every `client.mutation(...)` call here as `POST { name, args }`. We
 * validate the Better Auth cookie, attach the token to a *fresh* Convex
 * HTTP client (not the process-wide singleton — avoids `setAuth` races
 * between concurrent requests), and forward the call. The mutation then
 * runs inside Convex with the caller's identity, as if the WebSocket had
 * been authenticated.
 *
 * Security posture:
 *   - We blind-forward any `name` the client sends — but Convex itself
 *     still enforces `requireAuth`/`requireSiteAdmin` on the forwarded
 *     call, so this does not grant extra permissions. Any mutation the
 *     user could have called over an authenticated WebSocket they can
 *     call here, and only those.
 *   - `requireAuth()` rejects stale/forged tokens via `adminAuth.whoami`
 *     *before* we attach the token to the HTTP client, so unauthenticated
 *     callers 401 out with no Convex round-trip for the mutation itself.
 *
 * Error shape: `{ error: string }` with a non-200 status. The
 * `useAdminClient` proxy throws `new Error(error)` on the consumer side,
 * matching the shape that Convex's WebSocket mutations throw.
 */
export const POST: RequestHandler = async ({ request, cookies }) => {
	// Throws 401 if the Better Auth cookie is missing or invalid.
	const token = await requireAuth(cookies);

	let payload: { name?: unknown; args?: unknown };
	try {
		payload = await request.json();
	} catch {
		return json({ error: "Invalid JSON body" }, { status: 400 });
	}
	const { name, args } = payload;
	if (typeof name !== "string" || !name.includes(":")) {
		return json(
			{ error: "`name` must be a Convex function name like 'module:function'" },
			{ status: 400 },
		);
	}

	// "kanban:moveCard" → api.kanban.moveCard. Dotted sub-paths are not
	// currently used by Convex's function-name format, but we split on `:`
	// only (the first segment is the module, the second is the function).
	const [module, fn] = name.split(":");
	const modRef = (api as unknown as Record<string, Record<string, unknown>>)[module];
	const fnRef = modRef?.[fn];
	if (!fnRef) {
		return json({ error: `Unknown mutation: ${name}` }, { status: 400 });
	}

	const convexUrl = publicEnv.PUBLIC_CONVEX_URL;
	if (!convexUrl) {
		return json({ error: "Convex URL not configured" }, { status: 500 });
	}

	// Fresh client per request — `setAuth` mutates client state, so a
	// process-wide singleton would let one request's token leak into a
	// concurrent request. Per-request instance sidesteps it entirely.
	const client = new ConvexHttpClient(convexUrl);
	client.setAuth(token);

	try {
		const result = await client.mutation(fnRef as any, args as any);
		return json({ result });
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return json({ error: message }, { status: 500 });
	}
};
