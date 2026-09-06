<script lang="ts">
import CartDrawer from "../../../src/lib/components/cart/CartDrawer.svelte";
import DeliveryGallery from "../../../src/routes/delivery/[token]/+page.svelte";
import { cart } from "../../../src/lib/shop/cart.svelte";
import { cartUI } from "../../../src/lib/shop/cartUI.svelte";
import { deliveryData, preview } from "./data";

const params = new URLSearchParams(window.location.search);
const fixture = params.get("fixture") ?? "cart";

if (params.get("populated") === "true") {
	cart.add({
		productSlug: "fixture-print",
		type: "print",
		title: "Fixture print",
		imageUrl: preview,
		quantity: 1,
		unitPriceCents: 2500,
	});
}
</script>

{#if fixture === "cart"}
	<button type="button" onclick={() => cartUI.open()}>Open cart</button>
	<a href="#outside">Outside link</a>
	<CartDrawer />
{:else if fixture === "delivery"}
	<DeliveryGallery data={deliveryData} form={null} />
{/if}
