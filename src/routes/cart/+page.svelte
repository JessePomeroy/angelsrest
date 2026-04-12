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

let isCheckingOut = $state(false);
let checkoutError = $state<string | null>(null);

const items = $derived(cart.items);
const totalCents = $derived(cart.totalCents);
const itemCount = $derived(cart.itemCount);
const isEmpty = $derived(cart.isEmpty);
const wasExpired = $derived(cart.cartWasExpiredOnLoad);

function formatCents(cents: number): string {
	return `$${(cents / 100).toFixed(2)}`;
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
</script>

<SEO
  title="cart | angel's rest"
  description="Review your cart and complete your purchase."
  url="https://angelsrest.online/cart"
/>

<div class="max-w-6xl mx-auto">
  <a
    href="/shop"
    class="text-sm opacity-70 hover:opacity-100 mb-4 inline-flex items-center gap-1"
  >
    <ArrowLeftIcon class="size-3" /> back to shop
  </a>

  <h1 class="text-3xl font-semibold mb-8 lowercase">your cart</h1>

  {#if wasExpired}
    <div
      class="mb-6 px-4 py-3 text-sm bg-surface-500/10 border border-surface-500/20 rounded-md flex items-start justify-between gap-3"
    >
      <span class="text-surface-700-200-token">
        we cleared your cart from a previous visit (older than 30 days).
      </span>
      <button
        type="button"
        onclick={dismissExpired}
        class="text-xs tracking-wider lowercase text-surface-500 hover:text-surface-900-50-token underline underline-offset-4"
      >
        dismiss
      </button>
    </div>
  {/if}

  {#if isEmpty}
    <div class="py-24 text-center">
      <p class="text-sm tracking-wider lowercase text-surface-600-300-token mb-4">
        your cart is empty
      </p>
      <a
        href="/shop"
        class="btn variant-filled-primary"
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
    <div class="grid grid-cols-1 md:grid-cols-3 md:gap-8">
      <!-- Line items -->
      <div class="md:col-span-2">
        <ul class="list-none p-0 m-0 border-t border-surface-500/15">
          {#each items as item (item.id)}
            <li>
              <CartLineItem {item} variant="page" />
            </li>
          {/each}
        </ul>
      </div>

      <!-- Totals / checkout panel -->
      <aside
        class="self-start space-y-4 mt-6 pt-6 border-t border-surface-500/15
               md:mt-0 md:p-6 md:border md:border-surface-500/20 md:rounded-md md:sticky md:top-8"
      >
        <h2 class="text-sm tracking-widest lowercase font-light">order summary</h2>

        <div class="space-y-2 text-sm">
          <div class="flex justify-between text-surface-600-300-token">
            <span class="lowercase">items</span>
            <span class="tabular-nums">{itemCount}</span>
          </div>
          <div class="flex justify-between text-surface-600-300-token">
            <span class="lowercase">shipping</span>
            <span class="lowercase">calculated at checkout</span>
          </div>
        </div>

        <div
          class="flex items-baseline justify-between pt-3 border-t border-surface-500/15"
        >
          <span class="text-xs tracking-wider lowercase text-surface-600-300-token">
            subtotal
          </span>
          <span class="text-2xl font-semibold tabular-nums">
            {formatCents(totalCents)}
          </span>
        </div>

        {#if checkoutError}
          <p class="text-xs text-error-500 lowercase">{checkoutError}</p>
        {/if}

        <button
          type="button"
          onclick={checkout}
          disabled={isCheckingOut}
          class="btn variant-filled-primary w-full"
        >
          <span class="time-aware-text">
            {isCheckingOut ? "processing..." : "checkout"}
          </span>
        </button>

        <p class="text-[10px] text-surface-500 text-center">
          secure payment by stripe
        </p>
      </aside>
    </div>
  {/if}
</div>
