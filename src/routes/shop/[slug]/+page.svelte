<script lang="ts">
import GalleryModal from "$lib/components/GalleryModal.svelte";
import SEO from "$lib/components/SEO.svelte";
import StickyMobileBar from "$lib/components/StickyMobileBar.svelte";
import { cart } from "$lib/shop/cart.svelte";
import { cartUI } from "$lib/shop/cartUI.svelte";
import {
	getBorder,
	getPaper,
	getSize,
	V2_BORDER_OPTIONS,
} from "$lib/shop/v2Catalog";
import type { ParsedPaper } from "$lib/types/shop";
import { createCheckout } from "$lib/utils/checkout";
import { parsePaperOption } from "$lib/utils/images";

let { data } = $props();

let modalOpen = $state(false);
let selectedIndex = $state(0);
let isLoading = $state(false);
let couponCode = $state("");

// ─── V2 state ───────────────────────────────────────────────
let selectedPaperSlug = $state("");
let selectedSizeSlug = $state("");
let selectedBorderWidth = $state("none");

// Unique papers available on this product (from enabled variants)
const v2Papers = $derived.by(() => {
	if (data.productType !== "v2") return [];
	const slugs = Array.from(
		new Set<string>(data.product.variants.map((v: any) => v.paper)),
	);
	return slugs.map((slug) => {
		const meta = getPaper(slug);
		return { slug, name: meta?.name ?? slug };
	});
});

// Initialize selected paper to first available
$effect(() => {
	if (data.productType === "v2" && v2Papers.length > 0 && !selectedPaperSlug) {
		selectedPaperSlug = v2Papers[0].slug;
	}
});

// Sizes available for the selected paper
const v2Sizes = $derived.by(() => {
	if (data.productType !== "v2" || !selectedPaperSlug) return [];
	const slugs = Array.from(
		new Set<string>(
			data.product.variants
				.filter((v: any) => v.paper === selectedPaperSlug)
				.map((v: any) => v.size),
		),
	);
	return slugs.map((slug) => {
		const meta = getSize(slug);
		return { slug, label: meta?.label ?? slug };
	});
});

// Initialize selected size when paper changes
$effect(() => {
	if (
		v2Sizes.length > 0 &&
		!v2Sizes.some((s: any) => s.slug === selectedSizeSlug)
	) {
		selectedSizeSlug = v2Sizes[0].slug;
	}
});

// The matching variant for the current paper + size selection
// (border is a customer choice, not a variant dimension)
const selectedVariant = $derived.by(() => {
	if (data.productType !== "v2") return null;
	return (
		data.product.variants.find(
			(v: any) => v.paper === selectedPaperSlug && v.size === selectedSizeSlug,
		) ?? null
	);
});

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

// Display price
const displayPrice = $derived.by(() => {
	if (data.productType === "v2") {
		return selectedVariant?.retailPrice ?? null;
	}
	return selectedPaperData?.price ?? data.product.price ?? null;
});

// ─── V2 checkout/cart handlers ──────────────────────────────
function handleV2Checkout() {
	if (!selectedVariant) return;
	isLoading = true;

	const paper = getPaper(selectedPaperSlug);
	const size = getSize(selectedSizeSlug);

	createCheckout({
		productId: data.product.slug,
		title: data.product.title,
		price: selectedVariant.retailPrice,
		image: data.product.images[0]?.original || null,
		paper:
			paper && size
				? {
						name: paper.name,
						subcategoryId: String(paper.subcategoryId),
						width: size.width,
						height: size.height,
						price: selectedVariant.retailPrice,
					}
				: null,
		coupon: couponCode.trim() || null,
	})
		.then((url) => {
			window.location.href = url;
		})
		.catch((err: any) => {
			console.error("Checkout error:", err);
			alert(err.message || "something went wrong. please try again.");
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

	const border = getBorder(selectedBorderWidth);
	cart.add({
		productSlug: data.product.slug,
		type: "print",
		title: data.product.title,
		imageUrl:
			data.product.images[0]?.original || data.product.images[0]?.full || "",
		paperName: paper.name,
		paperSubcategoryId: paper.subcategoryId,
		paperWidth: size.width,
		paperHeight: size.height,
		...(border && border.inches > 0 ? { borderWidth: border.inches } : {}),
		quantity: 1,
		unitPriceCents: Math.round(selectedVariant.retailPrice * 100),
	});
	cartUI.open();
}

// ─── V1 checkout/cart handlers ──────────────────────────────
async function handleV1Checkout() {
	isLoading = true;
	try {
		const url = await createCheckout({
			productId: data.product.slug,
			title: data.product.title,
			price: selectedPaperData?.price || data.product.price,
			image: data.product.images[0]?.original || null,
			paper: selectedPaperData,
			coupon: couponCode.trim() || null,
		});
		window.location.href = url;
	} catch (err: any) {
		console.error("Checkout error:", err);
		alert(err.message || "something went wrong. please try again.");
	} finally {
		isLoading = false;
	}
}

const canAddToCartV1 = $derived(
	data.productType === "v1" &&
		data.product.category !== "digital" &&
		data.product.inStock,
);

function handleV1AddToCart() {
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
				}
			: {}),
		quantity: 1,
		unitPriceCents: Math.round(priceDollars * 100),
	});
	cartUI.open();
}
</script>

<SEO
	title={`${data.product.title} | shop | angel's rest`}
	description={data.product.description || `${data.product.title} - Available in the Angels Rest shop`}
	image={data.product.images[0]?.full || "/og-image.jpg"}
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
					<img
						src={data.product.images[0].full}
						alt={data.product.images[0].alt}
						loading="lazy"
						class="w-full h-auto hover:scale-105 transition-transform rounded-md"
					/>
				</button>

				{#if data.product.images.length > 1}
					<div class="grid grid-cols-3 gap-2">
						{#each data.product.images.slice(1) as image, i}
							<button
								class="aspect-square overflow-hidden rounded-md"
								onclick={() => openModal(i + 1)}
							>
								<img
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
				<div class="aspect-square bg-surface-100-800-token rounded-md flex items-center justify-center">
					<span class="text-surface-500">No image available</span>
				</div>
			{/if}
		</div>

		<!-- Product details -->
		<div class="space-y-6">
			<div>
				<h1 class="text-3xl font-semibold mb-2">{data.product.title}</h1>
				{#if data.productType === "v1" && data.product.category}
					<span class="chip variant-soft-surface">
						{data.product.category.charAt(0).toUpperCase() + data.product.category.slice(1)}
					</span>
				{/if}
			</div>

			{#if data.product.description}
				<div class="text-surface-700-200-token">
					<p>{data.product.description}</p>
				</div>
			{/if}

			<!-- Stock status -->
			<div class="flex items-center gap-2">
				{#if data.product.inStock}
					<div class="w-3 h-3 rounded-full bg-success-500"></div>
					<span class="text-sm text-surface-600-300-token">In stock</span>
				{:else}
					<div class="w-3 h-3 rounded-full bg-error-500"></div>
					<span class="text-sm text-surface-600-300-token">Out of stock</span>
				{/if}
			</div>

			{#if data.productType === "v2"}
				<!-- ═══ V2 Configurator ═══ -->

				<!-- Desktop: inline price bar with buttons (no sticky needed) -->
				<div class="hidden md:flex items-center justify-between gap-4 py-2">
					<div class="text-3xl font-semibold text-surface-900-50-token">
						{#if selectedVariant}
							${selectedVariant.retailPrice}
							<span class="text-base font-normal text-surface-600-300-token">
								{getPaper(selectedPaperSlug)?.name} · {getSize(selectedSizeSlug)?.label}{selectedBorderWidth !== 'none' ? ` · ${selectedBorderWidth}" border` : ''}
							</span>
						{:else}
							<span class="text-base text-surface-500">Select paper & size</span>
						{/if}
					</div>
					<div class="flex gap-2">
						{#if data.product.inStock && selectedVariant}
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
						{:else if !data.product.inStock}
							<button class="btn btn-sm variant-filled-primary" disabled>out of stock</button>
						{/if}
					</div>
				</div>

				<div class="space-y-4">
					<div>
						<label for="paper-select" class="block text-sm text-surface-600-300-token mb-1">
							Paper
						</label>
						<select id="paper-select" class="select w-full" bind:value={selectedPaperSlug}>
							{#each v2Papers as paper}
								<option value={paper.slug}>{paper.name}</option>
							{/each}
						</select>
					</div>

					<div>
						<label for="size-select" class="block text-sm text-surface-600-300-token mb-1">
							Size
						</label>
						<select id="size-select" class="select w-full" bind:value={selectedSizeSlug}>
							{#each v2Sizes as size}
								<option value={size.slug}>{size.label}</option>
							{/each}
						</select>
					</div>

					{#if data.product.bordersEnabled !== false}
						<div>
							<label for="border-select" class="block text-sm text-surface-600-300-token mb-1">
								Border
							</label>
							<select id="border-select" class="select w-full" bind:value={selectedBorderWidth}>
								{#each V2_BORDER_OPTIONS as border}
									<option value={border.value}>{border.label}</option>
								{/each}
							</select>
						</div>
					{/if}
				</div>

				<!-- Coupon -->
				<div>
					<label for="promo-code" class="block text-sm text-surface-600-300-token mb-1">
						promo code
					</label>
					<input
						id="promo-code"
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
									<span class="text-xl font-semibold">${selectedVariant.retailPrice}</span>
									<span class="text-xs {isStuck ? 'text-surface-300' : 'text-surface-600-300-token'}">
										{getPaper(selectedPaperSlug)?.name} · {getSize(selectedSizeSlug)?.label}{selectedBorderWidth !== 'none' ? ` · ${selectedBorderWidth}" border` : ''}
									</span>
								{:else}
									<span class="text-sm text-surface-500">Select paper & size</span>
								{/if}
							</div>
							<div class="flex gap-1.5">
								{#if data.product.inStock && selectedVariant}
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
								{:else if !data.product.inStock}
									<button class="btn btn-sm text-xs px-2 variant-filled-primary" disabled>out of stock</button>
								{/if}
							</div>
						</div>
					{/snippet}
				</StickyMobileBar>
			{:else}
				<!-- ═══ V1 Layout (merch, postcards, tapestries, digital) ═══ -->

				<!-- Desktop: inline price + buttons -->
				<div class="hidden md:flex items-center justify-between gap-4 py-2">
					<div class="text-3xl font-semibold text-surface-900-50-token">
						${displayPrice}
					</div>
					<div class="flex gap-2">
						{#if canAddToCartV1}
							<button class="btn btn-sm variant-soft-surface" onclick={handleV1AddToCart}>
								add to cart
							</button>
						{/if}
						<button
							class="btn btn-sm variant-filled-primary"
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

				<!-- Coupon -->
				<div>
					<label for="promo-code" class="block text-sm text-surface-600-300-token mb-1">
						promo code
					</label>
					<input
						id="promo-code"
						type="text"
						bind:value={couponCode}
						placeholder="enter code"
						class="w-full px-3 py-2 bg-surface-500/10 border border-surface-500/20 rounded-md text-sm lowercase"
					/>
				</div>

				{#if data.product.category !== "digital" && data.product.availablePapers?.length > 0}
					<div>
						<label for="paper-type" class="block text-sm text-surface-600-300-token mb-1">
							Paper Type
						</label>
						<select id="paper-type" class="select w-full" bind:value={selectedPaperIndex}>
							{#each data.product.availablePapers as paper, i}
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
								<span class="text-xl font-semibold shrink-0">${displayPrice}</span>
								{#if data.product.category}
									<span class="text-xs truncate {isStuck ? 'text-surface-300' : 'text-surface-600-300-token'}">
										{data.product.category}
									</span>
								{/if}
							</div>
							<div class="flex gap-1.5 shrink-0">
								{#if canAddToCartV1}
									<button class="btn btn-sm text-xs px-2 variant-soft-surface" onclick={handleV1AddToCart}>
										add to cart
									</button>
								{/if}
								<button
									class="btn btn-sm text-xs px-2 variant-filled-primary"
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
