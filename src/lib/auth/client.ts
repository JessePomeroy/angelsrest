import { convexClient } from "@convex-dev/better-auth/client/plugins";
import { createAuthClient } from "better-auth/svelte";

// Audit H29: lazy-init the auth client so `window.location.origin` is only
// evaluated on first use in the browser. Eager construction at module load
// time caused SSR to fall back to `http://localhost`, which then baked a
// bad baseURL into the client for any pre-hydration code path.
let _client: ReturnType<typeof createAuthClient> | null = null;

export const authClient = new Proxy({} as ReturnType<typeof createAuthClient>, {
	get(_, prop) {
		if (!_client) {
			_client = createAuthClient({
				baseURL: window.location.origin,
				plugins: [convexClient()],
			});
		}
		// Proxy trap intentionally widens to property-access on the lazy client.
		return (_client as Record<string | symbol, unknown>)[prop as string | symbol];
	},
});
