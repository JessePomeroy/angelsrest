<script lang="ts">
import StickyMobileBar from "$lib/components/StickyMobileBar.svelte";
</script>
<div class="spacer">Content before the purchase bar</div>
<StickyMobileBar class="fixture-sticky" bottomOffset="24px">
  {#snippet children(isStuck)}
    <output aria-label="Sticky state">{isStuck ? "stuck" : "inline"}</output>
    <button type="button">Purchase fixture</button>
  {/snippet}
</StickyMobileBar>
<div class="spacer">Content after the purchase bar</div>
<style>.spacer { height: 900px; }</style>
