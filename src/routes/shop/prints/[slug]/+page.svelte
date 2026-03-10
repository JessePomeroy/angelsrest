<script lang="ts">
/**
 * Print Collection Detail Page
 *
 * Displays the contents of a print collection:
 * 1. Sub-collections (nested collections within this one)
 * 2. Print sets (curated bundles of images)
 * 3. Individual products assigned to this collection
 *
 * Supports breadcrumb navigation for nested collections.
 * No large header/cover image — only small preview thumbnails on cards.
 *
 * Route: /shop/prints/[slug]
 */
import SEO from "$lib/components/SEO.svelte";

let { data } = $props();
</script>

<SEO
  title="{data.collection.title} | angel's rest"
  description={data.collection.description || `Prints in the ${data.collection.title} collection`}
  url="https://angelsrest.online/shop/prints/{data.collection.slug}"
/>

<div class="px-2! md:px-8! lg:px-10!">
  <!-- Back link with breadcrumb -->
  <div class="mb-6">
    <a href="/shop" class="inline-block text-sm text-surface-600-300-token hover:text-surface-400">
      ← back to shop
    </a>
    {#if data.collection.parent}
      <span class="mx-2 text-surface-500">/</span>
      <a href="/shop/prints/{data.collection.parent.slug}" class="inline-block text-sm text-surface-600-300-token hover:text-surface-400">
        {data.collection.parent.title}
      </a>
    {/if}
  </div>

  <!-- Collection header -->
  <div class="text-center mb-6">
    <h1 class="text-3xl font-bold mb-2">{data.collection.title}</h1>
    {#if data.collection.description}
      <p class="text-lg text-surface-600-300-token">{data.collection.description}</p>
    {/if}
  </div>

  <!-- Sub-collections grid -->
  {#if data.subCollections && data.subCollections.length > 0}
    <div class="mb-6">
      <h2 class="text-xl font-semibold mb-3">collections</h2>
      <div class="columns-2 md:columns-3 gap-2">
        {#each data.subCollections as subCollection}
          <a
            href="/shop/prints/{subCollection.slug}"
            class="group mb-2 break-inside-avoid block"
          >
            <div class="bg-surface-500/10 border border-surface-500/20 p-2 rounded-lg hover:border-surface-400/40 transition-all">
              <div class="overflow-hidden rounded-md">
                <img
                  src={subCollection.previewImage}
                  alt={subCollection.alt || subCollection.title}
                  class="w-full h-auto object-contain group-hover:scale-105 transition-transform"
                />
              </div>
              <h2 class="mt-2 text-xs tracking-[0.15em] text-center">
                {subCollection.title}
              </h2>
            </div>
          </a>
        {/each}
      </div>
    </div>
  {/if}

  <!-- Print Sets in this collection -->
  {#if data.printSets && data.printSets.length > 0}
    <div class="mb-6">
      <h2 class="text-xl font-semibold mb-3">sets</h2>
      <div class="columns-2 md:columns-3 gap-2">
        {#each data.printSets as set}
          <a
            href="/shop/sets/{set.slug}"
            class="group mb-2 break-inside-avoid block"
          >
            <div class="bg-surface-500/10 border border-surface-500/20 p-2 rounded-lg hover:border-surface-400/40 transition-all">
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
              <h2 class="mt-2 text-xs tracking-[0.15em] text-center">
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

  <!-- Products grid -->
  {#if data.products.length > 0}
    <div class="columns-2 md:columns-3 gap-2">
      {#each data.products as product}
        <a
          href="/shop/{product.slug}"
          class="group mb-2 break-inside-avoid block"
        >
          <div class="bg-surface-500/10 border border-surface-500/20 p-2 rounded-lg hover:border-surface-400/40 transition-all">
            <div class="overflow-hidden rounded-md">
              <img
                src={product.preview}
                alt={product.title}
                class="w-full h-auto object-contain group-hover:scale-105 transition-transform"
              />
            </div>
            <h2 class="mt-2 text-xs tracking-[0.15em] text-center">
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
