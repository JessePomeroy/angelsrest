<script lang="ts">
import {
	AdminLayout,
	AuthGuard,
	setAdminConfig,
} from "@jessepomeroy/admin";
import { setupAuth, setupConvex } from "@mmailaender/convex-svelte";
import { PUBLIC_CONVEX_URL } from "$env/static/public";
import { authClient } from "$lib/auth/client";
import { adminConfig } from "$lib/config/admin";

let { data, children } = $props();

// Authenticate the browser Convex WebSocket without re-introducing the
// `createSvelteAuthClient` pause bug.
//
// Background: `createSvelteAuthClient` subscribes to
// `authClient.useSession()` and feeds its output to `setupAuth`. On
// SvelteKit client-side nav, that subscription emits a transient
// `{data: null}` which the adapter races against a fixed 150ms timer;
// when `better-auth@1.5.3` re-settles past that window, the adapter
// calls `clearAuth()` and the WebSocket stays paused until a full
// reload. See
// `~/Documents/quilt/00_inbox/2026-04-23 PR candidate — convex-better-auth-svelte pause bug.md`.
//
// The fix here: call the lower-level `setupAuth` primitive directly,
// driven by `data.isAuthenticated` from `+layout.server.ts` instead of
// the flickery session subscription. `+layout.server.ts` re-runs on
// every navigation and re-validates the cookie via Convex's
// `adminAuth.whoami`, so the value stays stable across SPA nav (no
// transient nulls). `fetchAccessToken` hits `/api/admin/token` which
// reads the HttpOnly Better Auth cookie server-side and returns the
// JWT for the Convex client.
//
// With this wiring, authed `useQuery(...)` calls (kanban, crm,
// quotes, etc.) work over the reactive WebSocket again. Mutations
// continue through the `/api/admin/mutation` HTTP proxy — the
// duplication is intentional belt-and-suspenders, and keeps the
// mutation path cookie-only for defence-in-depth.
setupConvex(PUBLIC_CONVEX_URL);
setupAuth(() => ({
	isLoading: false,
	isAuthenticated: data.isAuthenticated,
	fetchAccessToken: async () => {
		const res = await fetch("/api/admin/token");
		if (!res.ok) return null;
		const { token } = await res.json();
		return (token as string | null | undefined) ?? null;
	},
}));

setAdminConfig({
	...adminConfig,
	authClient,
});
</script>

<AuthGuard>
	<AdminLayout {data}>
		{@render children()}
	</AdminLayout>
</AuthGuard>
