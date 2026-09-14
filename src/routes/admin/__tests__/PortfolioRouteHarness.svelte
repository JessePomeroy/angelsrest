<script lang="ts">
import Route from "../editor/portfolio/[galleryId]/+page.svelte";

let data = $state({
	galleryId: "A",
	siteSettings: {
		artistName: "Test photographer",
		siteTitle: "Test portfolio",
		tagline: "Test photography",
		logoUrl: null,
		socialLinks: [],
		seo: { description: "Test portfolio", ogImageUrl: null, keywords: [] },
	},
	adminSession: {
		status: "authorized" as const,
		email: "creator@example.com",
		tier: "full" as const,
		isCreator: true,
	},
});

export function navigate(galleryId: string) {
	data = { ...data, galleryId };
}
</script>

<Route {data} />
