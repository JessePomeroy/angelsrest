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
import type { ParsedPaper } from "$lib/types/shop";
import { createCheckout } from "$lib/utils/checkout";
import { parsePaperOption } from "$lib/utils/images";

let { data } = $props();

let modalOpen = $state(false);
let selectedIndex = $state(0);
let isLoading = $state(false);

const selection = createPrintSelection(() => data.productType === "v2" ? data.product : { variants: [] });
const selectedConfiguration = $derived(selection.configuration);

// ─── V1 state ───────────────────────────────────────────────
let selectedPaperIndex = $state(0);

const selectedPaperData: ParsedPaper | null = $derived.by(() => {
	if (data.productType !== "v1") return null;
	if (!data.product.availablePapers?.length) return null;
	const paper =
		data.product.availablePapers[selectedPaperIndex] ||
		data.product.availablePapers[0];
	if (!paper?.name) return null;
	return parsePaperOption(paper);
});

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
	return selectedPaperData?.price ?? data.product.price ?? null;
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
			...(selectedPaperData ? { paperIndex: selectedPaperIndex } : {}),
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
	const priceDollars = selectedPaperData?.price ?? data.product.price;
	if (typeof priceDollars !== "number") return;

	const hasPaper = !!selectedPaperData;
	cart.add({
		productSlug: data.product.slug,
		type: "print",
		title: data.product.title,
		imageUrl:
			data.product.images[0]?.original || data.product.images[0]?.full || "",
		...(hasPaper
			? {
					paperName: selectedPaperData.name,
					paperSubcategoryId: Number.parseInt(
						selectedPaperData.subcategoryId,
						10,
					),
					paperWidth: selectedPaperData.width,
					paperHeight: selectedPaperData.height,
					paperIndex: selectedPaperIndex,
				}
			: {}),
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

<div class="max-w-6xl mx-auto px-4 md:px-8">
	<a href="/shop" class="text-sm opacity-70 hover:opacity-100 mb-4 inline-block">
		← Back to shop
	</a>

	<div class="grid md:grid-cols-2 gap-8">
		<!-- Image gallery (shared between V1 and V2) -->
		<div class="space-y-4">
			{#if data.product.images.length > 0}
				<button class="w-full" onclick={() => openModal(0)}>
					<img data-water-lens
						src={data.product.images[0].full}
						alt={data.product.images[0].alt}
						loading="lazy"
						class="w-full h-auto hover:scale-105 transition-transform rounded-md"
					/>
				</button>

				{#if data.product.images.length > 1}
					<div class="grid grid-cols-3 gap-2">
						{#each data.product.images.slice(1) as image, i (image.full ?? i)}
							<button
								class="aspect-square overflow-hidden rounded-md"
								onclick={() => openModal(i + 1)}
							>
								<img data-water-lens
									src={image.thumbnail}
									alt={image.alt}
									loading="lazy"
									class="w-full h-full object-cover hover:scale-105 transition-transform"
								/>
							</button>
						{/each}
					</div>
				{/if}
			{:else}
				<div class="aspect-square bg-surface-100 dark:bg-surface-800 rounded-md flex items-center justify-center">
					<span class="text-surface-500">No image available</span>
				</div>
			{/if}
		</div>

		<!-- Product details -->
		<div class="space-y-6">
			<div>
				<h1 class="text-3xl font-semibold mb-2">{data.product.title}</h1>
				{#if data.productType === "v1" && data.product.category}
					<span class="inline-flex items-center gap-2 rounded-md whitespace-nowrap text-xs px-3 py-1 bg-surface-200 text-surface-900 dark:bg-surface-700 dark:text-surface-50">
						{data.product.category.charAt(0).toUpperCase() + data.product.category.slice(1)}
					</span>
				{/if}
			</div>

			{#if data.product.description}
				<div class="text-surface-700 dark:text-surface-200">
					<p>{data.product.description}</p>
				</div>
			{/if}

			<!-- Stock status -->
			<div class="flex items-center gap-2">
				{#if data.product.inStock}
					<div class="w-3 h-3 rounded-full bg-success-500"></div>
					<span class="text-sm text-surface-600 dark:text-surface-300">In stock</span>
				{:else}
					<div class="w-3 h-3 rounded-full bg-error-500"></div>
					<span class="text-sm text-surface-600 dark:text-surface-300">Out of stock</span>
				{/if}
			</div>

			{#if data.productType === "v2"}
				<!-- ═══ V2 Configurator ═══ -->

				<!-- Desktop: inline price bar with buttons (no sticky needed) -->
				<div class="hidden md:flex items-baseline justify-between gap-4 py-2">
					<div class="text-3xl font-semibold text-surface-900 dark:text-surface-50">
						{#if selectedConfiguration}
							${displayPrice}
							<span class="text-base font-normal text-surface-600 dark:text-surface-300">
								{getPaper(selection.paper)?.name ?? selection.paper} · {getSize(selection.size)?.label}{selection.border !== 'none' ? ` · ${selection.border}" border` : ''}{selection.frame !== 'none' ? ` · ${getFrame(selection.frame)?.label} frame` : ''}
							</span>
						{:else}
							<span class="text-base text-surface-500">Select paper & size</span>
						{/if}
					</div>
					<div class="flex gap-2">
						{#if data.product.inStock && selectedConfiguration}
							<button class="inline-flex items-center justify-center gap-2 rounded-md whitespace-nowrap text-xs px-3 py-1 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-surface-900 dark:focus-visible:outline-surface-50 disabled:opacity-50 disabled:cursor-not-allowed bg-surface-200 text-surface-900 dark:bg-surface-700 dark:text-surface-50" onclick={handleV2AddToCart}>
								add to cart
							</button>
							<button
								class="inline-flex items-center justify-center gap-2 rounded-md whitespace-nowrap text-xs px-3 py-1 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-surface-900 dark:focus-visible:outline-surface-50 disabled:opacity-50 disabled:cursor-not-allowed bg-primary-500 text-slate-950 not-disabled:hover:bg-primary-500/80"
								disabled={isLoading}
								onclick={handleV2Checkout}
							>
								{isLoading ? "processing..." : "buy now"}
							</button>
						{:else if !data.product.inStock}
							<button class="inline-flex items-center justify-center gap-2 rounded-md whitespace-nowrap text-xs px-3 py-1 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-surface-900 dark:focus-visible:outline-surface-50 disabled:opacity-50 disabled:cursor-not-allowed bg-primary-500 text-slate-950 not-disabled:hover:bg-primary-500/80" disabled>out of stock</button>
						{/if}
					</div>
				</div>

				<PrintConfigurator {selection} />

				<p class="text-xs text-surface-500">
					Secure checkout powered by Stripe
				</p>

				<StickyMobileBar>
					{#snippet children(isStuck)}
						<div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
							<div class="flex items-center gap-1.5">
								{#if selectedConfiguration}
									<span class="text-xl font-semibold">${displayPrice}</span>
									<span class="text-xs {isStuck ? 'text-surface-300' : 'text-surface-600 dark:text-surface-300'}">
										{getPaper(selection.paper)?.name ?? selection.paper} · {getSize(selection.size)?.label}{selection.border !== 'none' ? ` · ${selection.border}" border` : ''}{selection.frame !== 'none' ? ` · ${getFrame(selection.frame)?.label} frame` : ''}
									</span>
								{:else}
									<span class="text-sm text-surface-500">Select paper & size</span>
								{/if}
							</div>
							<div class="flex gap-1.5">
								{#if data.product.inStock && selectedConfiguration}
									<button class="inline-flex items-center justify-center gap-2 rounded-md whitespace-nowrap text-xs px-2 py-1 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-surface-900 dark:focus-visible:outline-surface-50 disabled:opacity-50 disabled:cursor-not-allowed bg-surface-200 text-surface-900 dark:bg-surface-700 dark:text-surface-50" onclick={handleV2AddToCart}>
										add to cart
									</button>
									<button
										class="inline-flex items-center justify-center gap-2 rounded-md whitespace-nowrap text-xs px-2 py-1 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-surface-900 dark:focus-visible:outline-surface-50 disabled:opacity-50 disabled:cursor-not-allowed bg-primary-500 text-slate-950 not-disabled:hover:bg-primary-500/80"
										disabled={isLoading}
										onclick={handleV2Checkout}
									>
										{isLoading ? "..." : "buy now"}
									</button>
								{:else if !data.product.inStock}
									<button class="inline-flex items-center justify-center gap-2 rounded-md whitespace-nowrap text-xs px-2 py-1 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-surface-900 dark:focus-visible:outline-surface-50 disabled:opacity-50 disabled:cursor-not-allowed bg-primary-500 text-slate-950 not-disabled:hover:bg-primary-500/80" disabled>out of stock</button>
								{/if}
							</div>
						</div>
					{/snippet}
				</StickyMobileBar>
			{:else}
				<!-- ═══ V1 Layout (merch, postcards, tapestries, digital) ═══ -->

				<!-- Desktop: inline price + buttons -->
				<div class="hidden md:flex items-baseline justify-between gap-4 py-2">
					<div class="text-3xl font-semibold text-surface-900 dark:text-surface-50">
						{displayPriceLabel}
					</div>
					<div class="flex gap-2">
						{#if canAddToCartV1}
							<button class="inline-flex items-center justify-center gap-2 rounded-md whitespace-nowrap text-xs px-3 py-1 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-surface-900 dark:focus-visible:outline-surface-50 disabled:opacity-50 disabled:cursor-not-allowed bg-surface-200 text-surface-900 dark:bg-surface-700 dark:text-surface-50" onclick={handleV1AddToCart}>
								add to cart
							</button>
						{/if}
						<button
							class="inline-flex items-center justify-center gap-2 rounded-md whitespace-nowrap text-xs px-3 py-1 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-surface-900 dark:focus-visible:outline-surface-50 disabled:opacity-50 disabled:cursor-not-allowed bg-primary-500 text-slate-950 not-disabled:hover:bg-primary-500/80"
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

				{#if data.product.category !== "digital" && data.product.availablePapers?.length > 0}
					<div>
						<label for="paper-type" class="block text-sm text-surface-600 dark:text-surface-300 mb-1">
							Paper Type
						</label>
						<select id="paper-type" class="block rounded-md border border-surface-300 dark:border-surface-600 bg-transparent text-base py-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-surface-900 dark:focus-visible:outline-surface-50 disabled:opacity-50 w-full" bind:value={selectedPaperIndex}>
							{#each data.product.availablePapers as paper, i (paper.subcategoryId ?? paper.name ?? i)}
								<option value={i}>
									{paper.name ? paper.name.split("|")[0] : `Option ${i + 1}`}
								</option>
							{/each}
						</select>
					</div>
				{/if}

				{#if data.product.category === "digital"}
					<p class="text-xs text-surface-500">instant download after payment</p>
				{/if}
				<p class="text-xs text-surface-500">
					Secure checkout powered by Stripe
				</p>

				<!-- Mobile: sticky bar -->
				<StickyMobileBar>
					{#snippet children(isStuck)}
						<div class="flex items-center justify-between gap-2">
							<div class="flex items-center gap-1.5 min-w-0">
								<span class="text-xl font-semibold shrink-0">{displayPriceLabel}</span>
								{#if data.product.category}
									<span class="text-xs truncate {isStuck ? 'text-surface-300' : 'text-surface-600 dark:text-surface-300'}">
										{data.product.category}
									</span>
								{/if}
							</div>
							<div class="flex gap-1.5 shrink-0">
								{#if canAddToCartV1}
									<button class="inline-flex items-center justify-center gap-2 rounded-md whitespace-nowrap text-xs px-2 py-1 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-surface-900 dark:focus-visible:outline-surface-50 disabled:opacity-50 disabled:cursor-not-allowed bg-surface-200 text-surface-900 dark:bg-surface-700 dark:text-surface-50" onclick={handleV1AddToCart}>
										add to cart
									</button>
								{/if}
								<button
									class="inline-flex items-center justify-center gap-2 rounded-md whitespace-nowrap text-xs px-2 py-1 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-surface-900 dark:focus-visible:outline-surface-50 disabled:opacity-50 disabled:cursor-not-allowed bg-primary-500 text-slate-950 not-disabled:hover:bg-primary-500/80"
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
