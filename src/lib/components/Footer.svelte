<script lang="ts">
let { siteSettings }: { siteSettings?: any } = $props();

const siteName = $derived(
	siteSettings?.siteTitle?.toLowerCase() || "angelsrest",
);
const socialLinks = $derived(siteSettings?.socialLinks || []);
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
	<p>&copy; {new Date().getFullYear()} {siteName}</p>
</footer>
