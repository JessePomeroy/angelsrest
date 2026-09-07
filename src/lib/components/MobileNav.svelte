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
	<div class="liquid-spacer"></div>
	<LiquidNav />
{:else}
	{#if cart.itemCount > 0}
		<div class="fallback-cart">
			<CartIcon variant="pill" />
		</div>
	{/if}
	<div class="fallback-spacer"></div>
	<BottomNav />
{/if}

<style>
  .liquid-spacer { height: 9rem; }
  .fallback-spacer { height: 5rem; }
  .fallback-cart { position: fixed; bottom: 9rem; right: 1rem; z-index: 40; }
  @media (min-width: 48rem) {
    .liquid-spacer, .fallback-spacer, .fallback-cart { display: none; }
  }
</style>
