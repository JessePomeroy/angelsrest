<script lang="ts">
import { getContext, onMount } from "svelte";
import { MOBILE_CHROME, MOBILE_NAV_QUERY, type MobileChrome } from "./mobileNavigation";

import BottomNav from "./BottomNav.svelte";
import CartIcon from "./cart/CartIcon.svelte";
import { cart } from "$lib/shop/cart.svelte";

const chrome = getContext<MobileChrome | undefined>(MOBILE_CHROME);


let LiquidNav = $state<typeof import("./JellyNav.svelte").default>();
let liquidEnabled = $state(false);

$effect(() => {
	if (chrome && liquidEnabled && LiquidNav) chrome.bottomNavHeight = 0;
});

onMount(() => {
	const viewport = window.matchMedia(MOBILE_NAV_QUERY);
	const preference = window.matchMedia("(prefers-reduced-motion: no-preference)");
	let disposed = false;
	async function update() {
		liquidEnabled = viewport.matches && preference.matches;
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
	viewport.addEventListener("change", update);
	return () => {
		disposed = true;
		preference.removeEventListener("change", update);
	viewport.removeEventListener("change", update);
	};
});
</script>

{#if liquidEnabled && LiquidNav}
	<div class="liquid-spacer"></div>
	<LiquidNav bottomInset={chrome?.purchaseBarHeight ?? 0} />
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
  @media (pointer: coarse) and (orientation: landscape) and (max-height: 500px) {
    .liquid-spacer, .fallback-spacer, .fallback-cart { display: block; }
  }
</style>
