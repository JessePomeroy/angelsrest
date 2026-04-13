<script lang="ts">
import {
	AdminLayout,
	AuthGuard,
	setAdminConfig,
} from "@jessepomeroy/admin";
import { createSvelteAuthClient } from "@mmailaender/convex-better-auth-svelte/svelte";
import { PUBLIC_CONVEX_URL } from "$env/static/public";
import { authClient } from "$lib/auth/client";
import { adminConfig } from "$lib/config/admin";

createSvelteAuthClient({ authClient, convexUrl: PUBLIC_CONVEX_URL });
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
