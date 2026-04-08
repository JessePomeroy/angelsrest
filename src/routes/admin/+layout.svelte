<script lang="ts">
import { AdminLayout, setAdminConfig } from "@jessepomeroy/admin";
import { setupConvex } from "convex-svelte";
import { PUBLIC_CONVEX_URL } from "$env/static/public";
import { adminConfig } from "$lib/config/admin";

setupConvex(PUBLIC_CONVEX_URL);
setAdminConfig(adminConfig);

let { data, children } = $props();
</script>

<AdminLayout {data}>
	{@render children()}
</AdminLayout>
