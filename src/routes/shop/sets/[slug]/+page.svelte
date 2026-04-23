<script lang="ts">
/**
 * Print Set Detail Page
 *
 * Handles both V2 (lumaPrintSetV2 with catalog-aware variants) and
 * V1 (printSet with string-based paper options). V2 uses two-dropdown
 * configurator with per-set pricing; V1 uses the legacy single dropdown.
 */
import SEO from "$lib/components/SEO.svelte";
import StickyMobileBar from "$lib/components/StickyMobileBar.svelte";
import { cart } from "$lib/shop/cart.svelte";
import { cartUI } from "$lib/shop/cartUI.svelte";
import { toasts } from "$lib/stores/toast.svelte";
import {
	FRAMED_BORDER_INCHES,
	getBorder,
	getFrame,
	getFrameWholesaleCost,
	getPaper,
	getSize,
	isCanvasPaper,
	parseCanvasSlug,
	V2_BORDER_OPTIONS,
	V2_FRAME_OPTIONS,
} from "$lib/shop/v2Catalog";
import type { ParsedPaper, ProductImage } from "$lib/types/shop";
import { createCheckout } from "$lib/utils/checkout";
import { parsePaperOption } from "$lib/utils/images";

let { data } = $props();

let couponCode = $state("");
let isLoading = $state(false);

// ─── V2 state ───────────────────────────────────────────────
let selectedPaperSlug = $state("");
let selectedSizeSlug = $state("");
let selectedBorderWidth = $state("none");
let selectedFrame = $state("none");

const isCanvasSelected = $derived(isCanvasPaper(selectedPaperSlug));

// Idempotent guards — see audit H23 + shop/[slug]/+page.svelte for the
// full explanation.
$effect(() => {
	if (isCanvasSelected) {
		if (selectedBorderWidth !== "none") selectedBorderWidth = "none";
		if (selectedFrame !== "none") selectedFrame = "none";
	} else if (selectedFrame !== "none") {
		const framedWidth = String(FRAMED_BORDER_INCHES);
		if (selectedBorderWidth !== framedWidth) {
			selectedBorderWidth = framedWidth;
		}
	}
});

const v2Papers = $derived.by(() => {
	if (data.setType !== "v2") return [];
	const slugs = Array.from(
		new Set<string>(data.printSet.variants.map((v: any) => v.paper)),
	);
	return slugs.map((slug) => {
		const meta = getPaper(slug);
		return { slug, name: meta?.name ?? slug };
	});
});

$effect(() => {
	if (data.setType === "v2" && v2Papers.length > 0 && !selectedPaperSlug) {
		selectedPaperSlug = v2Papers[0].slug;
	}
});

const v2Sizes = $derived.by(() => {
	if (data.setType !== "v2" || !selectedPaperSlug) return [];
	const slugs = Array.from(
		new Set<string>(
			data.printSet.variants
				.filter((v: any) => v.paper === selectedPaperSlug)
				.map((v: any) => v.size),
		),
	);
	return slugs.map((slug) => {
		const meta = getSize(slug);
		return { slug, label: meta?.label ?? slug };
	});
});

$effect(() => {
	if (v2Sizes.length > 0 && !v2Sizes.some((s) => s.slug === selectedSizeSlug)) {
		selectedSizeSlug = v2Sizes[0].slug;
	}
});

const selectedVariant = $derived.by(() => {
	if (data.setType !== "v2") return null;
	return (
		data.printSet.variants.find(
			(v: any) => v.paper === selectedPaperSlug && v.size === selectedSizeSlug,
		) ?? null
	);
});

// Frame surcharge for sets
const frameSurcharge = $derived.by(() => {
	if (data.setType !== "v2" || selectedFrame === "none") return 0;
	const wholesale = getFrameWholesaleCost(selectedFrame, selectedSizeSlug);
	if (!wholesale) return 0;
	const multiplier = data.printSet.frameMarkupMultiplier ?? 2;
	return Math.round(wholesale * multiplier * 100) / 100;
});

const displaySetPrice = $derived.by(() => {
	if (data.setType !== "v2") return null;
	const base = selectedVariant?.retailPrice ?? null;
	if (base === null) return null;
	return Math.round((base + frameSurcharge) * 100) / 100;
});

// ─── V1 state ───────────────────────────────────────────────
let selectedPaperIndex = $state(0);

const selectedPaperData: ParsedPaper | null = $derived.by(() => {
	if (data.setType !== "v1") return null;
	if (!data.printSet.availablePapers?.length) return null;
	const paper = data.printSet.availablePapers[selectedPaperIndex];
	if (!paper) return null;
	return parsePaperOption(paper);
});

// ─── V2 handlers ────────────────────────────────────────────
function handleV2Checkout() {
	if (!selectedVariant) return;
	isLoading = true;

	const paper = getPaper(selectedPaperSlug);
	const size = getSize(selectedSizeSlug);
	const originalUrls = (data.images as ProductImage[]).map(
		(img) => img.original,
	);

	createCheckout({
		productId: data.printSet.slug,
		title: data.printSet.title,
		price: displaySetPrice ?? selectedVariant.retailPrice,
		image: data.printSet.previewImage,
		paper:
			paper && size
				? {
						name: paper.name,
						subcategoryId: String(paper.subcategoryId),
						width: size.width,
						height: size.height,
						price: displaySetPrice ?? selectedVariant.retailPrice,
					}
				: null,
		coupon: couponCode.trim() || null,
		isPrintSet: true,
		images: originalUrls,
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

function handleV2AddToCart() {
	if (!selectedVariant) return;
	const paper = getPaper(selectedPaperSlug);
	const size = getSize(selectedSizeSlug);
	if (!paper || !size) return;

	const originalUrls = (data.images as ProductImage[]).map(
		(img) => img.original,
	);
	if (originalUrls.length === 0) return;

	const border = getBorder(selectedBorderWidth);
	const frame = getFrame(selectedFrame);
	const canvasInfo = isCanvasSelected
		? parseCanvasSlug(selectedPaperSlug)
		: null;
	cart.add({
		productSlug: data.printSet.slug,
		type: "set",
		title: data.printSet.title,
		imageUrl: data.printSet.previewImage || originalUrls[0],
		imageUrls: originalUrls,
		paperName: paper.name,
		paperSubcategoryId: paper.subcategoryId,
		paperWidth: size.width,
		paperHeight: size.height,
		...(border && border.inches > 0 ? { borderWidth: border.inches } : {}),
		...(frame && frame.subcategoryId > 0
			? { frameSubcategoryId: frame.subcategoryId }
			: {}),
		...(canvasInfo
			? { canvasSubcategoryId: canvasInfo.subcategoryId, canvasWrapHex: canvasInfo.wrapHex }
			: {}),
		quantity: 1,
		unitPriceCents: Math.round(
			(displaySetPrice ?? selectedVariant.retailPrice) * 100,
		),
	});
	cartUI.open();
}

// ─── V1 handlers ────────────────────────────────────────────
async function handleV1Checkout() {
	isLoading = true;
	try {
		const url = await createCheckout({
			productId: data.printSet.slug,
			title: data.printSet.title,
			price: selectedPaperData?.price || data.printSet.price,
			image: data.printSet.previewImage,
			paper: selectedPaperData,
			coupon: couponCode.trim() || null,
			isPrintSet: true,
			images: (data.images as ProductImage[]).map((img) => img.original),
		});
		window.location.href = url;
	} catch (err: unknown) {
		console.error("Checkout error:", err);
		toasts.show(err instanceof Error ? err.message : "something went wrong. please try again.", { type: "error" });
	} finally {
		isLoading = false;
	}
}

function handleV1AddToCart() {
	if (!selectedPaperData) return;
	const priceDollars = selectedPaperData.price ?? data.printSet.price;
	if (typeof priceDollars !== "number") return;

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
		paperName: selectedPaperData.name,
		paperSubcategoryId: Number.parseInt(selectedPaperData.subcategoryId, 10),
		paperWidth: selectedPaperData.width,
		paperHeight: selectedPaperData.height,
		quantity: 1,
		unitPriceCents: Math.round(priceDollars * 100),
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
			{#if data.setType === "v2"}
				<div class="flex items-center gap-2">
					{#if data.printSet.inStock}
						<div class="w-3 h-3 rounded-full bg-success-500"></div>
						<span class="text-sm text-surface-600-300-token">In stock</span>
					{:else}
						<div class="w-3 h-3 rounded-full bg-error-500"></div>
						<span class="text-sm text-surface-600-300-token">Out of stock</span>
					{/if}
				</div>
			{/if}

			{#if data.setType === "v2"}
				<!-- ═══ V2 Configurator ═══ -->

				<!-- Desktop: inline price + buttons -->
				<div class="hidden md:flex items-baseline justify-between gap-4 py-2">
					<div class="text-3xl font-semibold text-surface-900-50-token">
						{#if selectedVariant}
							${displaySetPrice}
							<span class="text-base font-normal text-surface-600-300-token">
								{getPaper(selectedPaperSlug)?.name} · {getSize(selectedSizeSlug)?.label}{selectedBorderWidth !== 'none' ? ` · ${selectedBorderWidth}" border` : ''}{selectedFrame !== 'none' ? ` · ${getFrame(selectedFrame)?.label} frame` : ''}
							</span>
						{:else}
							<span class="text-base text-surface-500">Select paper & size</span>
						{/if}
					</div>
					<div class="flex gap-2 shrink-0">
						{#if data.printSet.inStock && selectedVariant}
							<button class="btn btn-sm variant-soft-surface" onclick={handleV2AddToCart}>
								add to cart
							</button>
							<button
								class="btn btn-sm variant-filled-primary"
								disabled={isLoading}
								onclick={handleV2Checkout}
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
							{#each v2Papers as paper (paper.slug)}
								<option value={paper.slug}>{paper.name}</option>
							{/each}
						</select>
					</div>
					<div>
						<label for="set-size" class="block text-sm text-surface-600-300-token mb-1">
							Size
						</label>
						<select id="set-size" class="select w-full" bind:value={selectedSizeSlug}>
							{#each v2Sizes as size (size.slug)}
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
								{#if selectedVariant}
									<span class="text-xl font-semibold">${displaySetPrice}</span>
									<span class="text-xs {isStuck ? 'text-surface-300' : 'text-surface-600-300-token'}">
										{getPaper(selectedPaperSlug)?.name} · {getSize(selectedSizeSlug)?.label}{selectedBorderWidth !== 'none' ? ` · ${selectedBorderWidth}" border` : ''}{selectedFrame !== 'none' ? ` · ${getFrame(selectedFrame)?.label} frame` : ''}
									</span>
								{:else}
									<span class="text-sm text-surface-500">Select paper & size</span>
								{/if}
							</div>
							<div class="flex gap-1.5">
								{#if data.printSet.inStock && selectedVariant}
									<button class="btn btn-sm text-xs px-2 variant-soft-surface" onclick={handleV2AddToCart}>
										add to cart
									</button>
									<button
										class="btn btn-sm text-xs px-2 variant-filled-primary"
										disabled={isLoading}
										onclick={handleV2Checkout}
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
			{:else}
				<!-- ═══ V1 Layout ═══ -->
				<div class="hidden md:flex items-baseline justify-between gap-4 py-2">
					<div class="text-3xl font-semibold text-surface-900-50-token">
						${selectedPaperData?.price || data.printSet.price}
					</div>
					<div class="flex gap-2 shrink-0">
						{#if selectedPaperData}
							<button class="btn btn-sm variant-soft-surface" onclick={handleV1AddToCart}>
								add to cart
							</button>
						{/if}
						<button
							class="btn btn-sm variant-filled-primary"
							disabled={isLoading}
							onclick={handleV1Checkout}
						>
							{isLoading ? "processing..." : "buy now"}
						</button>
					</div>
				</div>

				{#if data.printSet.availablePapers?.length > 0}
					<div>
						<label for="set-paper-type" class="block text-sm text-surface-600-300-token mb-1">
							Paper Type
						</label>
						<select id="set-paper-type" bind:value={selectedPaperIndex} class="select w-full">
							{#each data.printSet.availablePapers as paper, i (paper.subcategoryId ?? paper.name ?? i)}
								{@const parsed = parsePaperOption(paper)}
								{@const priceNote = paper.price ? ` (+$${paper.price})` : ""}
								<!-- Audit H40: parsePaperOption now returns null on malformed input;
								     fall back to the raw name so the option is still selectable. -->
								<option value={i}>{parsed?.name ?? paper.name}{priceNote}</option>
							{/each}
						</select>
					</div>
				{/if}

				<!-- Coupon -->
				<div>
					<label for="set-promo-v1" class="block text-sm text-surface-600-300-token mb-1">
						promo code
					</label>
					<input
						id="set-promo-v1"
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
								<span class="text-xl font-semibold">${selectedPaperData?.price || data.printSet.price}</span>
							</div>
							<div class="flex gap-1.5">
								{#if selectedPaperData}
									<button class="btn btn-sm text-xs px-2 variant-soft-surface" onclick={handleV1AddToCart}>
										add to cart
									</button>
								{/if}
								<button
									class="btn btn-sm text-xs px-2 variant-filled-primary"
									disabled={isLoading}
									onclick={handleV1Checkout}
								>
									{isLoading ? "..." : "buy now"}
								</button>
							</div>
						</div>
					{/snippet}
				</StickyMobileBar>
			{/if}
		</div>
	</div>
</div>
