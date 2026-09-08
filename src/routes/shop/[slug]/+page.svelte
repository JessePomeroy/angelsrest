<script lang="ts">
import GalleryModal from "$lib/components/GalleryModal.svelte";
import SEO from "$lib/components/SEO.svelte";
import StickyMobileBar from "$lib/components/StickyMobileBar.svelte";
import { cart } from "$lib/shop/cart.svelte";
import { showCartAddition } from "$lib/shop/cartFeedback";
import { toasts } from "$lib/stores/toast.svelte";
import { getFrame, getPaper, getSize } from "@jessepomeroy/print-catalog";
import { createPrintSelection } from "$lib/shop/printSelection.svelte";
import PrintConfigurator from "$lib/components/PrintConfigurator.svelte";
import { createCheckout } from "$lib/utils/checkout";

let { data } = $props();

let modalOpen = $state(false);
let selectedIndex = $state(0);
let isLoading = $state(false);

const selection = createPrintSelection(() => data.productType === "v2" ? data.product : { variants: [] });
const selectedConfiguration = $derived(selection.configuration);

// ─── Shared ─────────────────────────────────────────────────
function openModal(index: number) {
	selectedIndex = index;
	modalOpen = true;
}

// Display price (variant retail + canvas/frame surcharges)
const displayPrice = $derived.by(() => {
	if (data.productType === "v2") {
		return selectedConfiguration?.displayPrice ?? null;
	}
	return data.product.price ?? null;
});
const displayPriceLabel = $derived(
	typeof displayPrice === "number" && Number.isFinite(displayPrice)
		? `$${displayPrice}`
		: "Out of stock",
);

// ─── V2 checkout/cart handlers ──────────────────────────────
function handleV2Checkout() {
	if (!selectedConfiguration) return;
	isLoading = true;

	createCheckout({
		productId: data.product.slug,
		coupon: null,
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

function handleV2AddToCart(event: MouseEvent) {
	if (!selectedConfiguration) return;
	cart.add({
		productSlug: data.product.slug,
		type: "print",
		title: data.product.title,
		imageUrl:
			data.product.images[0]?.original || data.product.images[0]?.full || "",
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

// ─── V1 checkout/cart handlers ──────────────────────────────
async function handleV1Checkout() {
	isLoading = true;
	try {
		const url = await createCheckout({
			productId: data.product.slug,
			coupon: null,
		});
		window.location.href = url;
	} catch (err: unknown) {
		console.error("Checkout error:", err);
		toasts.show(err instanceof Error ? err.message : "something went wrong. please try again.", { type: "error" });
	} finally {
		isLoading = false;
	}
}

const canAddToCartV1 = $derived(
	data.productType === "v1" &&
		data.product.category !== "digital" &&
		data.product.inStock,
);

function handleV1AddToCart(event: MouseEvent) {
	if (!canAddToCartV1) return;
	const priceDollars = data.product.price;
	if (typeof priceDollars !== "number") return;

	cart.add({
		productSlug: data.product.slug,
		type: "print",
		title: data.product.title,
		imageUrl:
			data.product.images[0]?.original || data.product.images[0]?.full || "",
		quantity: 1,
		unitPriceCents: Math.round(priceDollars * 100),
	});
	showCartAddition(event.currentTarget);
}
</script>

<SEO
	title={`${data.product.title} | shop | angel's rest`}
	description={data.product.description || `${data.product.title} - Available in the Angels Rest shop`}
	image={data.product.images[0]?.full || undefined}
	url={`https://angelsrest.online/shop/${data.product.slug}`}
/>

<div class="product-page">
	<a href="/shop" class="back-link">
		← Back to shop
	</a>

	<div class="product-layout">
		<!-- Image gallery (shared between V1 and V2) -->
		<div class="product-images">
			{#if data.product.images.length > 0}
				<button class="main-image-button" onclick={() => openModal(0)}>
					<img data-water-lens
						src={data.product.images[0].full}
						alt={data.product.images[0].alt}
						loading="lazy"
						class="main-image"
					/>
				</button>

				{#if data.product.images.length > 1}
					<div class="thumbnails">
						{#each data.product.images.slice(1) as image, i (image.full ?? i)}
							<button
								class="thumbnail-button"
								onclick={() => openModal(i + 1)}
							>
								<img data-water-lens
									src={image.thumbnail}
									alt={image.alt}
									loading="lazy"
									class="thumbnail-image"
								/>
							</button>
						{/each}
					</div>
				{/if}
			{:else}
				<div class="empty-images">
					<span class="empty-image-label">No image available</span>
				</div>
			{/if}
		</div>

		<!-- Product details -->
		<div class="product-details">
			<div>
				<h1 class="product-title">{data.product.title}</h1>
				{#if data.productType === "v1" && data.product.category}
					<span class="category-badge">
						{data.product.category.charAt(0).toUpperCase() + data.product.category.slice(1)}
					</span>
				{/if}
			</div>

			{#if data.product.description}
				<div class="description">
					<p>{data.product.description}</p>
				</div>
			{/if}

			<!-- Stock status -->
			<div class="stock-status">
				{#if data.product.inStock}
					<div class="in-stock-dot"></div>
					<span class="stock-label">In stock</span>
				{:else}
					<div class="out-of-stock-dot"></div>
					<span class="stock-label">Out of stock</span>
				{/if}
			</div>

			{#if data.productType === "v2"}
				<!-- ═══ V2 Configurator ═══ -->

				<!-- Desktop: inline price bar with buttons (no sticky needed) -->
				<div class="desktop-purchase">
					<div class="desktop-price">
						{#if selectedConfiguration}
							${displayPrice}
							<span class="desktop-selection">
								{getPaper(selection.paper)?.name ?? selection.paper} · {getSize(selection.size)?.label}{selection.border !== 'none' ? ` · ${selection.border}" border` : ''}{selection.frame !== 'none' ? ` · ${getFrame(selection.frame)?.label} frame` : ''}
							</span>
						{:else}
							<span class="selection-prompt">Select paper & size</span>
						{/if}
					</div>
					<div class="desktop-actions">
						{#if data.product.inStock && selectedConfiguration}
							<button class="desktop-cart-button" onclick={handleV2AddToCart}>
								add to cart
							</button>
							<button
								class="desktop-buy-button"
								disabled={isLoading}
								onclick={handleV2Checkout}
							>
								{isLoading ? "processing..." : "buy now"}
							</button>
						{:else if !data.product.inStock}
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
									<span class="mobile-price">${displayPrice}</span>
									<span class="mobile-selection" class:stuck={isStuck}>
										{getPaper(selection.paper)?.name ?? selection.paper} · {getSize(selection.size)?.label}{selection.border !== 'none' ? ` · ${selection.border}" border` : ''}{selection.frame !== 'none' ? ` · ${getFrame(selection.frame)?.label} frame` : ''}
									</span>
								{:else}
									<span class="mobile-selection-prompt">Select paper & size</span>
								{/if}
							</div>
							<div class="mobile-actions">
								{#if data.product.inStock && selectedConfiguration}
									<button class="mobile-cart-button" onclick={handleV2AddToCart}>
										add to cart
									</button>
									<button
										class="mobile-buy-button"
										disabled={isLoading}
										onclick={handleV2Checkout}
									>
										{isLoading ? "..." : "buy now"}
									</button>
								{:else if !data.product.inStock}
									<button class="mobile-buy-button" disabled>out of stock</button>
								{/if}
							</div>
						</div>
					{/snippet}
				</StickyMobileBar>
			{:else}
				<!-- ═══ V1 Layout (merch, postcards, tapestries, digital) ═══ -->

				<!-- Desktop: inline price + buttons -->
				<div class="desktop-purchase">
					<div class="desktop-price">
						{displayPriceLabel}
					</div>
					<div class="desktop-actions">
						{#if canAddToCartV1}
							<button class="desktop-cart-button" onclick={handleV1AddToCart}>
								add to cart
							</button>
						{/if}
						<button
							class="desktop-buy-button"
							disabled={!data.product.inStock || isLoading}
							onclick={handleV1Checkout}
						>
							{#if isLoading}
								processing...
							{:else if !data.product.inStock}
								out of stock
							{:else if data.product.category === "digital"}
								buy & download
							{:else}
								buy now
							{/if}
						</button>
					</div>
				</div>

				{#if data.product.category === "digital"}
					<p class="payment-note">instant download after payment</p>
				{/if}
				<p class="payment-note">
					Secure checkout powered by Stripe
				</p>

				<!-- Mobile: sticky bar -->
				<StickyMobileBar>
					{#snippet children(isStuck)}
						<div class="merch-purchase">
							<div class="merch-price-group">
								<span class="merch-price">{displayPriceLabel}</span>
								{#if data.product.category}
									<span class="mobile-category" class:stuck={isStuck}>
										{data.product.category}
									</span>
								{/if}
							</div>
							<div class="merch-actions">
								{#if canAddToCartV1}
									<button class="mobile-cart-button" onclick={handleV1AddToCart}>
										add to cart
									</button>
								{/if}
								<button
									class="mobile-buy-button"
									disabled={!data.product.inStock || isLoading}
									onclick={handleV1Checkout}
								>
									{#if isLoading}
										...
									{:else if !data.product.inStock}
										sold out
									{:else if data.product.category === "digital"}
										download
									{:else}
										buy now
									{/if}
								</button>
							</div>
						</div>
					{/snippet}
				</StickyMobileBar>
			{/if}
		</div>
	</div>
</div>

{#if modalOpen}
	<GalleryModal
		images={data.product.images}
		currentIndex={selectedIndex}
		onClose={() => (modalOpen = false)}
	/>
{/if}

<style>
  @layer components {
    .product-page { max-width: 72rem; margin-inline: auto; padding-inline: 1rem; }
    @media (min-width: 48rem) { .product-page { padding-inline: 2rem; } }
    .back-link { font-size: var(--text-sm); line-height: var(--text-sm--line-height); opacity: 0.7; margin-bottom: 1rem; display: inline-block; }
    @media (hover: hover) { .back-link:hover { opacity: 1.0; } }
    .product-layout { display: grid; gap: 2rem; }
    @media (min-width: 48rem) { .product-layout { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    .product-images > :global(:not(:last-child)) { margin-block-start: 0; margin-block-end: 1.0rem; }
    .main-image-button { width: 100%; }
    .main-image { width: 100%; height: auto; transition-property: transform, translate, scale, rotate; transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1); transition-duration: 150ms; border-radius: 0.375rem; }
    @media (hover: hover) { .main-image:hover { scale: 1.05; } }
    .thumbnails { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0.5rem; }
    .thumbnail-button { aspect-ratio: 1 / 1; overflow: hidden; border-radius: 0.375rem; }
    .thumbnail-image { width: 100%; height: 100%; object-fit: cover; transition-property: transform, translate, scale, rotate; transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1); transition-duration: 150ms; }
    @media (hover: hover) { .thumbnail-image:hover { scale: 1.05; } }
    .empty-images { aspect-ratio: 1 / 1; background-color: var(--color-surface-100); border-radius: 0.375rem; display: flex; align-items: center; justify-content: center; }
    :global(.dark) .empty-images { background-color: var(--color-surface-800); }
    .empty-image-label { color: var(--color-surface-500); }
    .product-details > :global(:not(:last-child)) { margin-block-start: 0; margin-block-end: 1.5rem; }
    .product-title { font-size: var(--text-3xl); }
    .category-badge { display: inline-flex; align-items: center; gap: 0.5rem; border-radius: 0.375rem; white-space: nowrap; font-size: var(--text-xs); line-height: var(--text-xs--line-height); padding-inline: 0.75rem; padding-block: 0.25rem; background-color: var(--color-surface-200); color: var(--color-surface-900); }
    :global(.dark) .category-badge { background-color: var(--color-surface-700); color: var(--color-surface-50); }
    .description { color: var(--color-surface-700); }
    :global(.dark) .description { color: var(--color-surface-200); }
    .stock-status { display: flex; align-items: center; gap: 0.5rem; }
    .in-stock-dot { width: 0.75rem; height: 0.75rem; border-radius: 9999px; background-color: var(--color-success-500); }
    .stock-label { font-size: var(--text-sm); line-height: var(--text-sm--line-height); color: var(--color-surface-600); }
    :global(.dark) .stock-label { color: var(--color-surface-300); }
    .out-of-stock-dot { width: 0.75rem; height: 0.75rem; border-radius: 9999px; background-color: var(--color-error-500); }
    .desktop-purchase { display: none; align-items: baseline; justify-content: space-between; gap: 1rem; padding-block: 0.5rem; }
    @media (min-width: 48rem) { .desktop-purchase { display: flex; } }
    .desktop-price { font-size: var(--text-3xl); line-height: var(--text-3xl--line-height); font-weight: 600; color: var(--color-surface-900); }
    :global(.dark) .desktop-price { color: var(--color-surface-50); }
    .desktop-selection { font-size: var(--text-base); line-height: var(--text-base--line-height); font-weight: 400; color: var(--color-surface-600); }
    :global(.dark) .desktop-selection { color: var(--color-surface-300); }
    .selection-prompt { font-size: var(--text-base); line-height: var(--text-base--line-height); color: var(--color-surface-500); }
    .desktop-actions { display: flex; gap: 0.5rem; }
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
    .mobile-purchase { display: grid; gap: 0.75rem; text-align: left; }
    .mobile-price-group { display: flex; align-items: baseline; gap: 0.375rem; }
    .mobile-price { font-size: var(--text-xl); line-height: var(--text-xl--line-height); font-weight: 600; }
    .mobile-selection { font-size: var(--text-xs); line-height: var(--text-xs--line-height); color: var(--color-surface-600); }
    :global(.dark) .mobile-selection { color: var(--color-surface-300); }
    .mobile-selection-prompt { font-size: var(--text-sm); line-height: var(--text-sm--line-height); color: var(--color-surface-500); }
    .mobile-actions { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); gap: 0.75rem; }
    .mobile-cart-button { display: inline-flex; align-items: center; justify-content: center; min-height: 44px; padding: 0.5rem 0.75rem; border-radius: 0.375rem; font-size: var(--text-sm); line-height: var(--text-sm--line-height); background: transparent; color: inherit; border: 1px solid currentColor; }
    .mobile-cart-button:focus-visible { outline: 2px solid currentColor; outline-offset: 3px; }
    .mobile-cart-button:disabled { opacity: 0.5; cursor: not-allowed; }
    .mobile-buy-button { display: inline-flex; align-items: center; justify-content: center; min-height: 44px; padding: 0.5rem 0.75rem; border-radius: 0.375rem; font-size: var(--text-sm); line-height: var(--text-sm--line-height); background: var(--time-accent, var(--color-primary-500)); color: oklch(12.9% 0.042 264.695); border: 1px solid transparent; }
    .mobile-buy-button:focus-visible { outline: 2px solid var(--purchase-focus-color); outline-offset: 3px; }
    .mobile-buy-button:disabled { opacity: 0.5; cursor: not-allowed; }
    @media (hover: hover) { .mobile-buy-button:hover:not(:disabled) { filter: brightness(0.95); } }
    .merch-purchase { display: grid; gap: 0.75rem; text-align: left; }
    .merch-price-group { display: flex; align-items: center; gap: 0.375rem; min-width: 0rem; }
    .merch-price { font-size: var(--text-xl); line-height: var(--text-xl--line-height); font-weight: 600; flex-shrink: 0; }
    .mobile-category { font-size: var(--text-xs); line-height: var(--text-xs--line-height); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--color-surface-600); }
    :global(.dark) .mobile-category { color: var(--color-surface-300); }
    .merch-actions { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); gap: 0.75rem; }
    .mobile-selection.stuck, .mobile-category.stuck { color: var(--color-surface-300); }
  }
</style>
