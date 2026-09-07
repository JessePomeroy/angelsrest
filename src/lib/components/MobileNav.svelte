<script lang="ts">
import { onMount } from "svelte";
import BottomNav from "./BottomNav.svelte";
import CartIcon from "./cart/CartIcon.svelte";
import { cart } from "$lib/shop/cart.svelte";

let LiquidNav = $state<typeof import("./JellyNav.svelte").default>();
let liquidEnabled = $state(false);

onMount(() => {
	const preference = window.matchMedia("(max-width: 767px) and (prefers-reduced-motion: no-preference)");
	let disposed = false;
	async function update() {
		liquidEnabled = preference.matches;
		if (liquidEnabled && !LiquidNav) {
			try {
				const module = await import("./JellyNav.svelte");
				if (!disposed) LiquidNav = module.default;
			} catch {
				// Keep the ordinary navigation usable if the optional renderer cannot load.
			}
		}
	}
	void update();
	preference.addEventListener("change", update);
	return () => {
		disposed = true;
		preference.removeEventListener("change", update);
	};
});
</script>

{#if liquidEnabled && LiquidNav}
	<div class="h-36 md:hidden"></div>
	<LiquidNav />
{:else}
	{#if cart.itemCount > 0}
		<div class="fixed bottom-36 right-4 z-40 md:hidden">
			<CartIcon variant="pill" />
		</div>
	{/if}
	<div class="h-20 md:hidden"></div>
	<BottomNav />
{/if}
