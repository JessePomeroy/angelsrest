<script lang="ts">
import Shop from "../../../src/routes/shop/+page.svelte";
import { deliveryData, preview } from "./data";
const params = new URLSearchParams(window.location.search);
const empty = params.get("empty") === "true";
const products = [...[0, 1, 2, 3].map(index => ({
  title: `Fixture print ${index + 1}`, slug: `fixture-print-${index + 1}`, preview,
  price: 25, category: "prints", featured: index === 0, inStock: true,
})), ...["merchandise", "digital"].map(category => ({
  title: `Fixture ${category}`, slug: `fixture-${category}`, preview,
  price: 12, category, featured: false, inStock: true,
}))];
const printSets = [{ title: "Fixture pair", slug: "fixture-pair", previewImage: preview, preview1: preview, preview2: preview, price: 40, startingPrice: 40, description: undefined, availablePapers: [] }];
const shopData = {
  siteSettings: deliveryData.siteSettings,
  printSets: empty ? [] : printSets,
  products: empty ? [] : products,
} satisfies import("../../../src/routes/shop/$types").PageData;
</script>

<Shop data={shopData} />
