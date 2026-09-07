<script lang="ts">
import Layout from "../../../src/routes/+layout.svelte";

const data = {
	siteSettings: {
		artistName: null,
		siteTitle: null,
		tagline: null,
		logoUrl: null,
		socialLinks: [],
		seo: { description: null, ogImageUrl: null, keywords: [] },
	},
};
</script>

<Layout {data} params={{}}>
  <h1>Fixture page</h1>
  <p>Public content keeps its width, spacing and keyboard entry point.</p>
</Layout>
