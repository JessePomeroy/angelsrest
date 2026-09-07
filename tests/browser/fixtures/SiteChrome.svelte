<script lang="ts">
import PrintHarness from "./PrintHarness.svelte";
import { page } from "./state.svelte";
const purchase = new URLSearchParams(window.location.search).has("purchase");
if (purchase) page.url = new URL("http://127.0.0.1:5196/shop/fixture");

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
  {#if purchase}
    <PrintHarness />
  {:else}
  <h1>Fixture page</h1>
  <p>Public content keeps its width, spacing and keyboard entry point.</p>
  {/if}
</Layout>
