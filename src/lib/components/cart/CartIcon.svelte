<!--
  CartIcon — Lucide ShoppingCart that opens the CartDrawer via the cartUI
  store. Used in two places with two distinct visual treatments:

  - **nav** (desktop top bar): icon + inline count to its right. The earlier
    revision used an absolute-positioned floating badge that sat on top of
    the cart silhouette and obscured it; inline count keeps the icon clean
    and scales naturally for 2-digit totals.
  - **pill** (mobile FAB): circular w-12 h-12 button with a floating count
    badge in the top-right corner. Bigger touch target, recognizable mobile
    pattern.

  The component owns no state — it reads `cart.itemCount` and dispatches to
  `cartUI.open()`. Visibility is decided by the parent (Nav always shows it,
  the mobile pill only mounts when the cart is non-empty).

  Design notes:
  - Uses Lucide `ShoppingCart` to visually distinguish from the BottomNav
    `ShoppingBag` which represents the Shop destination.
-->

<script lang="ts">
import { ShoppingCartIcon } from "@lucide/svelte";
import { cart } from "$lib/shop/cart.svelte";
import { cartUI } from "$lib/shop/cartUI.svelte";

interface Props {
	/** "nav" = inline icon for the desktop Nav. "pill" = fixed mobile FAB. */
	variant?: "nav" | "pill";
}

let { variant = "nav" }: Props = $props();

const count = $derived(cart.itemCount);
const displayCount = $derived(count > 99 ? "99+" : String(count));
</script>

{#if variant === "pill"}
  <button
    type="button"
    onclick={() => cartUI.open()}
    aria-label={count > 0 ? `Open cart, ${count} item${count === 1 ? "" : "s"}` : "Open cart"}
    class="relative flex items-center justify-center w-12 h-12 rounded-full bg-surface-50 dark:bg-surface-900 border border-surface-500/30 shadow-lg active:scale-95 transition-transform"
  >
    <ShoppingCartIcon class="size-5" />
    {#if count > 0}
      <span
        aria-hidden="true"
        class="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-gray-900 dark:bg-surface-50 text-surface-50 dark:text-gray-900 text-[10px] font-medium leading-4 text-center"
      >
        {displayCount}
      </span>
    {/if}
  </button>
{:else}
  <button
    type="button"
    onclick={() => cartUI.open()}
    aria-label={count > 0 ? `Open cart, ${count} item${count === 1 ? "" : "s"}` : "Open cart"}
    class="inline-flex items-center gap-1.5 text-gray-600 hover:text-gray-900 dark:text-surface-400 dark:hover:text-surface-50 transition-colors"
  >
    <ShoppingCartIcon class="size-5" />
    {#if count > 0}
      <span class="text-xs tabular-nums tracking-wider">
        {displayCount}
      </span>
    {/if}
  </button>
{/if}
