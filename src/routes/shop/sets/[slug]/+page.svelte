<script lang="ts">
/**
 * Print Set Detail Page
 *
 * Renders lumaPrintSetV2 sets with the shared catalog-aware configurator.
 */
import SEO from "$lib/components/SEO.svelte";
import StickyMobileBar from "$lib/components/StickyMobileBar.svelte";
import { cart } from "$lib/shop/cart.svelte";
import { showCartAddition } from "$lib/shop/cartFeedback";
import { toasts } from "$lib/stores/toast.svelte";
import { getFrame, getPaper, getSize } from "@jessepomeroy/print-catalog";
import { createPrintSelection } from "$lib/shop/printSelection.svelte";
import PrintConfigurator from "$lib/components/PrintConfigurator.svelte";
import type { ProductImage } from "$lib/types/shop";
import { createCheckout } from "$lib/utils/checkout";

let { data } = $props();

let isLoading = $state(false);

const selection = createPrintSelection(() => data.printSet);
const selectedConfiguration = $derived(selection.configuration);

const displaySetPrice = $derived.by(() => {
	return selectedConfiguration?.displayPrice ?? null;
});

function handleCheckout() {
	if (!selectedConfiguration) return;
	isLoading = true;

	createCheckout({
		productId: data.printSet.slug,
		coupon: null,
		isPrintSet: true,
		paperSlug: selectedConfiguration.paperSlug,
		sizeSlug: selectedConfiguration.sizeSlug,
		borderWidth: selectedConfiguration.borderWidthValue,
		frame: selectedConfiguration.frameValue,
	})
		.then((url) => {
			window.location.href = url;
		})
		.catch((err: unknown) => {
			console.error("Checkout error:", err);
			toasts.show(err instanceof Error ? err.message : "something went wrong. please try again.", { type: "error" });
		})
		.finally(() => {
			isLoading = false;
		});
}

function handleAddToCart(event: MouseEvent) {
	if (!selectedConfiguration) return;

	const originalUrls = (data.images as ProductImage[]).map(
		(img) => img.original,
	);
	if (originalUrls.length === 0) return;

	cart.add({
		productSlug: data.printSet.slug,
		type: "set",
		title: data.printSet.title,
		imageUrl: data.printSet.previewImage || originalUrls[0],
		imageUrls: originalUrls,
		paperName: selectedConfiguration.paper.name,
		paperSubcategoryId: selectedConfiguration.paperSubcategoryId,
		paperWidth: selectedConfiguration.size.width,
		paperHeight: selectedConfiguration.size.height,
		paperSlug: selectedConfiguration.paperSlug,
		sizeSlug: selectedConfiguration.sizeSlug,
		borderWidthValue: selectedConfiguration.borderWidthValue,
		frameValue: selectedConfiguration.frameValue,
		...(selectedConfiguration.borderWidth
			? { borderWidth: selectedConfiguration.borderWidth }
			: {}),
		...(selectedConfiguration.frameSubcategoryId
			? { frameSubcategoryId: selectedConfiguration.frameSubcategoryId }
			: {}),
		...(selectedConfiguration.canvas
			? {
					canvasSubcategoryId: selectedConfiguration.canvas.subcategoryId,
					canvasWrapHex: selectedConfiguration.canvas.wrapHex,
				}
			: {}),
		quantity: 1,
		unitPriceCents: Math.round(selectedConfiguration.displayPrice * 100),
	});
	showCartAddition(event.currentTarget);
}
</script>

<SEO
	title="{data.printSet.title} | angel's rest"
	description={data.printSet.description || `Print set: ${data.printSet.title}`}
	url="https://angelsrest.online/shop/sets/{data.printSet.slug}"
/>

<div class="set-page">
	<a href="/shop" class="back-link">
		← Back to shop
		{#if data.printSet.parent}
			<span class="breadcrumb-separator">/</span>
			{data.printSet.parent.title}
		{/if}
	</a>

	<div class="set-layout">
		<!-- Images grid -->
		<div class="set-images">
			{#if data.images.length > 0}
				<div class="image-columns">
					{#each data.images as image (image.full ?? image.thumb)}
						<div class="image-cell">
							<img data-water-lens
								src={(image as ProductImage).thumb}
								alt={image.alt}
								loading="lazy"
								class="set-image"
							/>
						</div>
					{/each}
				</div>
			{:else}
				<div class="empty-images">
					<span class="empty-image-label">No images</span>
				</div>
			{/if}
		</div>

		<!-- Product details -->
		<div class="set-details">
			<div>
				<h1 class="set-title">{data.printSet.title}</h1>
				<span class="set-meta">
					{data.images.length} print{data.images.length === 1 ? "" : "s"} in this set
				</span>
			</div>

			{#if data.printSet.description}
				<div class="set-description">
					<p>{data.printSet.description}</p>
				</div>
			{/if}

			<!-- Stock status -->
			<div class="stock-status">
				{#if data.printSet.inStock}
					<div class="in-stock-dot"></div>
					<span class="set-meta">In stock</span>
				{:else}
					<div class="out-of-stock-dot"></div>
					<span class="set-meta">Out of stock</span>
				{/if}
			</div>

			<!-- Desktop: inline price + buttons -->
			<div class="desktop-purchase">
				<div class="desktop-price">
					{#if selectedConfiguration}
						${displaySetPrice}
						<span class="desktop-selection">
							{getPaper(selection.paper)?.name} · {getSize(selection.size)?.label}{selection.border !== 'none' ? ` · ${selection.border}" border` : ''}{selection.frame !== 'none' ? ` · ${getFrame(selection.frame)?.label} frame` : ''}
						</span>
					{:else}
						<span class="selection-prompt">Select paper & size</span>
					{/if}
				</div>
				<div class="desktop-actions">
					{#if data.printSet.inStock && selectedConfiguration}
						<button class="desktop-cart-button" onclick={handleAddToCart}>
							add to cart
						</button>
						<button
							class="desktop-buy-button"
							disabled={isLoading}
							onclick={handleCheckout}
						>
							{isLoading ? "processing..." : "buy now"}
						</button>
					{:else if !data.printSet.inStock}
						<button class="desktop-buy-button" disabled>out of stock</button>
					{/if}
				</div>
			</div>

			<PrintConfigurator {selection} />

			<p class="payment-note">
				Secure checkout powered by Stripe
			</p>

			<StickyMobileBar>
				{#snippet children(isStuck)}
					<div class="mobile-purchase">
						<div class="mobile-price-group">
							{#if selectedConfiguration}
								<span class="mobile-price">${displaySetPrice}</span>
								<span class="mobile-selection" class:stuck={isStuck}>
									{getPaper(selection.paper)?.name} · {getSize(selection.size)?.label}{selection.border !== 'none' ? ` · ${selection.border}" border` : ''}{selection.frame !== 'none' ? ` · ${getFrame(selection.frame)?.label} frame` : ''}
								</span>
							{:else}
								<span class="mobile-selection-prompt">Select paper & size</span>
							{/if}
						</div>
						<div class="mobile-actions">
							{#if data.printSet.inStock && selectedConfiguration}
								<button class="mobile-cart-button" onclick={handleAddToCart}>
									add to cart
								</button>
								<button
									class="mobile-buy-button"
									disabled={isLoading}
									onclick={handleCheckout}
								>
									{isLoading ? "..." : "buy now"}
								</button>
							{:else if !data.printSet.inStock}
								<button class="mobile-buy-button" disabled>out of stock</button>
							{/if}
						</div>
					</div>
				{/snippet}
			</StickyMobileBar>
		</div>
	</div>
</div>

<style>
  @layer components {
    .set-page { max-width: 72rem; margin-inline: auto; padding-inline: 1rem; }
    @media (min-width: 48rem) { .set-page { padding-inline: 2rem; } }
    .back-link { font-size: var(--text-sm); line-height: var(--text-sm--line-height); opacity: 0.7; margin-bottom: 1rem; display: inline-block; }
    @media (hover: hover) { .back-link:hover { opacity: 1.0; } }
    .breadcrumb-separator { margin-inline: 0.5rem; color: var(--color-surface-500); }
    .set-layout { display: grid; gap: 2rem; }
    @media (min-width: 48rem) { .set-layout { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    .set-images > :global(:not(:last-child)) { margin-block-start: 0; margin-block-end: 1.0rem; }
    .image-columns { column-count: 2; gap: 0.5rem; }
    .image-cell { margin-bottom: 0.5rem; break-inside: avoid; }
    .set-image { width: 100%; height: auto; border-radius: 0.375rem; }
    .empty-images { aspect-ratio: 1 / 1; background-color: var(--color-surface-100); border-radius: 0.375rem; display: flex; align-items: center; justify-content: center; }
    :global(.dark) .empty-images { background-color: var(--color-surface-800); }
    .empty-image-label { color: var(--color-surface-500); }
    .set-details > :global(:not(:last-child)) { margin-block-start: 0; margin-block-end: 1.5rem; }
    .set-title { font-size: var(--text-3xl); }
    .set-meta { font-size: var(--text-sm); line-height: var(--text-sm--line-height); color: var(--color-surface-600); }
    :global(.dark) .set-meta { color: var(--color-surface-300); }
    .set-description { color: var(--color-surface-700); }
    :global(.dark) .set-description { color: var(--color-surface-200); }
    .stock-status { display: flex; align-items: center; gap: 0.5rem; }
    .in-stock-dot { width: 0.75rem; height: 0.75rem; border-radius: 9999px; background-color: var(--color-success-500); }
    .out-of-stock-dot { width: 0.75rem; height: 0.75rem; border-radius: 9999px; background-color: var(--color-error-500); }
    .desktop-purchase { display: none; align-items: baseline; justify-content: space-between; gap: 1rem; padding-block: 0.5rem; }
    @media (min-width: 48rem) { .desktop-purchase { display: flex; } }
    .desktop-price { font-size: var(--text-3xl); line-height: var(--text-3xl--line-height); font-weight: 600; color: var(--color-surface-900); }
    :global(.dark) .desktop-price { color: var(--color-surface-50); }
    .desktop-selection { font-size: var(--text-base); line-height: var(--text-base--line-height); font-weight: 400; color: var(--color-surface-600); }
    :global(.dark) .desktop-selection { color: var(--color-surface-300); }
    .selection-prompt { font-size: var(--text-base); line-height: var(--text-base--line-height); color: var(--color-surface-500); }
    .desktop-actions { display: flex; gap: 0.5rem; flex-shrink: 0; }
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
    .payment-note { font-size: var(--text-xs); line-height: var(--text-xs--line-height); color: var(--color-surface-500); }
    .mobile-purchase { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; column-gap: 1rem; row-gap: 0.25rem; }
    .mobile-price-group { display: flex; align-items: center; gap: 0.375rem; }
    .mobile-price { font-size: var(--text-xl); line-height: var(--text-xl--line-height); font-weight: 600; }
    .mobile-selection { font-size: var(--text-xs); line-height: var(--text-xs--line-height); color: var(--color-surface-600); }
    :global(.dark) .mobile-selection { color: var(--color-surface-300); }
    .mobile-selection-prompt { font-size: var(--text-sm); line-height: var(--text-sm--line-height); color: var(--color-surface-500); }
    .mobile-actions { display: flex; gap: 0.375rem; }
    .mobile-cart-button { display: inline-flex; align-items: center; justify-content: center; gap: 0.5rem; border-radius: 0.375rem; white-space: nowrap; font-size: var(--text-xs); line-height: var(--text-xs--line-height); padding-inline: 0.5rem; padding-block: 0.25rem; transition-property: color, background-color, border-color, outline-color, text-decoration-color, fill, stroke; transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1); transition-duration: 150ms; background-color: var(--color-surface-200); color: var(--color-surface-900); }
    .mobile-cart-button:focus-visible { outline-style: solid; outline-width: 2px; outline-offset: 2px; outline-color: var(--color-surface-900); }
    :global(.dark) .mobile-cart-button:focus-visible { outline-color: var(--color-surface-50); }
    .mobile-cart-button:disabled { opacity: 0.5; cursor: not-allowed; }
    :global(.dark) .mobile-cart-button { background-color: var(--color-surface-700); color: var(--color-surface-50); }
    .mobile-buy-button { display: inline-flex; align-items: center; justify-content: center; gap: 0.5rem; border-radius: 0.375rem; white-space: nowrap; font-size: var(--text-xs); line-height: var(--text-xs--line-height); padding-inline: 0.5rem; padding-block: 0.25rem; transition-property: color, background-color, border-color, outline-color, text-decoration-color, fill, stroke; transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1); transition-duration: 150ms; background-color: var(--color-primary-500); color: oklch(12.9% 0.042 264.695); }
    .mobile-buy-button:focus-visible { outline-style: solid; outline-width: 2px; outline-offset: 2px; outline-color: var(--color-surface-900); }
    :global(.dark) .mobile-buy-button:focus-visible { outline-color: var(--color-surface-50); }
    .mobile-buy-button:disabled { opacity: 0.5; cursor: not-allowed; }
    @media (hover: hover) { .mobile-buy-button:hover:not(:disabled) { background-color: color-mix(in oklab, var(--color-primary-500) 80%, transparent); } }
    .mobile-selection.stuck { color: var(--color-surface-300); }
  }
</style>
