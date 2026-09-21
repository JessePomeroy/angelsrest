<script lang="ts">
import LumaPrintsSetupPage from "$lib/components/LumaPrintsSetupPage.svelte";
let { data, form } = $props();
</script>

{#key data.supplierSetup.siteUrl}
	<LumaPrintsSetupPage data={data.supplierSetup} {form} />
{/key}
