<script lang="ts">
  /**
   * Shop Index Page - Clean Implementation
   * Using proper Skeleton design tokens with hamlindigo theme
   */
  import SEO from "$lib/components/SEO.svelte";

  let { data } = $props();

  let activeCategory = $state("all");

  let filteredProducts = $derived(
    activeCategory === "all"
      ? data.products
      : data.products.filter((product) => product.category === activeCategory),
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

  <!-- Product grid using proper surface tokens -->
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
          <h2 class="mt-2 font-medium text-center">
            {product.title}
          </h2>
        </div>
      </a>
    {/each}
  </div>

  {#if filteredProducts.length === 0}
    <div class="text-center text-surface-500 mt-12">
      <p>No products found in this category.</p>
    </div>
  {/if}
</div>