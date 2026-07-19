<script lang="ts">
/**
 * Print Set Detail Page
 *
 * Renders lumaPrintSetV2 sets with the shared catalog-aware configurator.
 */
import SEO from "$lib/components/SEO.svelte";
import StickyMobileBar from "$lib/components/StickyMobileBar.svelte";
import { cart } from "$lib/shop/cart.svelte";
import { cartUI } from "$lib/shop/cartUI.svelte";
import { toasts } from "$lib/stores/toast.svelte";
import {
	getFrame,
	getPaper,
	getSize,
	isCanvasPaper,
	V2_BORDER_OPTIONS,
	V2_FRAME_OPTIONS,
} from "$lib/shop/printCatalog";
import {
	getAvailablePrintPapers,
	getAvailablePrintSizes,
	normalizePrintFinishSelection,
	resolvePrintConfiguration,
} from "$lib/shop/printConfigurator";
import type { ProductImage } from "$lib/types/shop";
import { createCheckout } from "$lib/utils/checkout";

let { data } = $props();

let couponCode = $state("");
let isLoading = $state(false);

// ─── Configurator state ─────────────────────────────────────
let selectedPaperSlug = $state("");
let selectedSizeSlug = $state("");
let selectedBorderWidth = $state("none");
let selectedFrame = $state("none");

const isCanvasSelected = $derived(isCanvasPaper(selectedPaperSlug));

// Keep the form controls synchronized with the shared finish invariants.
$effect(() => {
	const normalized = normalizePrintFinishSelection({
		paperSlug: selectedPaperSlug,
		borderWidthValue: selectedBorderWidth,
		frameValue: selectedFrame,
	});
	if (selectedBorderWidth !== normalized.borderWidthValue) {
		selectedBorderWidth = normalized.borderWidthValue;
	}
	if (selectedFrame !== normalized.frameValue) {
		selectedFrame = normalized.frameValue;
	}
});

const availablePapers = $derived(getAvailablePrintPapers(data.printSet.variants));

$effect(() => {
	if (availablePapers.length > 0 && !selectedPaperSlug) {
		selectedPaperSlug = availablePapers[0].slug;
	}
});

const availableSizes = $derived.by(() => {
	if (!selectedPaperSlug) return [];
	return getAvailablePrintSizes(data.printSet.variants, selectedPaperSlug);
});

$effect(() => {
	if (
		availableSizes.length > 0 &&
		!availableSizes.some((size) => size.slug === selectedSizeSlug)
	) {
		selectedSizeSlug = availableSizes[0].slug;
	}
});

const selectedConfiguration = $derived.by(() => {
	return resolvePrintConfiguration({
		variants: data.printSet.variants,
		paperSlug: selectedPaperSlug,
		sizeSlug: selectedSizeSlug,
		borderWidthValue: selectedBorderWidth,
		frameValue: selectedFrame,
		bordersEnabled: data.printSet.bordersEnabled,
		framedEnabled: data.printSet.framedEnabled,
		frameMarkupMultiplier: data.printSet.frameMarkupMultiplier,
	});
});

const displaySetPrice = $derived.by(() => {
	return selectedConfiguration?.displayPrice ?? null;
});

function handleCheckout() {
	if (!selectedConfiguration) return;
	isLoading = true;

	createCheckout({
		productId: data.printSet.slug,
		coupon: couponCode.trim() || null,
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

function handleAddToCart() {
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
	cartUI.open();
}
</script>

<SEO
	title="{data.printSet.title} | angel's rest"
	description={data.printSet.description || `Print set: ${data.printSet.title}`}
	url="https://angelsrest.online/shop/sets/{data.printSet.slug}"
/>

<div class="max-w-6xl mx-auto px-4 md:px-8">
	<a href="/shop" class="text-sm opacity-70 hover:opacity-100 mb-4 inline-block">
		← Back to shop
		{#if data.printSet.parent}
			<span class="mx-2 text-surface-500">/</span>
			{data.printSet.parent.title}
		{/if}
	</a>

	<div class="grid md:grid-cols-2 gap-8">
		<!-- Images grid -->
		<div class="space-y-4">
			{#if data.images.length > 0}
				<div class="columns-2 gap-2">
					{#each data.images as image (image.full ?? image.thumb)}
						<div class="mb-2 break-inside-avoid">
							<img
								src={(image as ProductImage).thumb}
								alt={image.alt}
								loading="lazy"
								class="w-full h-auto rounded-md"
							/>
						</div>
					{/each}
				</div>
			{:else}
				<div class="aspect-square bg-surface-100-800-token rounded-md flex items-center justify-center">
					<span class="text-surface-500">No images</span>
				</div>
			{/if}
		</div>

		<!-- Product details -->
		<div class="space-y-6">
			<div>
				<h1 class="text-3xl font-semibold mb-2">{data.printSet.title}</h1>
				<span class="text-sm text-surface-600-300-token">
					{data.images.length} print{data.images.length === 1 ? "" : "s"} in this set
				</span>
			</div>

			{#if data.printSet.description}
				<div class="text-surface-700-200-token">
					<p>{data.printSet.description}</p>
				</div>
			{/if}

			<!-- Stock status -->
			<div class="flex items-center gap-2">
				{#if data.printSet.inStock}
					<div class="w-3 h-3 rounded-full bg-success-500"></div>
					<span class="text-sm text-surface-600-300-token">In stock</span>
				{:else}
					<div class="w-3 h-3 rounded-full bg-error-500"></div>
					<span class="text-sm text-surface-600-300-token">Out of stock</span>
				{/if}
			</div>

			<!-- Desktop: inline price + buttons -->
			<div class="hidden md:flex items-baseline justify-between gap-4 py-2">
				<div class="text-3xl font-semibold text-surface-900-50-token">
					{#if selectedConfiguration}
						${displaySetPrice}
						<span class="text-base font-normal text-surface-600-300-token">
							{getPaper(selectedPaperSlug)?.name} · {getSize(selectedSizeSlug)?.label}{selectedBorderWidth !== 'none' ? ` · ${selectedBorderWidth}" border` : ''}{selectedFrame !== 'none' ? ` · ${getFrame(selectedFrame)?.label} frame` : ''}
						</span>
					{:else}
						<span class="text-base text-surface-500">Select paper & size</span>
					{/if}
				</div>
				<div class="flex gap-2 shrink-0">
					{#if data.printSet.inStock && selectedConfiguration}
						<button class="btn btn-sm variant-soft-surface" onclick={handleAddToCart}>
							add to cart
						</button>
						<button
							class="btn btn-sm variant-filled-primary"
							disabled={isLoading}
							onclick={handleCheckout}
						>
							{isLoading ? "processing..." : "buy now"}
						</button>
					{:else if !data.printSet.inStock}
						<button class="btn btn-sm variant-filled-primary" disabled>out of stock</button>
					{/if}
				</div>
			</div>

			<div class="space-y-4">
				<div>
					<label for="set-paper" class="block text-sm text-surface-600-300-token mb-1">
						Material
					</label>
					<select id="set-paper" class="select w-full" bind:value={selectedPaperSlug}>
						{#each availablePapers as paper (paper.slug)}
							<option value={paper.slug}>{paper.name}</option>
						{/each}
					</select>
				</div>
				<div>
					<label for="set-size" class="block text-sm text-surface-600-300-token mb-1">
						Size
					</label>
					<select id="set-size" class="select w-full" bind:value={selectedSizeSlug}>
						{#each availableSizes as size (size.slug)}
							<option value={size.slug}>{size.label}</option>
						{/each}
					</select>
				</div>

				{#if data.printSet.bordersEnabled !== false && !isCanvasSelected}
					<div>
						<label for="set-border" class="block text-sm text-surface-600-300-token mb-1">
							Border
						</label>
						<select
							id="set-border"
							class="select w-full"
							bind:value={selectedBorderWidth}
							disabled={selectedFrame !== 'none'}
						>
							{#each V2_BORDER_OPTIONS as border (border.value)}
								<option value={border.value}>{border.label}</option>
							{/each}
						</select>
						{#if selectedFrame !== 'none'}
							<p class="text-xs text-surface-500 mt-1">border included with frame</p>
						{/if}
					</div>
				{/if}

				{#if data.printSet.framedEnabled && !isCanvasSelected}
					<div>
						<label for="set-frame" class="block text-sm text-surface-600-300-token mb-1">
							Frame
						</label>
						<select id="set-frame" class="select w-full" bind:value={selectedFrame}>
							{#each V2_FRAME_OPTIONS as frame (frame.value)}
								<option value={frame.value}>{frame.label}</option>
							{/each}
						</select>
					</div>
				{/if}
			</div>

			<!-- Coupon -->
			<div>
				<label for="set-promo" class="block text-sm text-surface-600-300-token mb-1">
					promo code
				</label>
				<input
					id="set-promo"
					type="text"
					bind:value={couponCode}
					placeholder="enter code"
					class="w-full px-3 py-2 bg-surface-500/10 border border-surface-500/20 rounded-md text-sm lowercase"
				/>
			</div>

			<p class="text-xs text-surface-500">
				Secure checkout powered by Stripe
			</p>

			<StickyMobileBar>
				{#snippet children(isStuck)}
					<div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
						<div class="flex items-center gap-1.5">
							{#if selectedConfiguration}
								<span class="text-xl font-semibold">${displaySetPrice}</span>
								<span class="text-xs {isStuck ? 'text-surface-300' : 'text-surface-600-300-token'}">
									{getPaper(selectedPaperSlug)?.name} · {getSize(selectedSizeSlug)?.label}{selectedBorderWidth !== 'none' ? ` · ${selectedBorderWidth}" border` : ''}{selectedFrame !== 'none' ? ` · ${getFrame(selectedFrame)?.label} frame` : ''}
								</span>
							{:else}
								<span class="text-sm text-surface-500">Select paper & size</span>
							{/if}
						</div>
						<div class="flex gap-1.5">
							{#if data.printSet.inStock && selectedConfiguration}
								<button class="btn btn-sm text-xs px-2 variant-soft-surface" onclick={handleAddToCart}>
									add to cart
								</button>
								<button
									class="btn btn-sm text-xs px-2 variant-filled-primary"
									disabled={isLoading}
									onclick={handleCheckout}
								>
									{isLoading ? "..." : "buy now"}
								</button>
							{:else if !data.printSet.inStock}
								<button class="btn btn-sm text-xs px-2 variant-filled-primary" disabled>out of stock</button>
							{/if}
						</div>
					</div>
				{/snippet}
			</StickyMobileBar>
		</div>
	</div>
</div>
