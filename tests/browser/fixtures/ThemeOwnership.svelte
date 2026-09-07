<script lang="ts">
import AdminLayout from "../../../node_modules/@jessepomeroy/admin/dist/components/AdminLayout.svelte";
import { setAdminConfig } from "../../../node_modules/@jessepomeroy/admin/dist/config.js";
import { adminConfig } from "../../../src/lib/config/admin";
import ThemeSwitcher from "../../../src/lib/components/ThemeSwitcher.svelte";

setAdminConfig({
	...adminConfig,
	siteUrl: "fixture.invalid",
	fromEmail: "fixture@example.invalid",
	galleryWorkerUrl: "http://127.0.0.1:5196",
	editor: undefined,
	api: { ...adminConfig.api, notifications: undefined },
});
let showAdmin = $state(false);
</script>

<div style="position: fixed; top: 80px; right: 8px; z-index: 100;">
	<ThemeSwitcher />
	<button type="button" onclick={() => showAdmin = !showAdmin}>
		{showAdmin ? "Return to public" : "Open Admin"}
	</button>
</div>
{#if showAdmin}
	<AdminLayout data={{ adminSession: { status: "unauthenticated" } }}><p>Fixture Admin content</p></AdminLayout>
{/if}
