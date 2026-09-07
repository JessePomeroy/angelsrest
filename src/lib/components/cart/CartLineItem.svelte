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
import { formatCents } from "$lib/utils/format";

interface Props {
	item: CartItem;
	/** "drawer" tightens spacing for the side panel; "page" gives more room. */
	variant?: "drawer" | "page";
}

let { item, variant = "drawer" }: Props = $props();

const lineSubtotal = $derived(item.unitPriceCents * item.quantity);

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
  class="cart-line" class:page-line={variant === "page"}
>
  <!-- Thumbnail -->
  <div
    class="thumbnail"
  >
    {#if item.imageUrl}
      <img
        src={item.imageUrl}
        alt={item.title}
        loading="lazy"
        class="product-image"
      />
    {/if}
    {#if extraImageCount > 0}
      <span
        aria-hidden="true"
        class="extra-images"
      >
        +{extraImageCount}
      </span>
    {/if}
  </div>

  <!-- Body -->
  <div class="line-body">
    <!--
      Block layout is required for the title to actually clip — anchors are
      `display: inline` by default, where overflow/text-ellipsis are
      no-ops. Without this, a long product title (e.g. the godzilla
      tapestry) overflows its parent flex column, pushes the price + X
      button off-screen, AND inflates the page width past the viewport
      so the order summary below also clips.
    -->
    <a
      href={`/shop/${item.productSlug}`}
      class="product-title"
    >
      {item.title}
    </a>
    {#if item.paperName && item.paperWidth && item.paperHeight}
      <div class="print-details">
        {item.paperName} · {item.paperWidth}×{item.paperHeight}{item.canvasSubcategoryId ? ' · canvas' : ''}{item.borderWidth ? ` · ${item.borderWidth}" border` : ''}{item.frameSubcategoryId ? ' · framed' : ''}
      </div>
    {/if}

    <div class="line-controls">
      <!-- Qty controls -->
      <div
        class="quantity-controls"
      >
        <button
          type="button"
          onclick={decrement}
          aria-label="Decrease quantity"
          class="quantity-button"
        >
          <MinusIcon size="0.75rem" />
        </button>
        <span
          class="quantity"
          aria-live="polite"
        >
          {item.quantity}
        </span>
        <button
          type="button"
          onclick={increment}
          aria-label="Increase quantity"
          class="quantity-button"
        >
          <PlusIcon size="0.75rem" />
        </button>
      </div>

      <!-- Line subtotal -->
      <div class="line-total">
        {formatCents(lineSubtotal)}
      </div>
    </div>
  </div>

  <!-- Remove -->
  <button
    type="button"
    onclick={remove}
    aria-label={`Remove ${item.title}`}
    class="remove-button"
  >
    <XIcon size="1rem" />
  </button>
</div>

<style>
  @layer components {
    .cart-line { display: flex; gap: 0.75rem; padding-block: 1rem; border-bottom: 1px solid; border-color: color-mix(in oklab, var(--color-surface-500) 15%, transparent); }
    .thumbnail { position: relative; flex-shrink: 0; width: 4rem; height: 4rem; overflow: hidden; border-radius: 0.375rem; background-color: color-mix(in oklab, var(--color-surface-500) 10%, transparent); }
    .product-image { width: 100%; height: 100%; object-fit: cover; }
    .extra-images { position: absolute; bottom: 0; right: 0; padding-inline: 0.25rem; padding-block: 0.125rem; font-size: 10px; font-weight: 500; background-color: color-mix(in oklab, oklch(21% 0.034 264.665) 80%, transparent); color: var(--color-surface-50); border-top-left-radius: 0.375rem; }
    .line-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 0.25rem; }
    .product-title { display: block; font-size: var(--text-sm); line-height: var(--text-sm--line-height); font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; line-height: 1.25; }
    @media (hover: hover) { .product-title:hover { text-decoration-line: underline; } }
    .print-details { font-size: var(--text-xs); line-height: var(--text-xs--line-height); color: var(--color-surface-600); text-transform: lowercase; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    :global(.dark) .print-details { color: var(--color-surface-300); }
    .line-controls { display: flex; align-items: center; justify-content: space-between; margin-top: 0.25rem; }
    .quantity-controls { display: flex; align-items: center; border: 1px solid; border-color: color-mix(in oklab, var(--color-surface-500) 30%, transparent); border-radius: 0.375rem; overflow: hidden; }
    .quantity-button { padding-inline: 0.5rem; padding-block: 0.25rem; transition-property: color, background-color, border-color, outline-color, text-decoration-color, fill, stroke; transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1); transition-duration: 150ms; }
    @media (hover: hover) { .quantity-button:hover { background-color: color-mix(in oklab, var(--color-surface-500) 10%, transparent); } }
    .quantity { padding-inline: 0.5rem; font-size: var(--text-sm); line-height: var(--text-sm--line-height); font-variant-numeric: tabular-nums; min-width: 1.5rem; text-align: center; }
    .line-total { font-size: var(--text-sm); line-height: var(--text-sm--line-height); font-weight: 500; font-variant-numeric: tabular-nums; }
    .remove-button { align-self: flex-start; padding: 0.25rem; margin-top: -0.25rem; margin-right: -0.25rem; color: var(--color-surface-500); transition-property: color, background-color, border-color, outline-color, text-decoration-color, fill, stroke; transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1); transition-duration: 150ms; }
    @media (hover: hover) { .remove-button:hover { color: var(--color-error-500); } }
    .page-line { padding-block: 1.25rem; }
    .page-line .thumbnail { width: 5rem; height: 5rem; }
    @media (min-width: 48rem) { .page-line .thumbnail { width: 6rem; height: 6rem; } }
  }
</style>
