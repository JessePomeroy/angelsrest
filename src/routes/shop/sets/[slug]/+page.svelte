<script lang="ts">
/**
 * Print Set Detail Page
 * 
 * Shows all images in a set and allows purchase of the entire set as one product.
 * 
 * Key features:
 * - Multiple images (all sent to LumaPrints for printing)
 * - Original/full quality images for printing (not compressed webp)
 * - Paper selection applies to ALL prints in the set
 * - Two-column layout: images left, purchase form right
 */
import SEO from "$lib/components/SEO.svelte";
import { parsePaperOption, imageSet } from "$lib/utils/images";
import type { ParsedPaper, ProductImage } from "$lib/types/shop";

let { data } = $props();

// Form state
let selectedPaperIndex = $state(0);
let couponCode = $state("");
let isLoading = $state(false);

// Parse selected paper option
const selectedPaperData: ParsedPaper | null = $derived.by(() => {
	if (!data.printSet.availablePapers?.length) return null;
	const paper = data.printSet.availablePapers[selectedPaperIndex];
	if (!paper) return null;
	return parsePaperOption(paper);
});

/**
 * Handle checkout submission
 * Sends all images to LumaPrints (one print per image)
 * Uses original/full quality images for printing
 */
async function handleCheckout() {
	isLoading = true;

	const checkoutData = {
		productId: data.printSet.slug,
		title: data.printSet.title,
		price: selectedPaperData?.price || data.printSet.price,
		image: data.printSet.previewImage,
		paper: selectedPaperData ? {
			name: selectedPaperData.name,
			subcategoryId: selectedPaperData.subcategoryId,
			width: selectedPaperData.width,
			height: selectedPaperData.height,
		} : null,
		coupon: couponCode.trim() || null,
		isPrintSet: true,
		// Send original images to LumaPrints (not compressed)
		images: (data.images as ProductImage[]).map(img => img.original),
	};

	try {
		const response = await fetch("/api/checkout", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(checkoutData),
		});

		const result = await response.json();

		if (result.url) {
			window.location.href = result.url;
		} else if (result.error) {
			alert(result.error);
			isLoading = false;
		}
	} catch (err) {
		console.error("Checkout error:", err);
		alert("Something went wrong. Please try again.");
		isLoading = false;
	}
}
</script>

<SEO
	title="{data.printSet.title} | angel's rest"
	description={data.printSet.description || `Print set: ${data.printSet.title}`}
	url="https://angelsrest.online/shop/sets/{data.printSet.slug}"
/>

<div class="px-6! md:px-8! lg:px-10!">
	<!-- Breadcrumb navigation -->
	<div class="mb-6">
		<a href="/shop" class="inline-block text-sm text-surface-600-300-token hover:text-surface-400">
			← back to shop
		</a>
		{#if data.printSet.parent}
			<span class="mx-2 text-surface-500">/</span>
			<a href="/shop/prints/{data.printSet.parent.slug}" class="inline-block text-sm text-surface-600-300-token hover:text-surface-400">
				{data.printSet.parent.title}
			</a>
		{/if}
	</div>

	<!-- Collection title and description -->
	<div class="text-center mb-8">
		<h1 class="text-3xl font-bold mb-2">{data.printSet.title}</h1>
		{#if data.printSet.description}
			<p class="text-lg text-surface-600-300-token">{data.printSet.description}</p>
		{/if}
	</div>

	<!-- Two-column layout: images left, purchase right -->
	<div class="grid md:grid-cols-3 gap-8">
		<!-- Images grid (spans 2 columns) -->
		<div class="md:col-span-2">
			{#if data.images.length > 0}
				<div class="columns-2 md:columns-3 gap-4">
					{#each data.images as image}
						<div class="mb-4 break-inside-avoid">
							<img
								src={(image as ProductImage).thumb}
								alt={image.alt}
								class="w-full h-auto rounded-lg"
							/>
						</div>
					{/each}
				</div>
			{/if}
		</div>

		<!-- Purchase sidebar (sticks to right) -->
		<div class="md:col-span-1">
			<div class="sticky top-8 bg-surface-500/10 border border-surface-500/20 rounded-lg p-6">
				<!-- Price -->
				<div class="text-3xl font-semibold text-surface-900-50-token mb-4">
					${selectedPaperData?.price || data.printSet.price}
				</div>

				<!-- Paper selection dropdown -->
				{#if data.printSet.availablePapers?.length > 0}
					<div class="mb-4">
						<label class="block text-sm text-surface-600-300-token mb-1">
							Paper Type
						</label>
						<select bind:value={selectedPaperIndex} class="select w-full">
							{#each data.printSet.availablePapers as paper, i}
								{@const parsed = parsePaperOption(paper)}
								{@const priceNote = paper.price ? ` (+$${paper.price})` : ''}
								<option value={i}>{parsed.name}{priceNote}</option>
							{/each}
						</select>
					</div>
				{/if}

				<!-- Coupon code input -->
				<div class="mt-4">
					<label class="block text-sm text-surface-600-300-token mb-1">
						promo code
					</label>
					<input
						type="text"
						bind:value={couponCode}
						placeholder="enter code"
						class="w-full px-3 py-2 bg-surface-500/10 border border-surface-500/20 rounded-md text-sm lowercase"
					/>
				</div>

				<!-- Buy button -->
				<button
					onclick={handleCheckout}
					disabled={isLoading}
					class="btn variant-filled-primary w-full mt-4"
				>
					{isLoading ? "Processing..." : "Buy Now"}
				</button>

				<p class="text-xs text-surface-500 text-center mt-2">
					Secure checkout powered by Stripe
				</p>
			</div>
		</div>
	</div>
</div>
