<!--
  CartDrawer — slide-in cart panel.

  Mounted once at the root layout level. Visibility is driven by `cartUI.isOpen`
  so any CartIcon (desktop nav, mobile pill) can open it from anywhere in the
  app without prop drilling.

  Layout:
  - Desktop: slides in from the right edge, max-width 420px, full height.
  - Mobile: slides up from the bottom edge as a sheet, max-height 85vh.
  - Backdrop covers the rest of the screen, click closes.

  This is hand-rolled rather than using Skeleton's Drawer primitive — keeps
  the visual language aligned with the rest of the site (lowercase, light
  fonts, soft surface tokens, no card-heavy boxing) and avoids the slightly
  generic feel of Skeleton's defaults.

  The expired-cart toast is rendered inline at the top of the body (not as a
  separate floating notification) so the user sees it in the same eyeline as
  the empty state.
-->

<script lang="ts">
import { ArrowRightIcon, XIcon } from "@lucide/svelte";
import { cubicOut } from "svelte/easing";
import { fade, fly } from "svelte/transition";
import { goto } from "$app/navigation";
import { cart } from "$lib/shop/cart.svelte";
import { cartUI } from "$lib/shop/cartUI.svelte";
import { createCartCheckout } from "$lib/utils/cartCheckout";
import { formatCents } from "$lib/utils/format";
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
	} catch (err: any) {
		console.error("Cart checkout error:", err);
		checkoutError = err?.message || "checkout failed. please try again.";
		isCheckingOut = false;
	}
}

function viewFullCart() {
	close();
	goto("/cart");
}

// Lock body scroll while drawer is open. Plain effect on isOpen.
$effect(() => {
	if (typeof document === "undefined") return;
	if (cartUI.isOpen) {
		const original = document.body.style.overflow;
		document.body.style.overflow = "hidden";
		return () => {
			document.body.style.overflow = original;
		};
	}
});

// Close on Escape key.
$effect(() => {
	if (typeof window === "undefined") return;
	if (!cartUI.isOpen) return;
	function onKey(e: KeyboardEvent) {
		if (e.key === "Escape") close();
	}
	window.addEventListener("keydown", onKey);
	return () => window.removeEventListener("keydown", onKey);
});
</script>

{#if cartUI.isOpen}
  <!-- Backdrop -->
  <button
    type="button"
    aria-label="Close cart"
    onclick={close}
    transition:fade={{ duration: 180 }}
    class="fixed inset-0 z-[60] bg-gray-900/50 backdrop-blur-sm md:cursor-default"
  ></button>

  <!--
    Drawer panel.
    Desktop: right slide-in (400px wide).
    Mobile: bottom sheet (85vh max-height).

    `role="dialog"` requires a non-interactive container — using <div> rather
    than <aside> here keeps svelte-check's a11y rule happy.
  -->
  <div
    aria-label="Shopping cart"
    role="dialog"
    aria-modal="true"
    transition:fly={{
      x: 0,
      y: 0,
      duration: 240,
      easing: cubicOut,
    }}
    class="fixed z-[61] flex flex-col bg-surface-50 dark:bg-surface-900 shadow-2xl
           bottom-0 left-0 right-0 max-h-[85vh] rounded-t-2xl
           md:top-0 md:right-0 md:bottom-0 md:left-auto md:w-[400px] md:max-w-[90vw]
           md:max-h-none md:h-screen md:rounded-t-none"
  >
    <!-- Header -->
    <header
      class="flex items-center justify-between px-6 py-5 border-b border-surface-500/15"
    >
      <h2 class="text-sm tracking-widest lowercase font-light">your cart</h2>
      <button
        type="button"
        onclick={close}
        aria-label="Close cart"
        class="p-1 -mr-1 text-surface-600-300-token hover:text-surface-900-50-token transition-colors"
      >
        <XIcon class="size-5" />
      </button>
    </header>

    <!-- Body -->
    <div class="flex-1 overflow-y-auto px-6">
      {#if wasExpired}
        <div
          class="mt-4 mb-2 px-3 py-2 text-xs bg-surface-500/10 border border-surface-500/20 rounded-md flex items-start justify-between gap-2"
        >
          <span class="text-surface-700-200-token leading-relaxed">
            we cleared your cart from a previous visit (older than 30 days).
          </span>
          <button
            type="button"
            onclick={dismissExpired}
            aria-label="Dismiss notice"
            class="flex-shrink-0 text-surface-500 hover:text-surface-900-50-token"
          >
            <XIcon class="size-3" />
          </button>
        </div>
      {/if}

      {#if isEmpty}
        <div class="flex flex-col items-center justify-center text-center py-16">
          <div class="text-sm tracking-wider lowercase text-surface-600-300-token mb-2">
            your cart is empty
          </div>
          <a
            href="/shop"
            onclick={close}
            class="text-xs tracking-wider lowercase text-surface-500 hover:text-surface-900-50-token underline underline-offset-4 inline-flex items-center gap-1"
          >
            browse the shop
            <ArrowRightIcon class="size-3" />
          </a>
        </div>
      {:else}
        <ul class="list-none p-0 m-0">
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
        class="px-6 py-5 border-t border-surface-500/15 bg-surface-50 dark:bg-surface-900"
      >
        <div class="flex items-baseline justify-between mb-4">
          <span class="text-xs tracking-wider lowercase text-surface-600-300-token">
            subtotal
          </span>
          <span class="text-xl font-semibold tabular-nums">
            {formatCents(totalCents)}
          </span>
        </div>

        {#if checkoutError}
          <p class="text-xs text-error-500 mb-3 lowercase">{checkoutError}</p>
        {/if}

        <button
          type="button"
          onclick={checkout}
          disabled={isCheckingOut}
          class="btn variant-filled-primary w-full mb-2"
        >
          <span class="time-aware-text">
            {isCheckingOut ? "processing..." : "checkout"}
          </span>
        </button>

        <button
          type="button"
          onclick={viewFullCart}
          class="block w-full text-center text-xs tracking-wider lowercase text-surface-500 hover:text-surface-900-50-token underline underline-offset-4"
        >
          view full cart
        </button>

        <p class="text-[10px] text-surface-500 text-center mt-3">
          free shipping · secure payment by stripe
        </p>
      </footer>
    {/if}
  </div>
{/if}
