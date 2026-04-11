<script lang="ts">
/**
 * Product Detail Page with Stripe Checkout Integration
 *
 * This component demonstrates several advanced SvelteKit patterns:
 * 1. Dynamic routing with [slug] parameter
 * 2. Server-side data loading with type safety
 * 3. Client-side API interactions
 * 4. State management with Svelte 5 runes
 * 5. Error handling and loading states
 *
 * E-commerce Patterns:
 * - Product gallery with lightbox
 * - Direct "Buy Now" checkout (no cart)
 * - Stock status indication
 * - Category organization
 * - Responsive design
 */

import GalleryModal from "$lib/components/GalleryModal.svelte";
import SEO from "$lib/components/SEO.svelte";
import { cart } from "$lib/shop/cart.svelte";
import { cartUI } from "$lib/shop/cartUI.svelte";
import type { ParsedPaper } from "$lib/types/shop";
import { createCheckout } from "$lib/utils/checkout";
import { parsePaperOption } from "$lib/utils/images";

/**
 * Props from Server Load Function
 *
 * The data prop contains everything returned from +page.server.ts
 * Type safety ensures we catch errors at build time, not runtime.
 *
 * Key principle: Server-side data loading for SEO and performance
 */
let { data } = $props();

/**
 * Component State with Svelte 5 Runes
 *
 * Runes are Svelte's new reactive system:
 * - $state() for mutable reactive values
 * - $derived() for computed values
 * - More predictable than Svelte 4's reactivity
 *
 * State Management Strategy:
 * - Keep state minimal and focused
 * - Use meaningful variable names
 * - Initialize with sensible defaults
 */
let modalOpen = $state(false); // Controls image lightbox visibility
let selectedIndex = $state(0); // Which image to show in lightbox
let isLoading = $state(false); // Prevents double-clicks during checkout
let selectedPaperIndex = $state(0); // Index of selected paper for LumaPrints
let couponCode = $state(""); // Coupon/promo code

// Get selected paper from index - parse combined value format "Name|subcategoryId|width|height"
const selectedPaperData: ParsedPaper | null = $derived.by(() => {
	if (!data.product.availablePapers?.length) return null;
	const paper =
		data.product.availablePapers[selectedPaperIndex] ||
		data.product.availablePapers[0];
	if (!paper?.name) return null;
	return parsePaperOption(paper);
});

/**
 * Modal Control Functions
 *
 * Clean separation of concerns:
 * - Functions handle specific UI interactions
 * - Parameters make functions reusable
 * - State updates trigger reactive UI changes
 */
function openModal(index: number) {
	selectedIndex = index;
	modalOpen = true;
}

/**
 * Utility Function - String Formatting
 *
 * Small utility functions improve code readability:
 * - Single responsibility
 * - Easy to test
 * - Reusable across components
 */
function formatCategory(category: string) {
	return category.charAt(0).toUpperCase() + category.slice(1);
}

/**
 * Checkout Handler - The Core E-commerce Logic
 *
 * This async function orchestrates the entire checkout process:
 * 1. Prevents multiple submissions
 * 2. Calls our server-side API
 * 3. Handles errors gracefully
 * 4. Redirects to Stripe's secure checkout
 *
 * Error Handling Strategy:
 * - Try/catch for network errors
 * - Loading states for user feedback
 * - Graceful fallbacks for failures
 */
async function handleCheckout() {
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

/**
 * Add to Cart — wires the product into the shared cart store. Available
 * for any in-stock non-digital product. LumaPrints prints carry their
 * selected paper × size; self-fulfilled merch (tapestries, etc.) goes in
 * with no paper info, which is the webhook's signal to skip LumaPrints
 * submission for that line.
 */
const canAddToCart = $derived(
	data.product.category !== "digital" && data.product.inStock,
);

function handleAddToCart() {
	if (!canAddToCart) return;
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

<!--
  SEO Configuration - Critical for Product Pages

  Product pages are primary entry points from search engines.
  Dynamic SEO based on product data improves discoverability.

  Key Elements:
  - Title includes product name and brand
  - Description uses product description or fallback
  - URL matches the current page for accuracy
-->
<SEO
    title={`${data.product.title} | shop | angel's rest`}
    description={data.product.seo?.description || data.product.description || `${data.product.title} - Available in the Angels Rest shop`}
    image={data.product.seo?.ogImageUrl || data.product.images[0]?.full || "/og-image.jpg"}
    url={`https://angelsrest.online/shop/${data.product.slug}`}
/>

<!--
  Page Layout Container

  Responsive design principles:
  - Padding using Tailwind's responsive system
  - Max-width prevents overly wide content
  - Centering for visual balance
-->
<div class="max-w-6xl mx-auto">
    <!--
    Navigation Breadcrumb

    UX Benefits:
    - Shows user location in site hierarchy
    - Provides easy back navigation
    - Improves SEO with internal linking
  -->
    <a
        href="/shop"
        class="text-sm opacity-70 hover:opacity-100 mb-4 inline-block"
    >
        ← Back to shop
    </a>

    <!--
    Two-Column Product Layout

    Desktop: Images left, details right
    Mobile: Stacked (grid-cols-1 implied)

    This layout pattern is e-commerce standard:
    - Users expect images on the left
    - Product details flow naturally on the right
    - Gap provides visual separation
  -->
    <div class="grid md:grid-cols-2 gap-8">
        <!--
      Product Image Gallery

      Features:
      - Click to open full-size lightbox
      - Main image plus thumbnail grid
      - Hover effects for interactivity
      - Graceful handling of missing images
    -->
        <div class="space-y-4">
            {#if data.product.images.length > 0}
                <!--
          Main Product Image

          Interaction Design:
          - Full-width button for easy clicking
          - Hover scale effect indicates clickability
          - Opens lightbox for detailed viewing
        -->
                <button class="w-full" onclick={() => openModal(0)}>
                    <img
                        src={data.product.images[0].full}
                        alt={data.product.images[0].alt}
                        loading="lazy"
                        class="w-full h-auto hover:scale-105 transition-transform rounded-md"
                    />
                </button>

                <!--
          Additional Images Grid

          Only shows if there are multiple images.
          Grid layout for thumbnails with hover effects.
          Click handlers pass correct index to modal.
        -->
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
                <!--
          Fallback for Missing Images

          Always handle edge cases gracefully.
          This prevents broken layout when images aren't available.
        -->
                <div
                    class="aspect-square bg-surface-100-800-token rounded-md flex items-center justify-center"
                >
                    <span class="text-surface-500">No image available</span>
                </div>
            {/if}
        </div>

        <!--
      Product Information Panel

      Information hierarchy from most to least important:
      1. Title and category (what is it?)
      2. Price (how much?)
      3. Description (why buy it?)
      4. Stock status (can I buy it?)
      5. Purchase button (how to buy?)
    -->
        <div class="space-y-6">
            <!--
        Product Header

        Title uses semantic HTML (h1) for SEO.
        Category badge provides context and filtering option.
      -->
            <div>
                <h1 class="text-3xl font-semibold mb-2">
                    {data.product.title}
                </h1>
                {#if data.product.category}
                    <span class="chip variant-soft-surface">
                        {formatCategory(data.product.category)}
                    </span>
                {/if}
            </div>

            <!--
        Price Display

        Large, prominent pricing builds confidence.
        Price is critical conversion factor for e-commerce.

        Design Notes:
        - Large font size for visibility
        - Skeleton design tokens for theme consistency
        - Bold weight for emphasis
      -->
            <div class="text-3xl font-semibold text-surface-900-50-token">
                ${selectedPaperData?.price || data.product.price}
            </div>

            <!--
        Product Description

        Conditional rendering prevents empty description blocks.
        Good typography classes improve readability.
      -->
            {#if data.product.description}
                <div class="text-surface-700-200-token">
                    <p>{data.product.description}</p>
                </div>
            {/if}

            <!--
        Stock Status Indicator

        Visual status communication:
        - Green dot + "In stock" for available items
        - Red dot + "Out of stock" for unavailable items

        This reduces customer service inquiries about availability.
      -->
            <div class="flex items-center gap-2">
                {#if data.product.inStock}
                    <div class="w-3 h-3 rounded-full bg-success-500"></div>
                    <span class="text-sm text-surface-600-300-token"
                        >In stock</span
                    >
                {:else}
                    <div class="w-3 h-3 rounded-full bg-error-500"></div>
                    <span class="text-sm text-surface-600-300-token"
                        >Out of stock</span
                    >
                {/if}
            </div>

            <!-- Coupon Code Input -->
            <div class="mt-4">
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

            <!--
        Purchase Section

        The conversion point of the entire page.
        Every design decision leads users to this moment.

        Button States:
        1. Normal: "Buy Now" (clear action)
        2. Loading: "Processing..." (prevents double-clicks)
        3. Disabled: "Out of Stock" (clear unavailability)
      -->
            <!-- Paper Selection Dropdown (for LumaPrints products, hidden for digital) -->
            {#if data.product.category !== "digital" && data.product.availablePapers?.length > 0}
                <div>
                    <label
                        for="paper-type"
                        class="block text-sm text-surface-600-300-token mb-1"
                    >
                        Paper Type
                    </label>
                    <select
                        id="paper-type"
                        class="select w-full"
                        bind:value={selectedPaperIndex}
                    >
                        {#each data.product.availablePapers as paper, i}
                            <option value={i}>
                                {paper.name
                                    ? paper.name.split("|")[0]
                                    : `Option ${i + 1}`}
                            </option>
                        {/each}
                    </select>
                </div>
            {/if}

            <div class="space-y-3">
                {#if canAddToCart}
                    <button
                        class="btn variant-soft-surface w-full"
                        onclick={handleAddToCart}
                    >
                        add to cart
                    </button>
                {/if}
                <button
                    class="btn variant-filled-primary w-full"
                    disabled={!data.product.inStock || isLoading}
                    onclick={handleCheckout}
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
                {#if data.product.category === "digital"}
                    <p class="text-xs text-surface-500 text-center">
                        instant download after payment
                    </p>
                {/if}

                <!--
          Trust Badge

          Builds confidence in payment security.
          Stripe's brand recognition reduces purchase anxiety.
        -->
                <p class="text-xs text-surface-500 text-center">
                    Secure checkout powered by Stripe
                </p>
            </div>
        </div>
    </div>
</div>

<!--
  Image Lightbox Modal

  Conditional rendering for performance:
  - Only creates DOM elements when needed
  - Reduces initial page load time
  - Modal manages its own state and interactions
-->
{#if modalOpen}
    <GalleryModal
        images={data.product.images}
        currentIndex={selectedIndex}
        onClose={() => (modalOpen = false)}
    />
{/if}
