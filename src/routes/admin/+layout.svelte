<script lang="ts">
import {
	AdminLayout,
	AuthGuard,
	isTenantAdminServerAuthorized,
	LoadingState,
	setAdminConfig,
} from "@jessepomeroy/admin";
import { setupAuth, setupConvex } from "convex-svelte";
import { tick, untrack } from "svelte";
import { browser } from "$app/environment";
import { invalidateAll } from "$app/navigation";
import { PUBLIC_CONVEX_URL } from "$env/static/public";
import { authClient } from "$lib/auth/client";
import {
	shouldHoldAdminShellForServerSession,
	shouldRefreshAdminServerSession,
} from "$lib/adminServerSessionRecovery";
import { adminConfig } from "$lib/config/admin";

let { data, children } = $props();

type ExplicitSignOutState = "inactive" | "awaiting-session-clear" | "session-cleared";

let clientSessionPending = $state(Boolean(authClient));
let clientSessionEmail = $state<string | null>(null);
let explicitSignOutState = $state<ExplicitSignOutState>("inactive");
let serverSessionRefreshAttempted = $state(false);
let serverSessionRefreshInFlight = $state(false);

if (authClient) {
	const sessionStore = authClient.useSession();
	sessionStore.subscribe((val) => {
		clientSessionEmail = val?.data?.user?.email ?? null;
		clientSessionPending = val?.isPending ?? false;

		if (clientSessionPending) return;
		if (explicitSignOutState === "awaiting-session-clear" && !clientSessionEmail) {
			explicitSignOutState = "session-cleared";
		} else if (explicitSignOutState === "session-cleared" && clientSessionEmail) {
			explicitSignOutState = "inactive";
		}
	});
}

function signOutSucceeded(result: unknown) {
	if (!result || typeof result !== "object") return true;
	if ("error" in result && result.error !== null) return false;

	const payload = "data" in result ? result.data : result;
	return (
		!payload ||
		typeof payload !== "object" ||
		!("success" in payload) ||
		payload.success === true
	);
}

const signOut: typeof authClient.signOut = async (...args) => {
	const result = await authClient.signOut(...args);
	if (!signOutSucceeded(result)) return result;

	explicitSignOutState = "awaiting-session-clear";

	// Let setupAuth revoke the WebSocket before a server-session reload can
	// create more protected subscriptions. Neither follow-up can change the
	// successful Better Auth result into a rejected sign-out.
	await tick().catch(() => undefined);
	await invalidateAll().catch(() => undefined);
	return result;
};

// Better Auth exposes a Proxy-backed client. Proxy only signOut so all other
// methods, plugin fields, call signatures, and lazy initialization stay intact.
const adminAuthClient = new Proxy(authClient, {
	get(target, property, receiver) {
		if (property === "signOut") return signOut;
		return Reflect.get(target, property, receiver);
	},
});

let serverSessionAuthorized = $derived(
	isTenantAdminServerAuthorized(data.adminSession),
);
let shouldRecoverServerSession = $derived(
	shouldRefreshAdminServerSession({
		hasBrowser: browser,
		hasAuthClient: Boolean(authClient),
		sessionPending: clientSessionPending,
		sessionEmail: clientSessionEmail,
		serverAuthorized: serverSessionAuthorized,
		refreshAttempted: serverSessionRefreshAttempted,
		refreshInFlight: serverSessionRefreshInFlight,
	}),
);
let shouldHoldAdminShell = $derived(
	shouldHoldAdminShellForServerSession({
		hasAuthClient: Boolean(authClient),
		sessionPending: clientSessionPending,
		sessionEmail: clientSessionEmail,
		serverAuthorized: serverSessionAuthorized,
	}),
);

$effect(() => {
	if (!shouldRecoverServerSession) return;

	serverSessionRefreshAttempted = true;
	serverSessionRefreshInFlight = true;
	invalidateAll().finally(() => {
		serverSessionRefreshInFlight = false;
	});
});

$effect(() => {
	if (!clientSessionEmail) {
		serverSessionRefreshAttempted = false;
		serverSessionRefreshInFlight = false;
	}
});

// Authenticate the browser Convex WebSocket without re-introducing the
// `createSvelteAuthClient` pause bug.
//
// Background: `createSvelteAuthClient` subscribes to
// `authClient.useSession()` and feeds its output to `setupAuth`. On
// SvelteKit client-side nav, that subscription emits a transient
// `{data: null}` which the adapter races against a fixed 150ms timer;
// if the session re-settles past that window, the adapter calls
// `clearAuth()` and the WebSocket stays paused until a full reload.
//
// The fix here: call the lower-level `setupAuth` primitive directly,
// driven by `data.adminSession.status` from `+layout.server.ts` instead
// of the flickery session subscription. `+layout.server.ts` re-runs on
// every navigation and re-validates the cookie via Convex's
// `adminAuth.whoami`, so the value stays stable across SPA nav (no
// transient nulls). `fetchAccessToken` hits `/api/admin/token` which
// reads the HttpOnly Better Auth cookie server-side and returns the
// JWT for the Convex client.
//
// A successful signOut through the configured admin client is the only
// client-session event that overrides this server state. It suppresses the
// provider before invalidateAll reloads the server session; transient null
// session emissions do not affect Convex auth.
//
// With this wiring, authed `useQuery(...)` calls (kanban, crm,
// quotes, etc.) work over the reactive WebSocket again. Mutations
// continue through the `/api/admin/mutation` HTTP proxy — the
// duplication is intentional belt-and-suspenders, and keeps the
// mutation path cookie-only for defence-in-depth.
setupConvex(PUBLIC_CONVEX_URL);
setupAuth(
	() => ({
		isLoading: serverSessionRefreshInFlight,
		isAuthenticated:
			serverSessionAuthorized && explicitSignOutState === "inactive",
		fetchAccessToken: async () => {
			const res = await fetch("/api/admin/token");
			if (!res.ok) return null;
			const { token } = await res.json();
			return (token as string | null | undefined) ?? null;
		},
	}),
	{ initialState: { isAuthenticated: untrack(() => serverSessionAuthorized) } },
);

setAdminConfig({
	...adminConfig,
	authClient: adminAuthClient,
});
</script>

<AuthGuard>
	{#if shouldHoldAdminShell}
		<div class="admin-session-loading" data-admin>
			<LoadingState />
		</div>
	{:else}
		<AdminLayout {data}>
			{@render children()}
		</AdminLayout>
	{/if}
</AuthGuard>

<style>
	.admin-session-loading {
		min-height: 100vh;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--admin-bg);
	}
</style>
