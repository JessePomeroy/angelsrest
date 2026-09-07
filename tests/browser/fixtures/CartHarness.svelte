<script lang="ts">
import CartPage from "../../../src/routes/cart/+page.svelte";
import CartDrawer from "$lib/components/cart/CartDrawer.svelte";
import { cart } from "$lib/shop/cart.svelte";
import { cartUI } from "$lib/shop/cartUI.svelte";
const params = new URLSearchParams(window.location.search);
const kind = params.get("kind") ?? "page";
const imageUrl = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#789abc"/></svg>');
if (params.get("state") === "filled") {
  cart.add({ productSlug: "long-title", type: "print", title: "A very long photographic print title beside the water with reflections and an evening sky", imageUrl, paperName: "Fine art paper", paperWidth: 12, paperHeight: 16, borderWidth: 1, quantity: 2, unitPriceCents: 2500 });
  cart.add({ productSlug: "print-set", type: "set", title: "A pair of moments", imageUrl, imageUrls: [imageUrl, imageUrl], quantity: 1, unitPriceCents: 5000 });
}
</script>
<div class="cart-fixture">
  {#if kind === "page"}<CartPage />
  {:else}<button type="button" onclick={() => cartUI.open()}>Open cart fixture</button><CartDrawer />{/if}
</div>
<style>.cart-fixture { padding: 2rem 1rem; }</style>
