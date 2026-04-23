<script lang="ts">
import { GalleriesPage } from "@jessepomeroy/admin";
import { page } from "$app/state";

let { data } = $props();

let activeTab = $derived(
	(page.url.searchParams.get("tab") as "portfolio" | "delivery") ??
		"portfolio",
);
</script>

<GalleriesPage {data} {activeTab} />
