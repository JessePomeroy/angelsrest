<script lang="ts">
import BottomNav from "../../../src/lib/components/BottomNav.svelte";
import { page as fixturePage } from "./state.svelte";
import PrintSet from "../../../src/routes/shop/sets/[slug]/+page.svelte";
import CheckoutCancel from "../../../src/routes/checkout/cancel/+page.svelte";
import ThemeSwitcher from "../../../src/lib/components/ThemeSwitcher.svelte";
import CartDrawer from "../../../src/lib/components/cart/CartDrawer.svelte";
import DeliveryGallery from "../../../src/routes/delivery/[token]/+page.svelte";
import { cart } from "../../../src/lib/shop/cart.svelte";
import { cartUI } from "../../../src/lib/shop/cartUI.svelte";
import { deliveryData, preview, printSetData } from "./data";

const params = new URLSearchParams(window.location.search);
const fixture = params.get("fixture") ?? "cart";
const setData = { ...printSetData, printSet: { ...printSetData.printSet, inStock: params.get("stock") !== "false" } };
document.documentElement.dataset.timePeriod = "afternoon";

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

{#if fixture === "navigation"}
	<ThemeSwitcher />
	<label>Current path <input value={fixturePage.url.pathname} oninput={(event) => { fixturePage.url = new URL(event.currentTarget.value, "http://127.0.0.1:5196"); }} /></label>
	<BottomNav />
{:else if fixture === "set"}
	<ThemeSwitcher />
	<PrintSet data={setData} />
	<CartDrawer />
{:else if fixture === "theme"}
	<ThemeSwitcher />
	<CheckoutCancel />
	<button type="button" onclick={() => cartUI.open()}>Open cart</button>
	<CartDrawer />
{:else if fixture === "cart"}
	<button type="button" onclick={() => cartUI.open()}>Open cart</button>
	<a href="#outside">Outside link</a>
	<CartDrawer />
{:else if fixture === "delivery"}
	<DeliveryGallery data={deliveryData} form={null} />
{/if}
