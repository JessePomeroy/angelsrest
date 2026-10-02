<script lang="ts">
import PrintHarness from "./PrintHarness.svelte";
import ContentHarness from "./ContentHarness.svelte";
import ShopHarness from "./ShopHarness.svelte";
import ProductHarness from "./ProductHarness.svelte";
import { navigating, page } from "./state.svelte";
const params = new URLSearchParams(window.location.search);
const purchase = params.has("purchase");
const surface = params.get("surface");
if (purchase) page.url = new URL("http://127.0.0.1:5196/shop/fixture");
if (surface) page.url = new URL(surface === "portfolio" ? "/gallery/fixture" : "/shop", page.url);

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
  {#if surface === "portfolio"}
    <ContentHarness />
  {:else if surface === "shop"}
    <ShopHarness />
  {:else if surface === "product"}
    <ProductHarness />
  {:else if purchase}
    <PrintHarness />
  {:else}
  <h1>Fixture page</h1>
  <p>Public content keeps its width, spacing and keyboard entry point.</p>
  <button type="button" onclick={() => navigating.to = { url: new URL("/gallery", page.url) }}>Start pending navigation</button>
  <button type="button" onclick={() => navigating.to = null}>Finish pending navigation</button>
  {/if}
</Layout>
