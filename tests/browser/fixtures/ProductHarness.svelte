<script lang="ts">
import Product from "../../../src/routes/shop/[slug]/+page.svelte";
import { cart } from "../../../src/lib/shop/cart.svelte";
import { deliveryData, preview } from "./data";

let scenario = $state(new URLSearchParams(window.location.search).get("scenario") ?? "physical");
const productData = $derived({
  siteSettings: deliveryData.siteSettings,
  productType: "v1",
  product: {
    title: "Fixture merchandise", slug: `fixture-merch-${scenario}`,
    description: "A small collection of photographic keepsakes.",
    category: scenario === "digital" ? "digital" : "postcards",
    price: scenario === "unpriced" ? undefined : 12,
    inStock: scenario !== "sold-out", featured: false,
    images: scenario === "no-images" ? [] : [0, 1, 2].map(index => ({
      full: `${preview}#${index}`, thumbnail: `${preview}#${index}`,
      original: `${preview}#${index}`, alt: `Product view ${index + 1}`,
    })),
    availablePapers: scenario === "paper" ? [
      { name: "Archival Matte 4×6|103001|4|6", price: 15 },
      { name: "Glossy 5×7|103002|5|7", price: 20 },
    ] : [],
  },
} satisfies import("../../../src/routes/shop/[slug]/$types").PageData);
</script>

<nav aria-label="Fixture scenarios">
  {#each ["physical", "paper", "digital", "sold-out", "no-images", "unpriced"] as value}
    <button type="button" onclick={() => scenario = value}>{value}</button>
  {/each}
</nav>
<section aria-label="Product"><Product data={productData} /></section>
<output aria-label="Cart payload" style="display: block; overflow-wrap: anywhere;">{JSON.stringify(cart.items)}</output>
