<script lang="ts">
import ClientPrintRefundPage from "$lib/components/ClientPrintRefundPage.svelte";
import type { PageProps } from "./$types";
let { data, form }: PageProps = $props();
</script>
{#key `${data.siteUrl}:${data.page?.selected?.id}:${data.requestToken}`}
	<ClientPrintRefundPage {data} {form} />
{/key}
