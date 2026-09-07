<script lang="ts">
import Collection from "../../../src/routes/shop/prints/[slug]/+page.svelte";
import Shop from "../../../src/routes/shop/+page.svelte";
import { deliveryData, preview } from "./data";
const params = new URLSearchParams(window.location.search);
const kind = params.get("kind") ?? "collection";
const empty = params.get("empty") === "true";
const products = [0, 1, 2, 3].map(index => ({
  title: `Fixture print ${index + 1}`, slug: `fixture-print-${index + 1}`, preview,
  price: 25, category: "prints", featured: index === 0, inStock: true,
}));
const printSets = [{ title: "Fixture pair", slug: "fixture-pair", previewImage: preview, preview1: preview, preview2: preview, price: 40, startingPrice: 40, description: undefined, availablePapers: [] }];
const collectionData = {
  siteSettings: deliveryData.siteSettings,
  collection: { title: "Fixture collection", slug: "fixture-collection", previewImage: preview, alt: "Fixture collection", description: "Photographs from quiet places.", parent: { title: "Parent collection", slug: "parent-collection" } },
  subCollections: empty ? [] : [{ title: "Nested collection", slug: "nested-collection", previewImage: preview, alt: "Nested collection" }],
  printSets: empty ? [] : printSets,
  products: empty ? [] : products,
} satisfies import("../../../src/routes/shop/prints/[slug]/$types").PageData;
const shopData = {
  siteSettings: deliveryData.siteSettings, collections: [],
  printSets: empty ? [] : printSets,
  products: empty ? [] : products,
} satisfies import("../../../src/routes/shop/$types").PageData;
</script>

{#if kind === "shop"}
  <Shop data={shopData} />
{:else}
  <Collection data={collectionData} />
{/if}
