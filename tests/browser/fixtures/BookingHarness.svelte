<script lang="ts">
import BookingButton from "../../../src/lib/components/BookingButton.svelte";
let enabled = $state(false);
</script>
<button type="button" onclick={() => enabled = !enabled}>{enabled ? "Disable booking" : "Enable booking"}</button>
{#if enabled}<BookingButton calLink="fixture/photos" label="Book a session" />{/if}
