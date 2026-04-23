<script lang="ts">
/**
 * Shop Index Page
 *
 * Shows products organized by category:
 * - All: non-print products + individual prints without collections
 * - Prints: collections + print sets + individual prints
 * - Other categories: products in that category
 *
 * Collections and Print Sets are specific to the Prints category.
 */
import SEO from "$lib/components/SEO.svelte";
import type { PrintCollection, PrintSet, Product } from "$lib/types/shop";

let { data } = $props();

let activeCategory = $state("all");

// Determine what to show based on active category
const categoryConfig = {
	all: { showCollections: false, showPrintSets: false },
	prints: { showCollections: true, showPrintSets: true },
	postcards: { showCollections: false, showPrintSets: false },
	tapestries: { showCollections: false, showPrintSets: false },
	digital: { showCollections: false, showPrintSets: false },
	merchandise: { showCollections: false, showPrintSets: false },
} as const;

// Get current category config
const config = $derived(
	categoryConfig[activeCategory as keyof typeof categoryConfig] ??
		categoryConfig.all,
);

// Filter products based on category
// - "all": exclude prints that belong to collections
// - "prints": show only prints without a collection link
// - other: filter by exact category match
const filteredProducts = $derived.by(() => {
	const products = data.products as Product[];

	if (activeCategory === "all") {
		return products.filter(
			(p) => p.category !== "prints" || !p.collection?.slug,
		);
	}
	if (activeCategory === "prints") {
		return products.filter(
			(p) => p.category === "prints" && !p.collection?.slug,
		);
	}
	return products.filter((p) => p.category === activeCategory);
});

// Collections and print sets only show for Prints category
const filteredCollections = $derived(
	config.showCollections ? (data.collections as PrintCollection[]) : [],
);

const filteredPrintSets = $derived(
	config.showPrintSets ? (data.printSets as PrintSet[]) : [],
);

const categories = [
	{ label: "All", value: "all" },
	{ label: "Prints", value: "prints" },
	{ label: "Postcards", value: "postcards" },
	{ label: "Tapestries", value: "tapestries" },
	{ label: "Digital", value: "digital" },
	{ label: "Merchandise", value: "merchandise" },
] as const;
</script>

<SEO
    title="shop | angel's rest"
    description="Art prints, postcards, woven tapestries, and digital downloads by Jesse Pomeroy."
    url="https://angelsrest.online/shop"
/>

<div class="px-2! md:px-8! lg:px-10!">
    <!-- Shop header -->
    <div class="text-center mb-6">
        <h1 class="text-3xl font-bold mb-2">shop</h1>
        <p class="text-lg text-surface-600-300-token">
            art prints, tapestries, and digital goods
        </p>
    </div>

    <!-- Category filter tabs -->
    <div class="flex flex-wrap justify-center gap-2 mb-8" role="tablist">
        {#each categories as category (category.value)}
            <button
                role="tab"
                aria-selected={activeCategory === category.value}
                class="btn btn-sm {activeCategory === category.value
                    ? 'active-tab'
                    : 'variant-soft-surface'}"
                style="text-transform: lowercase !important;"
                onclick={() => (activeCategory = category.value)}
            >
                {category.label}
            </button>
        {/each}
    </div>

    <!-- Collections grid (Prints only) -->
    {#if filteredCollections.length > 0}
        <div class="mb-6">
            <h2 class="text-xl font-semibold mb-3">collections</h2>
            <div class="columns-2 md:columns-3 gap-2">
                {#each filteredCollections as collection (collection.slug)}
                    <a
                        href="/shop/prints/{collection.slug}"
                        class="group mb-2 break-inside-avoid block"
                    >
                        <div
                            class="bg-surface-500/10 border border-surface-500/20 p-2 rounded-lg hover:border-surface-400/40 transition-all"
                        >
                            {#if collection.previewImage}
                                <div class="overflow-hidden rounded-md">
                                    <img
                                        src={collection.previewImage}
                                        alt={collection.alt || collection.title}
                                        loading="lazy"
                                        class="w-full h-auto object-contain group-hover:scale-105 transition-transform"
                                    />
                                </div>
                            {/if}
                            <h2
                                class="mt-2 text-xs tracking-[0.15em] text-center"
                            >
                                {collection.title}
                            </h2>
                        </div>
                    </a>
                {/each}
            </div>
        </div>
    {/if}

    <!-- Print Sets grid (Prints only) -->
    {#if filteredPrintSets.length > 0}
        <div class="mb-6">
            <h2 class="text-xl font-semibold mb-3">sets</h2>
            <div class="columns-2 md:columns-3 gap-2">
                {#each filteredPrintSets as set (set.slug)}
                    <a
                        href="/shop/sets/{set.slug}"
                        class="group mb-2 break-inside-avoid block"
                    >
                        <div
                            class="bg-surface-500/10 border border-surface-500/20 p-2 rounded-lg hover:border-surface-400/40 transition-all"
                        >
                            <!-- Two images side by side -->
                            <div
                                class="grid grid-cols-2 gap-0.5 overflow-hidden rounded-md"
                            >
                                {#if set.preview1}
                                    <img
                                        src={set.preview1}
                                        alt="{set.title} - 1"
                                        loading="lazy"
                                        class="w-full h-auto group-hover:scale-105 transition-transform"
                                    />
                                {/if}
                                {#if set.preview2}
                                    <img
                                        src={set.preview2}
                                        alt="{set.title} - 2"
                                        loading="lazy"
                                        class="w-full h-auto group-hover:scale-105 transition-transform"
                                    />
                                {/if}
                            </div>
                            <h2
                                class="mt-2 text-xs tracking-[0.15em] text-center"
                            >
                                {set.title}
                            </h2>
                            {#if set.price}
                                <p
                                    class="text-xs text-center text-surface-500 mt-1"
                                >
                                    ${set.price}
                                </p>
                            {/if}
                        </div>
                    </a>
                {/each}
            </div>
        </div>
    {/if}

    <!-- Products grid -->
    {#if filteredProducts.length > 0}
        <div class="columns-2 md:columns-3 gap-2">
            {#each filteredProducts as product (product.slug)}
                <a
                    href="/shop/{product.slug}"
                    class="group mb-2 break-inside-avoid block"
                >
                    <div
                        class="{product.featured
                            ? 'featured-card bg-[color-mix(in_srgb,var(--time-accent)_8%,transparent)] border-[var(--time-accent)]'
                            : 'bg-surface-500/10 border-surface-500/20'} border p-2 rounded-lg hover:border-surface-400/40 transition-all"
                    >
                        {#if product.preview}
                            <div class="overflow-hidden rounded-md">
                                <img
                                    src={product.preview}
                                    alt={product.title}
                                    class="w-full h-auto object-contain group-hover:scale-105 transition-transform"
                                />
                            </div>
                        {/if}
                        <h2 class="mt-2 text-xs tracking-[0.15em] text-center">
                            {product.title}
                        </h2>
                    </div>
                </a>
            {/each}
        </div>
    {/if}

    {#if filteredProducts.length === 0 && filteredCollections.length === 0 && filteredPrintSets.length === 0}
        <div class="text-center text-surface-500 mt-12">
            <p>No products found in this category.</p>
        </div>
    {/if}
</div>
