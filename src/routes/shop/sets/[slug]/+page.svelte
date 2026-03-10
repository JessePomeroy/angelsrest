<script lang="ts">
/**
 * Print Set Detail Page
 * Shows all images in a set and allows purchase of the entire set as one product.
 * 
 * Key differences from regular products:
 * - Multiple images (all sent to LumaPrints for printing)
 * - Uses original/full quality images for printing, not compressed webp
 * - Paper selection applies to ALL prints in the set
 */
import SEO from "$lib/components/SEO.svelte";

let { data } = $props();

// State for form inputs
let selectedPaperIndex = $state(0);
let couponCode = $state("");
let isLoading = $state(false);

/**
 * Parse paper option from Sanity format: "Name|subcategoryId|width|height"
 * Example: "Archival Matte 4×6|103001|4|6"
 */
function getSelectedPaper() {
	if (!data.printSet.availablePapers?.length) return null;
	const paper = data.printSet.availablePapers[selectedPaperIndex];
	if (!paper) return null;
	const parts = paper.name.split('|');
	return {
		name: parts[0],
		subcategoryId: parts[1] || '',
		width: parseInt(parts[2], 10) || 8,
		height: parseInt(parts[3], 10) || 10,
		price: paper.price || null,
	};
}

const selectedPaperData = $derived(getSelectedPaper());

/**
 * Handle checkout submission
 * Sends all images to LumaPrints (one print per image)
 * Uses original/full quality images for printing
 */
async function handleCheckout() {
	isLoading = true;

	// Build checkout payload
	// isPrintSet: tells the backend this is a print set order
	// images: ALL images from the set (original quality for LumaPrints)
	const checkoutData = {
		productId: data.printSet.slug,
		title: data.printSet.title,
		price: selectedPaperData?.price || data.printSet.price,
		image: data.printSet.previewImage, // Preview for Stripe checkout display
		paper: selectedPaperData
			? {
					name: selectedPaperData.name,
					subcategoryId: selectedPaperData.subcategoryId,
					width: selectedPaperData.width,
					height: selectedPaperData.height,
				}
			: null,
		coupon: couponCode.trim() || null,
		isPrintSet: true, // Flag for print set handling
		images: data.images.map((img: any) => img.original), // Original images for LumaPrints
	};

	try {
		const response = await fetch("/api/checkout", {
			method: "POST",
			headers: {"Content-Type": "application/json"},
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
	<!-- Back link with breadcrumb -->
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

	<div class="text-center mb-8">
		<h1 class="text-3xl font-bold mb-2">{data.printSet.title}</h1>
		{#if data.printSet.description}
			<p class="text-lg text-surface-600-300-token">{data.printSet.description}</p>
		{/if}
	</div>

	<!-- Two column layout: images left, purchase right -->
	<div class="grid md:grid-cols-3 gap-8">
		<!-- Images column (spans 2) -->
		<div class="md:col-span-2">
			{#if data.images.length > 0}
				<div class="columns-2 md:columns-3 gap-4">
					{#each data.images as image}
						<div class="mb-4 break-inside-avoid">
							<img
								src={image.thumb}
								alt={image.alt}
								class="w-full h-auto rounded-lg"
							/>
						</div>
					{/each}
				</div>
			{/if}
		</div>

		<!-- Purchase section (right sidebar) -->
		<div class="md:col-span-1">
			<div class="sticky top-8 bg-surface-500/10 border border-surface-500/20 rounded-lg p-6">
				<div class="text-3xl font-semibold text-surface-900-50-token mb-4">
					${selectedPaperData?.price || data.printSet.price}
				</div>

				<!-- Paper selection -->
				{#if data.printSet.availablePapers?.length > 0}
					<div class="mb-4">
						<label class="block text-sm text-surface-600-300-token mb-1">
							Paper Type
						</label>
						<select
							bind:value={selectedPaperIndex}
							class="select w-full"
						>
							{#each data.printSet.availablePapers as paper, i}
								{@const parts = paper.name.split('|')}
								{@const paperPrice = paper.price ? ` (+$${paper.price})` : ''}
								<option value={i}>{parts[0]}{paperPrice}</option>
							{/each}
						</select>
					</div>
				{/if}

				<!-- Coupon code -->
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
