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

let { data } = $props();

let activeCategory = $state("all");

// Show collections only for Prints category, products for everything else
let showCollections = $derived(activeCategory === "prints");

// Filter products by category:
// - "all": exclude prints that belong to collections (they show in collections instead)
// - "prints": show only prints without a collection link
// - other: filter by exact category match
let filteredProducts = $derived(
	activeCategory === "all"
		? data.products.filter(
				(p: any) => p.category !== "prints" || !p.collection?.slug,
			)
		: activeCategory === "prints"
			? data.products.filter((p: any) => p.category === "prints" && !p.collection?.slug) // Show prints without collection
			: data.products.filter(
					(product: { category: string }) =>
						product.category === activeCategory,
				),
);

// Collections (printCollection schema) - only show for Prints category
let filteredCollections = $derived(
	activeCategory === "prints" ? data.collections : [],
);

// Print sets (printSet schema) - only show for Prints category
let filteredPrintSets = $derived(
	activeCategory === "prints" ? data.printSets : [],
);

const categories = [
	{ label: "All", value: "all" },
	{ label: "Prints", value: "prints" },
	{ label: "Postcards", value: "postcards" },
	{ label: "Tapestries", value: "tapestries" },
	{ label: "Digital", value: "digital" },
	{ label: "Merchandise", value: "merchandise" },
];
</script>

<SEO
  title="shop | angel's rest"
  description="Art prints, postcards, woven tapestries, and digital downloads by Jesse Pomeroy."
  url="https://angelsrest.online/shop"
/>

<div class="px-6! md:px-8! lg:px-10!">
  <!-- Shop header using proper design tokens -->
  <div class="text-center mb-8">
    <h1 class="text-3xl font-bold mb-2">shop</h1>
    <p class="text-lg text-surface-600-300-token">
      art prints, tapestries, and digital goods
    </p>
  </div>

  <!-- Category filter using Skeleton design system -->
  <div class="flex flex-wrap justify-center gap-2 mb-8">
    {#each categories as category}
      <button
        class="btn btn-sm {activeCategory === category.value
          ? 'variant-filled-primary'
          : 'variant-soft-surface'}"
        style="text-transform: lowercase !important;"
        onclick={() => (activeCategory = category.value)}
      >
        {category.label}
      </button>
    {/each}
  </div>

  <!-- Collections grid (shown for Prints category) -->
  {#if filteredCollections.length > 0}
    <div class="columns-2 md:columns-3 gap-4">
      {#each filteredCollections as collection}
        <a
          href="/shop/prints/{collection.slug}"
          class="group mb-4 break-inside-avoid block"
        >
          <div class="bg-surface-500/10 border border-surface-500/20 p-3 rounded-lg hover:border-surface-400/40 transition-all">
            <div class="overflow-hidden rounded-md">
              <img
                src={collection.previewImage}
                alt={collection.alt || collection.title}
                class="w-full h-auto object-contain group-hover:scale-105 transition-transform"
              />
            </div>
            <h2 class="mt-3 text-xs tracking-[0.15em] text-center">
              {collection.title}
            </h2>
          </div>
        </a>
      {/each}
    </div>
  {/if}

  <!-- Print Sets grid (shown for Prints category) -->
  {#if filteredPrintSets.length > 0}
    <div class="mb-8">
      <h2 class="text-xl font-semibold mb-4">sets</h2>
      <div class="columns-2 md:columns-3 gap-4">
        {#each filteredPrintSets as set}
          <a
            href="/shop/sets/{set.slug}"
            class="group mb-4 break-inside-avoid block"
          >
            <div class="bg-surface-500/10 border border-surface-500/20 p-3 rounded-lg hover:border-surface-400/40 transition-all">
              <!-- Two images side by side -->
              <div class="grid grid-cols-2 gap-0.5 overflow-hidden rounded-md">
                {#if set.preview1}
                  <img
                    src={set.preview1}
                    alt="{set.title} - image 1"
                    class="w-full h-auto object-contain group-hover:scale-105 transition-transform"
                  />
                {/if}
                {#if set.preview2}
                  <img
                    src={set.preview2}
                    alt="{set.title} - image 2"
                    class="w-full h-auto object-contain group-hover:scale-105 transition-transform"
                  />
                {/if}
              </div>
              <h2 class="mt-3 text-xs tracking-[0.15em] text-center">
                {set.title}
              </h2>
              {#if set.price}
                <p class="text-xs text-center text-surface-500 mt-1">${set.price}</p>
              {/if}
            </div>
          </a>
        {/each}
      </div>
    </div>
  {/if}

  <!-- Product grid using proper surface tokens -->
  {#if filteredProducts.length > 0}
    <div class="columns-2 md:columns-3 gap-4">
      {#each filteredProducts as product}
        <a
          href="/shop/{product.slug}"
          class="group mb-4 break-inside-avoid block"
        >
          <!-- Card wrapper - matches BlogCard styling -->
          <div class="bg-surface-500/10 border border-surface-500/20 p-3 rounded-lg hover:border-surface-400/40 transition-all">
            <!-- Image container -->
            <div class="overflow-hidden rounded-md">
              <img
                src={product.preview}
                alt={product.title}
                class="w-full h-auto object-contain group-hover:scale-105 transition-transform"
              />
            </div>
            <!-- Product info -->
            <h2 class="mt-3 text-xs tracking-[0.15em] text-center">
              {product.title}
            </h2>
          </div>
        </a>
      {/each}
    </div>
  {/if}

  {#if filteredProducts.length === 0 && filteredCollections.length === 0}
    <div class="text-center text-surface-500 mt-12">
      <p>No products found in this category.</p>
    </div>
  {/if}
</div>
