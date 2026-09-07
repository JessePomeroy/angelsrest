<!--
  CartIcon — Lucide ShoppingCart that opens the CartDrawer via the cartUI
  store. Used in two places with two distinct visual treatments:

  - **nav** (desktop top bar): icon + inline count to its right. The earlier
    revision used an absolute-positioned floating badge that sat on top of
    the cart silhouette and obscured it; inline count keeps the icon clean
    and scales naturally for 2-digit totals.
  - **pill** (mobile FAB): circular 3rem button with a floating count
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
    class="cart-pill"
  >
    <ShoppingCartIcon size="1.25rem" />
    {#if count > 0}
      <span
        aria-hidden="true"
        class="pill-count"
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
    class="cart-link"
  >
    <ShoppingCartIcon size="1.25rem" />
    {#if count > 0}
      <span class="inline-count">
        {displayCount}
      </span>
    {/if}
  </button>
{/if}

<style>
  .cart-pill {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 3rem;
    height: 3rem;
    border-radius: 9999px;
    background: var(--color-surface-50);
    border: 1px solid color-mix(in oklab, var(--color-surface-500) 30%, transparent);
    box-shadow: 0 10px 15px -3px rgb(0 0 0 / 10%), 0 4px 6px -4px rgb(0 0 0 / 10%);
    transition: transform 150ms cubic-bezier(0.4, 0, 0.2, 1), scale 150ms cubic-bezier(0.4, 0, 0.2, 1);
  }
  .cart-pill:active { scale: 0.95; }
  .pill-count {
    position: absolute;
    top: -0.25rem;
    right: -0.25rem;
    min-width: 16px;
    height: 1rem;
    padding-inline: 0.25rem;
    border-radius: 9999px;
    background: oklch(21% 0.034 264.665);
    color: var(--color-surface-50);
    font-size: 10px;
    font-weight: 500;
    line-height: 1rem;
    text-align: center;
  }
  .cart-link {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    color: oklch(44.6% 0.03 256.802);
    transition: color 150ms cubic-bezier(0.4, 0, 0.2, 1);
  }
  .inline-count {
    font-size: var(--text-xs);
    line-height: var(--text-xs--line-height);
    font-variant-numeric: tabular-nums;
    letter-spacing: 0.05em;
  }
  :global(.dark) .cart-pill { background: var(--color-surface-900); }
  :global(.dark) .pill-count {
    background: var(--color-surface-50);
    color: oklch(21% 0.034 264.665);
  }
  :global(.dark) .cart-link { color: var(--color-surface-400); }
  @media (hover: hover) {
    .cart-link:hover { color: oklch(21% 0.034 264.665); }
    :global(.dark) .cart-link:hover { color: var(--color-surface-50); }
  }
</style>
