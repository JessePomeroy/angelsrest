<script lang="ts">
import Product from "../../../src/routes/shop/[slug]/+page.svelte";
import PrintSet from "../../../src/routes/shop/sets/[slug]/+page.svelte";
import { cart } from "../../../src/lib/shop/cart.svelte";
import { deliveryData, preview, printSetData } from "./data";

const kind = new URLSearchParams(window.location.search).get("kind") ?? "product";
let scenario = $state("original");
const variants = $derived(scenario === "empty" ? [] : scenario === "other"
	? [{ paper: "glossy", size: "5x7", retailPrice: 18 }]
	: [
		{ paper: "archival-matte", size: "8x10", retailPrice: 25 },
		{ paper: "archival-matte", size: "11x14", retailPrice: 35 },
		{ paper: "archival-matte", size: "40x60", retailPrice: 150 },
		{ paper: "canvas-black-0.75", size: "16x20", retailPrice: 80 },
	]);
const options = $derived({
	variants,
	bordersEnabled: scenario !== "no-finishes",
	framedEnabled: scenario !== "no-frames",
	frameMarkupMultiplier: 1,
	inStock: scenario !== "sold-out",
});
const productData = $derived({
	siteSettings: deliveryData.siteSettings,
	productType: "v2",
	product: {
		...options, title: "Fixture product", slug: `fixture-product-${scenario}`,
		description: "Fixture selection", featured: false,
		images: [{ full: preview, thumbnail: preview, original: preview, alt: "Fixture product" }],
	},
} satisfies import("../../../src/routes/shop/[slug]/$types").PageData);
const setData = $derived({
	...printSetData,
	printSet: { ...printSetData.printSet, ...options, slug: `fixture-set-${scenario}` },
} satisfies import("../../../src/routes/shop/sets/[slug]/$types").PageData);
</script>

<nav aria-label="Fixture scenarios">
	{#each ["original", "other", "empty", "no-finishes", "no-frames", "sold-out"] as value}
		<button type="button" onclick={() => scenario = value}>{value}</button>
	{/each}
</nav>
{#if kind === "product" || kind === "both"}
	<section aria-label="Product"><Product data={productData} /></section>
{/if}
{#if kind === "set" || kind === "both"}
	<section aria-label="Print set"><PrintSet data={setData} /></section>
{/if}
<output aria-label="Cart payload" style="display: block; overflow-wrap: anywhere;">{JSON.stringify(cart.items)}</output>
