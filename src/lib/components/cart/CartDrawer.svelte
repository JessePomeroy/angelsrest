<!--
  CartDrawer — slide-in cart panel.

  Mounted once at the root layout level. Visibility is driven by `cartUI.isOpen`
  so any CartIcon (desktop nav, mobile pill) can open it from anywhere in the
  app without prop drilling.

  Layout:
  - Desktop: slides in from the right edge, width 400px, full height.
  - Mobile: slides up from the bottom edge as a sheet, max-height 85vh.
  - Backdrop covers the rest of the screen, click closes.

  The expired-cart toast is rendered inline at the top of the body (not as a
  separate floating notification) so the user sees it in the same eyeline as
  the empty state.
-->

<script lang="ts">
import { ArrowRightIcon, XIcon } from "@lucide/svelte";
import { cubicOut } from "svelte/easing";
import { fly } from "svelte/transition";
import { goto } from "$app/navigation";
import { cart } from "$lib/shop/cart.svelte";
import { cartUI } from "$lib/shop/cartUI.svelte";
import { createCartCheckout } from "$lib/utils/cartCheckout";
import { formatCents } from "$lib/utils/format";
import { trapFocus } from "$lib/utils/focusTrap";
import { openModal } from "$lib/utils/openModal";
import CartLineItem from "./CartLineItem.svelte";

let isCheckingOut = $state(false);
let checkoutError = $state<string | null>(null);

const items = $derived(cart.items);
const totalCents = $derived(cart.totalCents);
const isEmpty = $derived(cart.isEmpty);
const wasExpired = $derived(cart.cartWasExpiredOnLoad);

function close() {
	cartUI.close();
}

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

function viewFullCart() {
	close();
	goto("/cart");
}

</script>

{#if cartUI.isOpen}
  <dialog
    use:openModal
    aria-label="Shopping cart"
    class="cart-dialog"
    oncancel={(event) => {
      event.preventDefault();
      close();
    }}
    onclick={(event) => {
      if (event.target === event.currentTarget) close();
    }}
    onkeydown={(event) => trapFocus(event, event.currentTarget)}
  >
  <div
    transition:fly={{
      x: 0,
      y: 0,
      duration: 240,
      easing: cubicOut,
    }}
    class="cart-sheet"
  >
    <!-- Header -->
    <header
      class="drawer-header"
    >
      <h2 class="drawer-title">your cart</h2>
      <button
        type="button"
        onclick={close}
        aria-label="Close cart"
        class="close-button"
      >
        <XIcon size="1.25rem" />
      </button>
    </header>

    <!-- Body -->
    <div class="drawer-body">
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
            aria-label="Dismiss notice"
            class="dismiss-button"
          >
            <XIcon size="0.75rem" />
          </button>
        </div>
      {/if}

      {#if isEmpty}
        <div class="empty-state">
          <div class="empty-message">
            your cart is empty
          </div>
          <a
            href="/shop"
            onclick={close}
            class="shop-link"
          >
            browse the shop
            <ArrowRightIcon size="0.75rem" />
          </a>
        </div>
      {:else}
        <ul class="cart-items">
          {#each items as item (item.id)}
            <li>
              <CartLineItem {item} variant="drawer" />
            </li>
          {/each}
        </ul>
      {/if}
    </div>

    <!-- Footer -->
    {#if !isEmpty}
      <footer
        class="drawer-footer"
      >
        <div class="subtotal-row">
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

        <button
          type="button"
          onclick={viewFullCart}
          class="full-cart-button"
        >
          view full cart
        </button>

        <p class="payment-note">
          free shipping · secure payment by stripe
        </p>
      </footer>
    {/if}
  </div>
  </dialog>
{/if}

<style>
  @layer components {
    .cart-dialog { position: fixed; inset: 0; margin: 0; height: 100%; width: 100%; max-height: none; max-width: none; border-width: 0; background-color: transparent; padding: 0; color: inherit; }
    .cart-dialog::backdrop { background-color: color-mix(in oklab, oklch(21% 0.034 264.665) 50%, transparent); -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px); }
    .cart-sheet { position: fixed; z-index: 61; display: flex; flex-direction: column; background-color: var(--color-surface-50); box-shadow: 0 25px 50px -12px rgb(0 0 0 / 25%); bottom: 0; left: 0; right: 0; max-height: 85vh; border-top-left-radius: 1rem; border-top-right-radius: 1rem; }
    :global(.dark) .cart-sheet { background-color: var(--color-surface-900); }
    @media (min-width: 48rem) { .cart-sheet { top: 0; right: 0; bottom: 0; left: auto; width: 400px; max-width: 90vw; max-height: none; height: 100vh; border-top-left-radius: 0; border-top-right-radius: 0; } }
    .drawer-header { display: flex; align-items: center; justify-content: space-between; padding-inline: 1.5rem; padding-block: 1.25rem; border-bottom: 1px solid; border-color: color-mix(in oklab, var(--color-surface-500) 15%, transparent); }
    .drawer-title { font-size: var(--text-sm); text-transform: lowercase; }
    .close-button { padding: 0.25rem; margin-right: -0.25rem; color: var(--color-surface-600); transition-property: color, background-color, border-color, outline-color, text-decoration-color, fill, stroke; transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1); transition-duration: 150ms; }
    :global(.dark) .close-button { color: var(--color-surface-300); }
    @media (hover: hover) { .close-button:hover { color: var(--color-surface-900); } }
    @media (hover: hover) { :global(.dark) .close-button:hover { color: var(--color-surface-50); } }
    .drawer-body { flex: 1; overflow-y: auto; padding-inline: 1.5rem; }
    .expiry-notice { margin-top: 1rem; margin-bottom: 0.5rem; padding-inline: 0.75rem; padding-block: 0.5rem; font-size: var(--text-xs); line-height: var(--text-xs--line-height); background-color: color-mix(in oklab, var(--color-surface-500) 10%, transparent); border: 1px solid; border-color: color-mix(in oklab, var(--color-surface-500) 20%, transparent); border-radius: 0.375rem; display: flex; align-items: flex-start; justify-content: space-between; gap: 0.5rem; }
    .notice-copy { color: var(--color-surface-700); line-height: 1.625; }
    :global(.dark) .notice-copy { color: var(--color-surface-200); }
    .dismiss-button { flex-shrink: 0; color: var(--color-surface-500); }
    @media (hover: hover) { .dismiss-button:hover { color: var(--color-surface-900); } }
    @media (hover: hover) { :global(.dark) .dismiss-button:hover { color: var(--color-surface-50); } }
    .empty-state { display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding-block: 4rem; }
    .empty-message { font-size: var(--text-sm); line-height: var(--text-sm--line-height); letter-spacing: 0.05em; text-transform: lowercase; color: var(--color-surface-600); margin-bottom: 0.5rem; }
    :global(.dark) .empty-message { color: var(--color-surface-300); }
    .shop-link { font-size: var(--text-xs); line-height: var(--text-xs--line-height); letter-spacing: 0.05em; text-transform: lowercase; color: var(--color-surface-500); text-decoration-line: underline; text-underline-offset: 4px; display: inline-flex; align-items: center; gap: 0.25rem; }
    @media (hover: hover) { .shop-link:hover { color: var(--color-surface-900); } }
    @media (hover: hover) { :global(.dark) .shop-link:hover { color: var(--color-surface-50); } }
    .cart-items { list-style-type: none; padding: 0; margin: 0; }
    .drawer-footer { padding-inline: 1.5rem; padding-block: 1.25rem; border-top: 1px solid; border-color: color-mix(in oklab, var(--color-surface-500) 15%, transparent); background-color: var(--color-surface-50); }
    :global(.dark) .drawer-footer { background-color: var(--color-surface-900); }
    .subtotal-row { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 1rem; }
    .subtotal-label { font-size: var(--text-xs); line-height: var(--text-xs--line-height); letter-spacing: 0.05em; text-transform: lowercase; color: var(--color-surface-600); }
    :global(.dark) .subtotal-label { color: var(--color-surface-300); }
    .subtotal-value { font-size: var(--text-xl); line-height: var(--text-xl--line-height); font-weight: 600; font-variant-numeric: tabular-nums; }
    .checkout-error { font-size: var(--text-xs); line-height: var(--text-xs--line-height); color: var(--color-error-500); text-transform: lowercase; }
    .checkout-button { display: inline-flex; align-items: center; justify-content: center; gap: 0.5rem; border-radius: 0.375rem; white-space: nowrap; font-size: var(--text-base); line-height: var(--text-base--line-height); padding-inline: 1rem; padding-block: 0.25rem; transition-property: color, background-color, border-color, outline-color, text-decoration-color, fill, stroke; transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1); transition-duration: 150ms; background-color: var(--color-primary-500); color: oklch(12.9% 0.042 264.695); width: 100%; margin-bottom: 0.5rem; }
    .checkout-button:focus-visible { outline-style: solid; outline-width: 2px; outline-offset: 2px; outline-color: var(--color-surface-900); }
    :global(.dark) .checkout-button:focus-visible { outline-color: var(--color-surface-50); }
    .checkout-button:disabled { opacity: 0.5; cursor: not-allowed; }
    @media (hover: hover) { .checkout-button:hover:not(:disabled) { background-color: color-mix(in oklab, var(--color-primary-500) 80%, transparent); } }
    .full-cart-button { display: block; width: 100%; text-align: center; font-size: var(--text-xs); line-height: var(--text-xs--line-height); letter-spacing: 0.05em; text-transform: lowercase; color: var(--color-surface-500); text-decoration-line: underline; text-underline-offset: 4px; }
    @media (hover: hover) { .full-cart-button:hover { color: var(--color-surface-900); } }
    @media (hover: hover) { :global(.dark) .full-cart-button:hover { color: var(--color-surface-50); } }
    .payment-note { font-size: 10px; color: var(--color-surface-500); text-align: center; }
  }
</style>
