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

<footer class="site-footer">
	<p>&copy; {year} {siteName}</p>
	{#if socialLinks.length > 0}
		<div class="social-links">
			{#each socialLinks as link (link.url)}
				<a
					href={link.url}
					target="_blank"
					rel="noopener noreferrer"
					class="social-link"
				>
					{link.platform}
				</a>
			{/each}
		</div>
	{/if}
</footer>

<style>
	.site-footer {
		display: none;
		width: min(calc(100% - 5rem), 1320px);
		min-height: 64px;
		margin-inline: auto;
		padding-block: 20px;
		align-items: center;
		justify-content: space-between;
		border-top: 1px solid color-mix(in srgb, currentColor 14%, transparent);
		color: color-mix(in srgb, currentColor 58%, transparent);
		font-size: 0.68rem;
		letter-spacing: 0.12em;
	}

	.social-links { display: flex; gap: 1.25rem; }
	.social-link { color: inherit; }

	@media (min-width: 768px) {
		.site-footer { display: flex; }
	}
</style>
