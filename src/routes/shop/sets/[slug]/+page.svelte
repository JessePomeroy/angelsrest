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
import { cart } from "$lib/shop/cart.svelte";
import { cartUI } from "$lib/shop/cartUI.svelte";
import type { ParsedPaper, ProductImage } from "$lib/types/shop";
import { createCheckout } from "$lib/utils/checkout";
import { imageSet, parsePaperOption } from "$lib/utils/images";

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

/**
 * Add to Cart — wires the print set into the shared cart store as a
 * single line with type=set and the full original-quality imageUrls
 * array attached. The cart drawer renders the cover image with a "+N"
 * extra-image badge to communicate that the line is a multi-print set.
 *
 * The webhook decoder expands set entries into one OrderItem per image
 * at the cart line's quantity, so buying 2 of a 3-image set submits 6
 * prints to LumaPrints.
 */
function handleAddToCart() {
	if (!selectedPaperData) return;
	const priceDollars =
		selectedPaperData.price ?? data.printSet.price;
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
    description={data.printSet.description ||
        `Print set: ${data.printSet.title}`}
    url="https://angelsrest.online/shop/sets/{data.printSet.slug}"
/>

<div class="px-6! md:px-8! lg:px-10!">
    <!-- Breadcrumb navigation -->
    <div class="mb-6">
        <a
            href="/shop"
            class="inline-block text-sm text-surface-600-300-token hover:text-surface-400"
        >
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

    <!-- Collection title and description -->
    <div class="text-center mb-8">
        <h1 class="text-3xl font-bold mb-2">{data.printSet.title}</h1>
        {#if data.printSet.description}
            <p class="text-lg text-surface-600-300-token">
                {data.printSet.description}
            </p>
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
                                loading="lazy"
                                class="w-full h-auto rounded-lg"
                            />
                        </div>
                    {/each}
                </div>
            {/if}
        </div>

        <!-- Purchase sidebar (sticks to right) -->
        <div class="md:col-span-1">
            <div
                class="sticky top-8 bg-surface-500/10 border border-surface-500/20 rounded-lg p-6"
            >
                <!-- Price -->
                <div
                    class="text-3xl font-semibold text-surface-900-50-token mb-4"
                >
                    ${selectedPaperData?.price || data.printSet.price}
                </div>

                <!-- Paper selection dropdown -->
                {#if data.printSet.availablePapers?.length > 0}
                    <div class="mb-4">
                        <label
                            for="set-paper-type"
                            class="block text-sm text-surface-600-300-token mb-1"
                        >
                            Paper Type
                        </label>
                        <select
                            id="set-paper-type"
                            bind:value={selectedPaperIndex}
                            class="select w-full"
                        >
                            {#each data.printSet.availablePapers as paper, i}
                                {@const parsed = parsePaperOption(paper)}
                                {@const priceNote = paper.price
                                    ? ` (+$${paper.price})`
                                    : ""}
                                <option value={i}
                                    >{parsed.name}{priceNote}</option
                                >
                            {/each}
                        </select>
                    </div>
                {/if}

                <!-- Coupon code input -->
                <div class="mt-4">
                    <label
                        for="set-promo-code"
                        class="block text-sm text-surface-600-300-token mb-1"
                    >
                        promo code
                    </label>
                    <input
                        id="set-promo-code"
                        type="text"
                        bind:value={couponCode}
                        placeholder="enter code"
                        class="w-full px-3 py-2 bg-surface-500/10 border border-surface-500/20 rounded-md text-sm lowercase"
                    />
                </div>

                <!-- Add to cart + Buy now -->
                <div class="space-y-3 mt-4">
                    {#if selectedPaperData}
                        <button
                            onclick={handleAddToCart}
                            class="btn variant-soft-surface w-full"
                        >
                            add to cart
                        </button>
                    {/if}
                    <button
                        onclick={handleCheckout}
                        disabled={isLoading}
                        class="btn variant-filled-primary w-full"
                    >
                        {isLoading ? "processing..." : "buy now"}
                    </button>
                </div>

                <p class="text-xs text-surface-500 text-center mt-2">
                    secure checkout powered by stripe
                </p>
            </div>
        </div>
    </div>
</div>
