<script lang="ts">
/**
 * Print Set Detail Page
 *
 * Handles both V2 (lumaPrintSetV2 with catalog-aware variants) and
 * V1 (printSet with string-based paper options). V2 uses two-dropdown
 * configurator with per-set pricing; V1 uses the legacy single dropdown.
 */
import SEO from "$lib/components/SEO.svelte";
import { cart } from "$lib/shop/cart.svelte";
import { cartUI } from "$lib/shop/cartUI.svelte";
import {
	getBorder,
	getPaper,
	getSize,
	V2_BORDER_OPTIONS,
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

// Border options available for the selected paper + size
const v2Borders = $derived.by(() => {
	if (data.setType !== "v2" || !selectedPaperSlug || !selectedSizeSlug)
		return [];
	const values = Array.from(
		new Set<string>(
			data.printSet.variants
				.filter(
					(v: any) =>
						v.paper === selectedPaperSlug && v.size === selectedSizeSlug,
				)
				.map((v: any) => v.borderWidth || "none"),
		),
	);
	return V2_BORDER_OPTIONS.filter((b) => values.includes(b.value));
});

$effect(() => {
	if (
		v2Borders.length > 0 &&
		!v2Borders.some((b) => b.value === selectedBorderWidth)
	) {
		selectedBorderWidth = v2Borders[0].value;
	}
});

const selectedVariant = $derived.by(() => {
	if (data.setType !== "v2") return null;
	return (
		data.printSet.variants.find(
			(v: any) =>
				v.paper === selectedPaperSlug &&
				v.size === selectedSizeSlug &&
				(v.borderWidth || "none") === selectedBorderWidth,
		) ?? null
	);
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
		price: selectedVariant.retailPrice,
		image: data.printSet.previewImage,
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
		isPrintSet: true,
		images: originalUrls,
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

	const originalUrls = (data.images as ProductImage[]).map(
		(img) => img.original,
	);
	if (originalUrls.length === 0) return;

	const border = getBorder(selectedBorderWidth);
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
		quantity: 1,
		unitPriceCents: Math.round(selectedVariant.retailPrice * 100),
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
	} catch (err: any) {
		console.error("Checkout error:", err);
		alert(err.message || "something went wrong. please try again.");
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

<div class="px-6! md:px-8! lg:px-10!">
	<!-- Breadcrumb -->
	<div class="mb-6">
		<a href="/shop" class="inline-block text-sm text-surface-600-300-token hover:text-surface-400">
			← back to shop
		</a>
		{#if data.printSet.parent}
			<span class="mx-2 text-surface-500">/</span>
			<a
				href="/shop/prints/{data.printSet.parent.slug}"
				class="inline-block text-sm text-surface-600-300-token hover:text-surface-400"
			>
				{data.printSet.parent.title}
			</a>
		{/if}
	</div>

	<!-- Title + description -->
	<div class="text-center mb-8">
		<h1 class="text-3xl font-bold mb-2">{data.printSet.title}</h1>
		{#if data.printSet.description}
			<p class="text-lg text-surface-600-300-token">{data.printSet.description}</p>
		{/if}
	</div>

	<!-- Two-column: images left, purchase right -->
	<div class="grid md:grid-cols-3 gap-8">
		<!-- Images grid -->
		<div class="md:col-span-2">
			{#if data.images.length > 0}
				<div class="columns-2 md:columns-3 gap-4">
					{#each data.images as image}
						<div class="mb-4 break-inside-avoid">
							<img
								src={(image as ProductImage).thumb}
								alt={image.alt}
								loading="lazy"
								class="w-full h-auto rounded-lg"
							/>
						</div>
					{/each}
				</div>
			{/if}
		</div>

		<!-- Purchase sidebar -->
		<div class="md:col-span-1">
			<div class="sticky top-8 bg-surface-500/10 border border-surface-500/20 rounded-lg p-6">
				{#if data.setType === "v2"}
					<!-- ═══ V2 Configurator ═══ -->
					{#if selectedVariant}
						<div class="text-3xl font-semibold text-surface-900-50-token mb-1">
							${selectedVariant.retailPrice}
						</div>
						<div class="text-sm text-surface-600-300-token mb-4">
							{data.images.length} print{data.images.length === 1 ? "" : "s"} ·
							{getPaper(selectedPaperSlug)?.name} · {getSize(selectedSizeSlug)?.label}
						</div>
					{:else}
						<div class="text-surface-500 mb-4">Select paper & size</div>
					{/if}

					<div class="space-y-4 mb-4">
						<div>
							<label for="set-paper" class="block text-sm text-surface-600-300-token mb-1">
								Paper
							</label>
							<select id="set-paper" class="select w-full" bind:value={selectedPaperSlug}>
								{#each v2Papers as paper}
									<option value={paper.slug}>{paper.name}</option>
								{/each}
							</select>
						</div>
						<div>
							<label for="set-size" class="block text-sm text-surface-600-300-token mb-1">
								Size
							</label>
							<select id="set-size" class="select w-full" bind:value={selectedSizeSlug}>
								{#each v2Sizes as size}
									<option value={size.slug}>{size.label}</option>
								{/each}
							</select>
						</div>

						{#if v2Borders.length > 1}
							<div>
								<label for="set-border" class="block text-sm text-surface-600-300-token mb-1">
									Border
								</label>
								<select id="set-border" class="select w-full" bind:value={selectedBorderWidth}>
									{#each v2Borders as border}
										<option value={border.value}>{border.label}</option>
									{/each}
								</select>
							</div>
						{/if}
					</div>

					<!-- Coupon -->
					<div class="mb-4">
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

					<div class="space-y-3">
						{#if data.printSet.inStock && selectedVariant}
							<button class="btn variant-soft-surface w-full" onclick={handleV2AddToCart}>
								add to cart
							</button>
							<button
								class="btn variant-filled-primary w-full"
								disabled={isLoading}
								onclick={handleV2Checkout}
							>
								{isLoading ? "processing..." : "buy now"}
							</button>
						{:else if !data.printSet.inStock}
							<button class="btn variant-filled-primary w-full" disabled>out of stock</button>
						{:else}
							<button class="btn variant-filled-primary w-full" disabled>
								select paper & size
							</button>
						{/if}
					</div>
				{:else}
					<!-- ═══ V1 Layout ═══ -->
					<div class="text-3xl font-semibold text-surface-900-50-token mb-4">
						${selectedPaperData?.price || data.printSet.price}
					</div>

					{#if data.printSet.availablePapers?.length > 0}
						<div class="mb-4">
							<label for="set-paper-type" class="block text-sm text-surface-600-300-token mb-1">
								Paper Type
							</label>
							<select id="set-paper-type" bind:value={selectedPaperIndex} class="select w-full">
								{#each data.printSet.availablePapers as paper, i}
									{@const parsed = parsePaperOption(paper)}
									{@const priceNote = paper.price ? ` (+$${paper.price})` : ""}
									<option value={i}>{parsed.name}{priceNote}</option>
								{/each}
							</select>
						</div>
					{/if}

					<!-- Coupon -->
					<div class="mb-4">
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

					<div class="space-y-3">
						{#if selectedPaperData}
							<button class="btn variant-soft-surface w-full" onclick={handleV1AddToCart}>
								add to cart
							</button>
						{/if}
						<button
							class="btn variant-filled-primary w-full"
							disabled={isLoading}
							onclick={handleV1Checkout}
						>
							{isLoading ? "processing..." : "buy now"}
						</button>
					</div>
				{/if}

				<p class="text-xs text-surface-500 text-center mt-2">
					secure checkout powered by stripe
				</p>
			</div>
		</div>
	</div>
</div>
