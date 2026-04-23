<script lang="ts">
import { onMount } from "svelte";

let { siteSettings }: { siteSettings?: any } = $props();

const siteName = $derived(
	siteSettings?.siteTitle?.toLowerCase() || "angelsrest",
);
const socialLinks = $derived(siteSettings?.socialLinks || []);

// Audit L6: `new Date().getFullYear()` inlined in the template caused a
// potential SSR/hydration mismatch across a midnight/new-year boundary
// (server renders year N, client hydrates year N+1). Pick a static year
// for SSR and let the client bump it to the live value inside onMount.
let year = $state(new Date().getFullYear());
onMount(() => {
	year = new Date().getFullYear();
});
</script>

<footer
	class="hidden md:block py-6 px-8 text-center text-surface-400 text-xs tracking-wider border-t border-surface-500/20 max-w-350 mx-auto"
>
	{#if socialLinks.length > 0}
		<div class="flex justify-center gap-4 mb-3">
			{#each socialLinks as link (link.url)}
				<a
					href={link.url}
					target="_blank"
					rel="noopener noreferrer"
					class="hover:text-surface-200 transition-colors"
				>
					{link.platform}
				</a>
			{/each}
		</div>
	{/if}
	<p>&copy; {year} {siteName}</p>
</footer>
