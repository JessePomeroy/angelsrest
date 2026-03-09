<script lang="ts">
/**
 * Print Collection Detail Page
 * Shows all prints in a collection (grid like gallery)
 */
import SEO from "$lib/components/SEO.svelte";

let { data } = $props();
</script>

<SEO
  title="{data.collection.title} | angel's rest"
  description={data.collection.description || `Prints in the ${data.collection.title} collection`}
  url="https://angelsrest.online/shop/prints/{data.collection.slug}"
/>

<div class="px-6! md:px-8! lg:px-10!">
  <!-- Back link -->
  <a href="/shop" class="inline-block mb-6 text-sm text-surface-600-300-token hover:text-surface-400">
    ← back to shop
  </a>

  <!-- Collection header -->
  <div class="text-center mb-8">
    <h1 class="text-3xl font-bold mb-2">{data.collection.title}</h1>
    {#if data.collection.description}
      <p class="text-lg text-surface-600-300-token">{data.collection.description}</p>
    {/if}
  </div>

  <!-- Cover image (if exists) -->
  {#if data.collection.coverImage}
    <div class="mb-8 max-w-2xl mx-auto">
      <img
        src={data.collection.coverImage}
        alt={data.collection.alt || data.collection.title}
        class="w-full h-auto rounded-lg"
      />
    </div>
  {/if}

  <!-- Products grid -->
  {#if data.products.length > 0}
    <div class="columns-2 md:columns-3 gap-4">
      {#each data.products as product}
        <a
          href="/shop/{product.slug}"
          class="group mb-4 break-inside-avoid block"
        >
          <div class="bg-surface-500/10 border border-surface-500/20 p-3 rounded-lg hover:border-surface-400/40 transition-all">
            <div class="overflow-hidden rounded-md">
              <img
                src={product.preview}
                alt={product.title}
                class="w-full h-auto object-contain group-hover:scale-105 transition-transform"
              />
            </div>
            <h2 class="mt-3 text-xs tracking-[0.15em] text-center">
              {product.title}
            </h2>
          </div>
        </a>
      {/each}
    </div>
  {:else}
    <div class="text-center text-surface-500 mt-12">
      <p>No prints available in this collection yet.</p>
    </div>
  {/if}
</div>
