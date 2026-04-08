<script lang="ts">
import { AdminLayout, AuthGuard, setAdminConfig, type AdminAuthClient } from "@jessepomeroy/admin";
import { setupConvex } from "convex-svelte";
import { PUBLIC_CONVEX_URL } from "$env/static/public";
import { adminConfig } from "$lib/config/admin";
import { authClient } from "$lib/auth/client";

setupConvex(PUBLIC_CONVEX_URL);
setAdminConfig({ ...adminConfig, authClient: authClient as unknown as AdminAuthClient });

let { data, children } = $props();
</script>

<AuthGuard>
	<AdminLayout {data}>
		{@render children()}
	</AdminLayout>
</AuthGuard>
