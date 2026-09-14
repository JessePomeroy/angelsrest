<script lang="ts">
import type { Snippet } from "svelte";
import type { ResolvedPrintConfiguration } from "$lib/shop/printConfigurator";
import StickyMobileBar from "./StickyMobileBar.svelte";

let {
	configuration, inStock, loading, onAddToCart, onCheckout, children,
}: {
	configuration: ResolvedPrintConfiguration | null;
	inStock: boolean;
	loading: boolean;
	onAddToCart: (event: MouseEvent) => void;
	onCheckout: () => void;
	children: Snippet;
} = $props();

const summary = $derived(configuration
	? `${configuration.paper.name} · ${configuration.size.label}${configuration.borderWidthValue !== "none" ? ` · ${configuration.borderWidthValue}" border` : ""}${configuration.frameValue !== "none" ? ` · ${configuration.frame.label} frame` : ""}`
	: "");
</script>

<!-- Desktop: inline price + buttons -->
<div class="desktop-purchase">
	<div class="desktop-price">
		{#if configuration}
			${configuration.displayPrice}
			<span class="desktop-selection">
				{summary}
			</span>
		{:else}
			<span class="selection-prompt">Select paper & size</span>
		{/if}
	</div>
	<div class="desktop-actions">
		{#if inStock && configuration}
			<button class="desktop-cart-button" onclick={onAddToCart}>
				add to cart
			</button>
			<button
				class="desktop-buy-button"
				disabled={loading}
				onclick={onCheckout}
			>
				{loading ? "processing..." : "buy now"}
			</button>
		{:else if !inStock}
			<button class="desktop-buy-button" disabled>out of stock</button>
		{/if}
	</div>
</div>

{@render children()}

<StickyMobileBar>
	{#snippet children(isStuck)}
		<div class="mobile-purchase">
			<div class="mobile-price-group">
				{#if configuration}
					<span class="mobile-price">${configuration.displayPrice}</span>
					<span class="mobile-selection" class:stuck={isStuck}>
						{summary}
					</span>
				{:else}
					<span class="mobile-selection-prompt">Select paper & size</span>
				{/if}
			</div>
			<div class="mobile-actions">
				{#if inStock && configuration}
					<button class="mobile-cart-button" onclick={onAddToCart}>
						add to cart
					</button>
					<button
						class="mobile-buy-button"
						disabled={loading}
						onclick={onCheckout}
					>
						{loading ? "..." : "buy now"}
					</button>
				{:else if !inStock}
					<button class="mobile-buy-button" disabled>out of stock</button>
				{/if}
			</div>
		</div>
	{/snippet}
</StickyMobileBar>

<style>
  @layer components {
    .desktop-purchase { display: none; align-items: baseline; justify-content: space-between; gap: 1rem; padding-block: 0.5rem; }
    @media (min-width: 48rem) { .desktop-purchase { display: flex; } }
    .desktop-price { font-size: var(--text-3xl); line-height: var(--text-3xl--line-height); font-weight: 600; color: var(--color-surface-900); }
    :global(.dark) .desktop-price { color: var(--color-surface-50); }
    .desktop-selection { font-size: var(--text-base); line-height: var(--text-base--line-height); font-weight: 400; color: var(--color-surface-600); }
    :global(.dark) .desktop-selection { color: var(--color-surface-300); }
    .selection-prompt { font-size: var(--text-base); line-height: var(--text-base--line-height); color: var(--color-surface-500); }
    .desktop-actions { display: flex; gap: 0.5rem; flex-shrink: var(--print-purchase-actions-shrink, 1); }
    .desktop-cart-button { display: inline-flex; align-items: center; justify-content: center; gap: 0.5rem; border-radius: 0.375rem; white-space: nowrap; font-size: var(--text-xs); line-height: var(--text-xs--line-height); padding-inline: 0.75rem; padding-block: 0.25rem; transition-property: color, background-color, border-color, outline-color, text-decoration-color, fill, stroke; transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1); transition-duration: 150ms; background-color: var(--color-surface-200); color: var(--color-surface-900); }
    .desktop-cart-button:focus-visible { outline-style: solid; outline-width: 2px; outline-offset: 2px; outline-color: var(--color-surface-900); }
    :global(.dark) .desktop-cart-button:focus-visible { outline-color: var(--color-surface-50); }
    .desktop-cart-button:disabled { opacity: 0.5; cursor: not-allowed; }
    :global(.dark) .desktop-cart-button { background-color: var(--color-surface-700); color: var(--color-surface-50); }
    .desktop-buy-button { display: inline-flex; align-items: center; justify-content: center; gap: 0.5rem; border-radius: 0.375rem; white-space: nowrap; font-size: var(--text-xs); line-height: var(--text-xs--line-height); padding-inline: 0.75rem; padding-block: 0.25rem; transition-property: color, background-color, border-color, outline-color, text-decoration-color, fill, stroke; transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1); transition-duration: 150ms; background-color: var(--color-primary-500); color: oklch(12.9% 0.042 264.695); }
    .desktop-buy-button:focus-visible { outline-style: solid; outline-width: 2px; outline-offset: 2px; outline-color: var(--color-surface-900); }
    :global(.dark) .desktop-buy-button:focus-visible { outline-color: var(--color-surface-50); }
    .desktop-buy-button:disabled { opacity: 0.5; cursor: not-allowed; }
    @media (hover: hover) { .desktop-buy-button:hover:not(:disabled) { background-color: color-mix(in oklab, var(--color-primary-500) 80%, transparent); } }
    .mobile-purchase { display: grid; gap: 0.75rem; text-align: left; }
    .mobile-price-group { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.375rem; }
    .mobile-price { flex: 0 0 auto; font-size: var(--text-xl); line-height: var(--text-xl--line-height); font-weight: 600; }
    .mobile-selection { flex: 1 1 12ch; min-inline-size: 0; overflow-wrap: anywhere; font-size: var(--text-xs); line-height: var(--text-xs--line-height); color: var(--color-surface-600); }
    :global(.dark) .mobile-selection { color: var(--color-surface-300); }
    .mobile-selection-prompt { font-size: var(--text-sm); line-height: var(--text-sm--line-height); color: var(--color-surface-500); }
    .mobile-actions { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 7rem), 1fr)); gap: 0.75rem; }
    .mobile-cart-button { display: inline-flex; align-items: center; justify-content: center; min-height: 44px; padding: 0.5rem 0.75rem; border-radius: 0.375rem; font-size: var(--text-sm); line-height: var(--text-sm--line-height); background: transparent; color: inherit; border: 1px solid currentColor; }
    .mobile-cart-button:focus-visible { outline: 2px solid currentColor; outline-offset: 3px; }
    .mobile-cart-button:disabled { opacity: 0.5; cursor: not-allowed; }
    .mobile-buy-button { display: inline-flex; align-items: center; justify-content: center; min-height: 44px; padding: 0.5rem 0.75rem; border-radius: 0.375rem; font-size: var(--text-sm); line-height: var(--text-sm--line-height); background: var(--time-accent, var(--color-primary-500)); color: oklch(12.9% 0.042 264.695); border: 1px solid transparent; }
    .mobile-buy-button:focus-visible { outline: 2px solid var(--purchase-focus-color); outline-offset: 3px; }
    .mobile-buy-button:disabled { opacity: 0.5; cursor: not-allowed; }
    @media (hover: hover) { .mobile-buy-button:hover:not(:disabled) { filter: brightness(0.95); } }
    .mobile-selection.stuck { color: var(--color-surface-300); }
  }
</style>
