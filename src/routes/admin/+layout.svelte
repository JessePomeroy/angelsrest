<script lang="ts">
import {
	AdminLayout,
	AuthGuard,
	setAdminConfig,
} from "@jessepomeroy/admin";
import { setupConvex } from "@mmailaender/convex-svelte";
import { PUBLIC_CONVEX_URL } from "$env/static/public";
import { authClient } from "$lib/auth/client";
import { adminConfig } from "$lib/config/admin";

// Set up Convex client without auth — admin queries use siteUrl, not auth
// tokens, so tying the WebSocket to the Better Auth session lifecycle is
// unnecessary and causes the socket to pause during SvelteKit navigation.
setupConvex(PUBLIC_CONVEX_URL);
setAdminConfig({
	...adminConfig,
	authClient,
});

let { data, children } = $props();
</script>

<AuthGuard>
	<AdminLayout {data}>
		{@render children()}
	</AdminLayout>
</AuthGuard>
