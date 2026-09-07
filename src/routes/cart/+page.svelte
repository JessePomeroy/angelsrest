<!--
  /cart — full-page cart view.

  Same data as the CartDrawer, just laid out as a full page so the customer
  can review their order with more breathing room before checkout. Linked to
  from the drawer's footer ("view full cart") and reachable directly via URL.

  Layout:
  - Two columns on desktop: line items left, totals/checkout panel right.
  - Stacked on mobile: line items above, totals/checkout below.

  Re-uses CartLineItem with `variant="page"` for the larger thumbnails and
  more generous spacing.
-->

<script lang="ts">
import { ArrowLeftIcon } from "@lucide/svelte";
import CartLineItem from "$lib/components/cart/CartLineItem.svelte";
import SEO from "$lib/components/SEO.svelte";
import { cart } from "$lib/shop/cart.svelte";
import { createCartCheckout } from "$lib/utils/cartCheckout";
import { formatCents } from "$lib/utils/format";

let isCheckingOut = $state(false);
let checkoutError = $state<string | null>(null);

const items = $derived(cart.items);
const totalCents = $derived(cart.totalCents);
const itemCount = $derived(cart.itemCount);
const isEmpty = $derived(cart.isEmpty);
const wasExpired = $derived(cart.cartWasExpiredOnLoad);

function dismissExpired() {
	cart.dismissExpiredFlag();
}

async function checkout() {
	if (isEmpty || isCheckingOut) return;
	isCheckingOut = true;
	checkoutError = null;
	try {
		const url = await createCartCheckout(items);
		window.location.href = url;
	} catch (err: unknown) {
		console.error("Cart checkout error:", err);
		checkoutError = err instanceof Error ? err.message : "checkout failed. please try again.";
		isCheckingOut = false;
	}
}
</script>

<SEO
  title="cart | angel's rest"
  description="Review your cart and complete your purchase."
  url="https://angelsrest.online/cart"
/>

<div class="cart-page">
  <a
    href="/shop"
    class="back-link"
  >
    <ArrowLeftIcon size="0.75rem" /> back to shop
  </a>

  <h1 class="page-title">your cart</h1>

  {#if wasExpired}
    <div
      class="expiry-notice"
    >
      <span class="notice-copy">
        we cleared your cart from a previous visit (older than 30 days).
      </span>
      <button
        type="button"
        onclick={dismissExpired}
        class="dismiss-button"
      >
        dismiss
      </button>
    </div>
  {/if}

  {#if isEmpty}
    <div class="empty-state">
      <p class="empty-message">
        your cart is empty
      </p>
      <a
        href="/shop"
        class="shop-link"
      >
        browse the shop
      </a>
    </div>
  {:else}
    <!--
      Mobile (default): line items stack above the order summary, single
      column. The summary uses a top-border separator instead of a full
      bordered card so it doesn't read as a heavy panel jammed into the
      narrow viewport.
      Desktop (md+): two columns with the summary as a sticky bordered
      card on the right.
    -->
    <div class="cart-layout">
      <!-- Line items -->
      <div class="line-items">
        <ul class="cart-items">
          {#each items as item (item.id)}
            <li>
              <CartLineItem {item} variant="page" />
            </li>
          {/each}
        </ul>
      </div>

      <!-- Totals / checkout panel -->
      <aside
        class="order-summary"
      >
        <h2 class="summary-title">order summary</h2>

        <div class="summary-details">
          <div class="detail-row">
            <span class="detail-label">items</span>
            <span class="detail-value">{itemCount}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">shipping</span>
            <span class="detail-label">included</span>
          </div>
        </div>

        <div
          class="subtotal-row"
        >
          <span class="subtotal-label">
            subtotal
          </span>
          <span class="subtotal-value">
            {formatCents(totalCents)}
          </span>
        </div>

        {#if checkoutError}
          <p class="checkout-error">{checkoutError}</p>
        {/if}

        <button
          type="button"
          onclick={checkout}
          disabled={isCheckingOut}
          class="checkout-button"
        >
          <span>
            {isCheckingOut ? "processing..." : "checkout"}
          </span>
        </button>

        <p class="payment-note">
          secure payment by stripe
        </p>
      </aside>
    </div>
  {/if}
</div>

<style>
  @layer components {
    .cart-page { max-width: 72rem; margin-inline: auto; }
    .back-link { font-size: var(--text-sm); line-height: var(--text-sm--line-height); opacity: 0.7; margin-bottom: 1rem; display: inline-flex; align-items: center; gap: 0.25rem; }
    @media (hover: hover) { .back-link:hover { opacity: 1.0; } }
    .page-title { font-size: var(--text-3xl); text-transform: lowercase; }
    .expiry-notice { margin-bottom: 1.5rem; padding-inline: 1rem; padding-block: 0.75rem; font-size: var(--text-sm); line-height: var(--text-sm--line-height); background-color: color-mix(in oklab, var(--color-surface-500) 10%, transparent); border: 1px solid; border-color: color-mix(in oklab, var(--color-surface-500) 20%, transparent); border-radius: 0.375rem; display: flex; align-items: flex-start; justify-content: space-between; gap: 0.75rem; }
    .notice-copy { color: var(--color-surface-700); }
    :global(.dark) .notice-copy { color: var(--color-surface-200); }
    .dismiss-button { font-size: var(--text-xs); line-height: var(--text-xs--line-height); letter-spacing: 0.05em; text-transform: lowercase; color: var(--color-surface-500); text-decoration-line: underline; text-underline-offset: 4px; }
    @media (hover: hover) { .dismiss-button:hover { color: var(--color-surface-900); } }
    @media (hover: hover) { :global(.dark) .dismiss-button:hover { color: var(--color-surface-50); } }
    .empty-state { padding-block: 6rem; text-align: center; }
    .empty-message { font-size: var(--text-sm); line-height: var(--text-sm--line-height); letter-spacing: 0.05em; text-transform: lowercase; color: var(--color-surface-600); }
    :global(.dark) .empty-message { color: var(--color-surface-300); }
    .shop-link { display: inline-flex; align-items: center; justify-content: center; gap: 0.5rem; border-radius: 0.375rem; white-space: nowrap; font-size: var(--text-base); line-height: var(--text-base--line-height); padding-inline: 1rem; padding-block: 0.25rem; transition-property: color, background-color, border-color, outline-color, text-decoration-color, fill, stroke; transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1); transition-duration: 150ms; background-color: var(--color-primary-500); color: oklch(12.9% 0.042 264.695); }
    .shop-link:focus-visible { outline-style: solid; outline-width: 2px; outline-offset: 2px; outline-color: var(--color-surface-900); }
    :global(.dark) .shop-link:focus-visible { outline-color: var(--color-surface-50); }
    .shop-link:disabled { opacity: 0.5; cursor: not-allowed; }
    @media (hover: hover) { .shop-link:hover:not(:disabled) { background-color: color-mix(in oklab, var(--color-primary-500) 80%, transparent); } }
    .cart-layout { display: grid; grid-template-columns: repeat(1, minmax(0, 1fr)); }
    @media (min-width: 48rem) { .cart-layout { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 2rem; } }
    @media (min-width: 48rem) { .line-items { grid-column: span 2 / span 2; } }
    .cart-items { list-style-type: none; padding: 0; margin: 0; border-top: 1px solid; border-color: color-mix(in oklab, var(--color-surface-500) 15%, transparent); }
    .order-summary > :not(:last-child) { margin-block-start: 0; margin-block-end: 1rem; }
    .order-summary { align-self: flex-start; margin-top: 1.5rem; padding-top: 1.5rem; border-top: 1px solid; border-color: color-mix(in oklab, var(--color-surface-500) 15%, transparent); }
    @media (min-width: 48rem) { .order-summary { margin-top: 0; padding: 1.5rem; border: 1px solid; border-color: color-mix(in oklab, var(--color-surface-500) 20%, transparent); border-radius: 0.375rem; position: sticky; top: 2rem; } }
    .summary-title { font-size: var(--text-sm); text-transform: lowercase; }
    .summary-details > :not(:last-child) { margin-block-start: 0; margin-block-end: 0.5rem; }
    .summary-details { font-size: var(--text-sm); line-height: var(--text-sm--line-height); }
    .detail-row { display: flex; justify-content: space-between; color: var(--color-surface-600); }
    :global(.dark) .detail-row { color: var(--color-surface-300); }
    .detail-label { text-transform: lowercase; }
    .detail-value { font-variant-numeric: tabular-nums; }
    .subtotal-row { display: flex; align-items: baseline; justify-content: space-between; padding-top: 0.75rem; border-top: 1px solid; border-color: color-mix(in oklab, var(--color-surface-500) 15%, transparent); }
    .subtotal-label { font-size: var(--text-xs); line-height: var(--text-xs--line-height); letter-spacing: 0.05em; text-transform: lowercase; color: var(--color-surface-600); }
    :global(.dark) .subtotal-label { color: var(--color-surface-300); }
    .subtotal-value { font-size: var(--text-2xl); line-height: var(--text-2xl--line-height); font-weight: 600; font-variant-numeric: tabular-nums; }
    .checkout-error { font-size: var(--text-xs); line-height: var(--text-xs--line-height); color: var(--color-error-500); text-transform: lowercase; }
    .checkout-button { display: inline-flex; align-items: center; justify-content: center; gap: 0.5rem; border-radius: 0.375rem; white-space: nowrap; font-size: var(--text-base); line-height: var(--text-base--line-height); padding-inline: 1rem; padding-block: 0.25rem; transition-property: color, background-color, border-color, outline-color, text-decoration-color, fill, stroke; transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1); transition-duration: 150ms; background-color: var(--color-primary-500); color: oklch(12.9% 0.042 264.695); width: 100%; }
    .checkout-button:focus-visible { outline-style: solid; outline-width: 2px; outline-offset: 2px; outline-color: var(--color-surface-900); }
    :global(.dark) .checkout-button:focus-visible { outline-color: var(--color-surface-50); }
    .checkout-button:disabled { opacity: 0.5; cursor: not-allowed; }
    @media (hover: hover) { .checkout-button:hover:not(:disabled) { background-color: color-mix(in oklab, var(--color-primary-500) 80%, transparent); } }
    .payment-note { font-size: 10px; color: var(--color-surface-500); text-align: center; }
  }
</style>
