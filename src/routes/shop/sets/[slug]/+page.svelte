<script lang="ts">
/**
 * Print Set Detail Page
 *
 * Renders lumaPrintSetV2 sets with the shared catalog-aware configurator.
 */
import SEO from "$lib/components/SEO.svelte";
import { cart } from "$lib/shop/cart.svelte";
import { showCartAddition } from "$lib/shop/cartFeedback";
import { toasts } from "$lib/stores/toast.svelte";
import { createPrintSelection } from "$lib/shop/printSelection.svelte";
import PrintConfigurator from "$lib/components/PrintConfigurator.svelte";
import PrintPurchase from "$lib/components/PrintPurchase.svelte";
import { printConfigurationCartFields } from "$lib/shop/printPurchase";
import type { ProductImage } from "$lib/types/shop";
import { createCheckout } from "$lib/utils/checkout";

let { data } = $props();

let isLoading = $state(false);

const selection = createPrintSelection(() => data.printSet);
const selectedConfiguration = $derived(selection.configuration);

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
		...printConfigurationCartFields(selectedConfiguration),
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

			<PrintPurchase
				configuration={selectedConfiguration}
				inStock={data.printSet.inStock}
				loading={isLoading}
				onAddToCart={handleAddToCart}
				onCheckout={handleCheckout}
			>
				<PrintConfigurator {selection} />
				<p class="payment-note">Secure checkout powered by Stripe</p>
			</PrintPurchase>
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
    .set-details { --print-purchase-actions-shrink: 0; }
    .payment-note { font-size: var(--text-xs); line-height: var(--text-xs--line-height); color: var(--color-surface-500); }
  }
</style>
