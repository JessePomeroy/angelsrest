<script lang="ts">
import CommerceIntakeStatus from "$lib/components/CommerceIntakeStatus.svelte";
let { data, form } = $props();
</script>

<svelte:head><title>Background intake · platform</title></svelte:head>
<CommerceIntakeStatus view={data.intake} message={form?.message} />
