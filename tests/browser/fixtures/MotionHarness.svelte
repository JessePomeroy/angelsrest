<script lang="ts">
import GrainOverlay from "../../../src/lib/components/GrainOverlay.svelte";
import GradientBackground from "../../../src/lib/components/GradientBackground.svelte";
import AsciiImage from "../../../src/lib/components/AsciiImage.svelte";
const kind = new URLSearchParams(window.location.search).get("kind") ?? "all";
const preview = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="24"><rect width="32" height="24" fill="#789abc"/></svg>');
let mounted = $state(true);
</script>

<button type="button" onclick={() => mounted = !mounted}>{mounted ? "Unmount motion" : "Mount motion"}</button>
{#if mounted}
	{#if kind === "all" || kind === "grain"}<GrainOverlay />{/if}
	{#if kind === "all" || kind === "gradient"}<GradientBackground />{/if}
	{#if kind === "all" || kind === "ascii"}<AsciiImage src={preview} alt="Motion fixture" class="w-32 h-24" />{/if}
{/if}
