<script lang="ts">
/**
 * Shop Index Page
 *
 * Shows products organized by category:
 * - All: individual products
 * - Prints: print sets + individual prints
 * - Other categories: products in that category
 *
 * Print Sets are specific to the Prints category.
 */
import SEO from "$lib/components/SEO.svelte";
import type { PageData } from "./$types";

let { data }: { data: PageData } = $props();

let activeCategory = $state("all");

const filteredProducts = $derived(
	activeCategory === "all"
		? data.products
		: data.products.filter((product) => product.category === activeCategory),
);

const filteredPrintSets = $derived(
	activeCategory === "prints" ? data.printSets : [],
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

<section class="shop-index">
    <!-- Shop header -->
    <header class="shop-heading">
        <h1>shop</h1>
        <p>
            art prints, tapestries, and digital goods
        </p>
    </header>

    <!-- Category filter tabs -->
    <div class="category-tabs" role="tablist">
        {#each categories as category (category.value)}
            <button
                role="tab"
                aria-selected={activeCategory === category.value}
                class:active-tab={activeCategory === category.value}
                onclick={() => (activeCategory = category.value)}
            >
                {category.label}
            </button>
        {/each}
    </div>

    <!-- Print Sets grid (Prints only) -->
    {#if filteredPrintSets.length > 0}
        <div class="catalog-section">
            <h2 class="catalog-heading">sets</h2>
            <div class="catalog-columns">
                {#each filteredPrintSets as set (set.slug)}
                    <a
                        href="/shop/sets/{set.slug}"
                        class="catalog-entry"
                    >
                        <div class="catalog-image">
                            <!-- Two images side by side -->
                            <div
                                class="set-preview"
                            >
                                {#if set.preview1}
                                    <img
                                        src={set.preview1}
                                        alt="{set.title} - 1"
                                        loading="lazy"
                                        class="catalog-photo"
                                    />
                                {/if}
                                {#if set.preview2}
                                    <img
                                        src={set.preview2}
                                        alt="{set.title} - 2"
                                        loading="lazy"
                                        class="catalog-photo"
                                    />
                                {/if}
                            </div>
                            <h2 class="entry-title">
                                {set.title}
                            </h2>
                            {#if set.price}
                                <p class="entry-price">
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
        <div class="catalog-columns">
            {#each filteredProducts as product (product.slug)}
                <a
                    href="/shop/{product.slug}"
                    class="catalog-entry"
                >
                    <div
                        class="catalog-image"
                        class:featured-card={product.featured}
                    >
                        {#if product.preview}
                            <div class="image-clip">
                                <img
                                    src={product.preview}
                                    alt={product.title}
                                    class="catalog-photo"
                                />
                            </div>
                        {/if}
                        <h2 class="entry-title">
                            {product.title}
                        </h2>
                    </div>
                </a>
            {/each}
        </div>
    {/if}

    {#if filteredProducts.length === 0 && filteredPrintSets.length === 0}
        <div class="empty-state">
            <p>No products found in this category.</p>
        </div>
    {/if}
</section>

<style>
  @layer components {
    .empty-state { text-align: center; color: var(--color-surface-500); margin-top: 3rem; }
  }
    .shop-index { width: 100%; }
    .shop-heading { display: grid; grid-template-columns: 1fr auto; min-height: 56px; margin-bottom: 0; align-items: start; border-bottom: 1px solid color-mix(in srgb, currentColor 15%, transparent); }
    .shop-heading h1 { font-size: 1.35rem; font-weight: 500; }
    .shop-heading p { padding-top: 5px; color: color-mix(in srgb, currentColor 55%, transparent); font-size: 0.7rem; letter-spacing: 0.08em; }
    .category-tabs { display: flex; overflow-x: auto; overflow-y: hidden; margin-bottom: 34px; border-bottom: 1px solid color-mix(in srgb, currentColor 13%, transparent); scrollbar-width: none; }
    .category-tabs::-webkit-scrollbar { display: none; }
    .category-tabs button { position: relative; flex: 0 0 auto; padding: 14px 16px 13px; border: 0; background: transparent; color: color-mix(in srgb, currentColor 52%, transparent); font: inherit; font-size: 0.7rem; letter-spacing: 0.1em; cursor: pointer; }
    .category-tabs button::after { content: ""; position: absolute; right: 16px; bottom: -1px; left: 16px; height: 1px; background: var(--time-accent); transform: scaleX(0); transition: transform 180ms ease; }
    .category-tabs button:hover,
    .category-tabs button.active-tab { color: currentColor; }
    .category-tabs button.active-tab::after { transform: scaleX(1); }
    .catalog-section { margin-bottom: 40px; }
    .catalog-heading { margin-bottom: 16px; font-size: 0.74rem; font-weight: 500; letter-spacing: 0.14em; }
    .catalog-columns { columns: 2; column-gap: 18px; }
    .catalog-entry { display: block; margin-bottom: 24px; break-inside: avoid; color: inherit; }
    .catalog-image { overflow: hidden; border: 1px solid color-mix(in srgb, currentColor 13%, transparent); }
    .catalog-image.featured-card { border-color: color-mix(in srgb, var(--time-accent) 75%, transparent); }
    .image-clip,
    .set-preview { overflow: hidden; }
    .set-preview { display: grid; grid-template-columns: 1fr 1fr; gap: 1px; }
    .catalog-photo { width: 100%; height: auto; transition: transform 400ms cubic-bezier(.22,1,.36,1); }
    .catalog-entry:hover .catalog-photo { transform: scale(1.018); }
    .entry-title { padding: 10px 10px 9px; border-top: 1px solid color-mix(in srgb, currentColor 10%, transparent); font-family: "Synonym", sans-serif; font-size: 0.7rem; font-weight: 400; letter-spacing: 0.11em; text-align: left; }
    .entry-price { padding: 0 10px 10px; color: color-mix(in srgb, currentColor 50%, transparent); font-size: 0.66rem; }
    @media (min-width: 768px) { .catalog-columns { columns: 3; } }
    @media (max-width: 640px) {
        .shop-heading { grid-template-columns: 1fr; gap: 6px; padding-bottom: 16px; }
        .shop-heading p { padding: 0; }
    }
</style>
