<script lang="ts">
import SiteChrome from "./SiteChrome.svelte";
import LiquidDetailsHarness from "./LiquidDetailsHarness.svelte";
import MotionHarness from "./MotionHarness.svelte";
import PrintHarness from "./PrintHarness.svelte";
import DeliveryDownloadHarness from "./DeliveryDownloadHarness.svelte";
import BookingHarness from "./BookingHarness.svelte";
import TurnstileHarness from "./TurnstileHarness.svelte";
import Orders from "../../../src/routes/orders/+page.svelte";
import ContactForm from "../../../src/lib/components/ContactForm.svelte";
import ThemeOwnership from "./ThemeOwnership.svelte";
import MobileNav from "../../../src/lib/components/MobileNav.svelte";
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

{#if fixture === "chrome"}
	<SiteChrome />
{:else if fixture === "liquid-details"}
	<LiquidDetailsHarness />
{:else if fixture === "motion"}
	<MotionHarness />
{:else if fixture === "print"}
	<PrintHarness />
{:else if fixture === "delivery-downloads"}
	<DeliveryDownloadHarness />
{:else if fixture === "booking"}
	<BookingHarness />
{:else if fixture === "turnstile"}
	<TurnstileHarness />
{:else if fixture === "orders"}
	<Orders />
{:else if fixture === "contact"}
	<ThemeSwitcher />
	<ContactForm />
{:else if fixture === "ownership"}
	<ThemeOwnership />
{:else if fixture === "liquid-navigation"}
	<MobileNav />
	<CartDrawer />
{:else if fixture === "navigation"}
	<ThemeSwitcher />
	<label>Current path <input value={fixturePage.url.pathname} oninput={(event) => { fixturePage.url = new URL(event.currentTarget.value, "http://127.0.0.1:5196"); }} /></label>
	<BottomNav />
{:else if fixture === "liquid-shop"}
	<PrintSet data={setData} />
	<MobileNav />
	<CartDrawer />
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
