<!--
  CartLineItem — single row in the cart drawer or full cart page.

  Renders thumbnail, title, paper + size, qty controls (- N +), per-line
  subtotal, and a remove button. Reused across both `CartDrawer.svelte` and
  `/cart/+page.svelte` so spacing/typography stay consistent.

  Quantity controls call into `cart.updateQuantity()` which clamps to
  [1, MAX_QUANTITY_PER_LINE] inside the pure helpers — the UI doesn't need
  its own bounds check.

  For print sets (`item.type === "set"`) the thumbnail shows the first image
  with a small "+N" badge if there are more images in the set.
-->

<script lang="ts">
import { MinusIcon, PlusIcon, XIcon } from "@lucide/svelte";
import type { CartItem } from "$lib/shop/cart";
import { cart } from "$lib/shop/cart.svelte";

interface Props {
	item: CartItem;
	/** "drawer" tightens spacing for the side panel; "page" gives more room. */
	variant?: "drawer" | "page";
}

let { item, variant = "drawer" }: Props = $props();

const lineSubtotal = $derived(item.unitPriceCents * item.quantity);

function formatCents(cents: number): string {
	return `$${(cents / 100).toFixed(2)}`;
}

function decrement() {
	cart.updateQuantity(item.id, item.quantity - 1);
}

function increment() {
	cart.updateQuantity(item.id, item.quantity + 1);
}

function remove() {
	cart.remove(item.id);
}

const extraImageCount = $derived(
	item.type === "set" && item.imageUrls ? item.imageUrls.length - 1 : 0,
);
</script>

<div
  class="flex gap-3 {variant === 'drawer' ? 'py-4' : 'py-5'} border-b border-surface-500/15"
>
  <!-- Thumbnail -->
  <div
    class="relative flex-shrink-0 {variant === 'drawer'
      ? 'w-16 h-16'
      : 'w-20 h-20 md:w-24 md:h-24'} overflow-hidden rounded-md bg-surface-500/10"
  >
    {#if item.imageUrl}
      <img
        src={item.imageUrl}
        alt={item.title}
        loading="lazy"
        class="w-full h-full object-cover"
      />
    {/if}
    {#if extraImageCount > 0}
      <span
        aria-hidden="true"
        class="absolute bottom-0 right-0 px-1 py-0.5 text-[10px] font-medium bg-gray-900/80 text-surface-50 rounded-tl-md"
      >
        +{extraImageCount}
      </span>
    {/if}
  </div>

  <!-- Body -->
  <div class="flex-1 min-w-0 flex flex-col gap-1">
    <!--
      `block` is required for `truncate` to actually clip — anchors are
      `display: inline` by default, where overflow/text-ellipsis are
      no-ops. Without this, a long product title (e.g. the godzilla
      tapestry) overflows its parent flex column, pushes the price + X
      button off-screen, AND inflates the page width past the viewport
      so the order summary below also clips.
    -->
    <a
      href={`/shop/${item.productSlug}`}
      class="block text-sm font-medium leading-tight truncate hover:underline"
    >
      {item.title}
    </a>
    {#if item.paperName && item.paperWidth && item.paperHeight}
      <div class="text-xs text-surface-600-300-token lowercase truncate">
        {item.paperName} · {item.paperWidth}×{item.paperHeight}{item.borderWidth ? ` · ${item.borderWidth}" border` : ''}
      </div>
    {/if}

    <div class="flex items-center justify-between mt-1">
      <!-- Qty controls -->
      <div
        class="flex items-center border border-surface-500/30 rounded-md overflow-hidden"
      >
        <button
          type="button"
          onclick={decrement}
          aria-label="Decrease quantity"
          class="px-2 py-1 hover:bg-surface-500/10 transition-colors"
        >
          <MinusIcon class="size-3" />
        </button>
        <span
          class="px-2 text-sm tabular-nums min-w-[1.5rem] text-center"
          aria-live="polite"
        >
          {item.quantity}
        </span>
        <button
          type="button"
          onclick={increment}
          aria-label="Increase quantity"
          class="px-2 py-1 hover:bg-surface-500/10 transition-colors"
        >
          <PlusIcon class="size-3" />
        </button>
      </div>

      <!-- Line subtotal -->
      <div class="text-sm font-medium tabular-nums">
        {formatCents(lineSubtotal)}
      </div>
    </div>
  </div>

  <!-- Remove -->
  <button
    type="button"
    onclick={remove}
    aria-label={`Remove ${item.title}`}
    class="self-start p-1 -mt-1 -mr-1 text-surface-500 hover:text-error-500 transition-colors"
  >
    <XIcon class="size-4" />
  </button>
</div>
