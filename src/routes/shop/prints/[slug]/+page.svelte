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

<div class="collection-page">
  <!-- Back link with breadcrumb -->
  <div class="collection-section">
    <a href="/shop" class="breadcrumb-link">
      ← back to shop
    </a>
    {#if data.collection.parent}
      <span class="breadcrumb-separator">/</span>
      <a href="/shop/prints/{data.collection.parent.slug}" class="breadcrumb-link">
        {data.collection.parent.title}
      </a>
    {/if}
  </div>

  <!-- Collection header -->
  <div class="collection-heading">
    <h1 class="collection-title">{data.collection.title}</h1>
    {#if data.collection.description}
      <p class="collection-description">{data.collection.description}</p>
    {/if}
  </div>

  <!-- Sub-collections grid -->
  {#if data.subCollections && data.subCollections.length > 0}
    <div class="collection-section">
      <h2 class="section-title">collections</h2>
      <div class="collection-columns">
        {#each data.subCollections as subCollection (subCollection.slug)}
          <a
            href="/shop/prints/{subCollection.slug}"
            class="collection-entry"
          >
            <div class="entry-card">
              <div class="image-clip">
                <img
                  src={subCollection.previewImage}
                  alt={subCollection.alt || subCollection.title}
                  loading="lazy"
                  class="entry-image"
                />
              </div>
              <h2 class="entry-title">
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
    <div class="collection-section">
      <h2 class="section-title">sets</h2>
      <div class="collection-columns">
        {#each data.printSets as set (set.slug)}
          <a
            href="/shop/sets/{set.slug}"
            class="collection-entry"
          >
            <div class="entry-card">
              <!-- Two images side by side -->
              <div class="set-preview">
                {#if set.preview1}
                  <img
                    src={set.preview1}
                    alt="{set.title} - image 1"
                    loading="lazy"
                  class="entry-image"
                  />
                {/if}
                {#if set.preview2}
                  <img
                    src={set.preview2}
                    alt="{set.title} - image 2"
                    loading="lazy"
                  class="entry-image"
                  />
                {/if}
              </div>
              <h2 class="entry-title">
                {set.title}
              </h2>
              {#if set.price}
                <p class="entry-price">${set.price}</p>
              {/if}
            </div>
          </a>
        {/each}
      </div>
    </div>
  {/if}

  <!-- Products grid -->
  {#if data.products.length > 0}
    <div class="collection-columns">
      {#each data.products as product (product.slug)}
        <a
          href="/shop/{product.slug}"
          class="collection-entry"
        >
          <div class="entry-card">
            <div class="image-clip">
              <img
                src={product.preview}
                alt={product.title}
                loading="lazy"
                  class="entry-image"
              />
            </div>
            <h2 class="entry-title">
              {product.title}
            </h2>
          </div>
        </a>
      {/each}
    </div>
  {:else}
    <div class="empty-state">
      <p>No prints available in this collection yet.</p>
    </div>
  {/if}
</div>

<style>
  @layer components {
    .collection-page { padding-inline: 0.5rem; }
    @media (min-width: 48rem) { .collection-page { padding-inline: 2rem; } }
    @media (min-width: 64rem) { .collection-page { padding-inline: 2.5rem; } }
    .collection-section { margin-bottom: 1.5rem; }
    .breadcrumb-link { display: inline-block; font-size: var(--text-sm); line-height: var(--text-sm--line-height); color: var(--color-surface-600); }
    :global(.dark) .breadcrumb-link { color: var(--color-surface-300); }
    @media (hover: hover) { .breadcrumb-link:hover { color: var(--color-surface-400); } }
    .breadcrumb-separator { margin-inline: 0.5rem; color: var(--color-surface-500); }
    .collection-heading { text-align: center; margin-bottom: 1.5rem; }
    .collection-title { font-size: var(--text-3xl); }
    .collection-description { font-size: var(--text-lg); line-height: var(--text-lg--line-height); color: var(--color-surface-600); }
    :global(.dark) .collection-description { color: var(--color-surface-300); }
    .section-title { font-size: var(--text-xl); }
    .collection-columns { column-count: 2; gap: 0.5rem; }
    @media (min-width: 48rem) { .collection-columns { column-count: 3; } }
    .collection-entry { margin-bottom: 0.5rem; break-inside: avoid; display: block; }
    .entry-card { background-color: color-mix(in oklab, var(--color-surface-500) 10%, transparent); border: 1px solid; border-color: color-mix(in oklab, var(--color-surface-500) 20%, transparent); padding: 0.5rem; border-radius: 0.5rem; transition: all 150ms cubic-bezier(0.4, 0, 0.2, 1); }
    @media (hover: hover) { .entry-card:hover { border-color: color-mix(in oklab, var(--color-surface-400) 40%, transparent); } }
    .image-clip { overflow: hidden; border-radius: 0.375rem; }
    .entry-image { width: 100%; height: auto; object-fit: contain; transition-property: transform, translate, scale, rotate; transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1); transition-duration: 150ms; }
    @media (hover: hover) { .collection-entry:hover .entry-image { scale: 1.05; } }
    .entry-title { font-size: var(--text-xs); text-align: center; }
    .set-preview { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.125rem; overflow: hidden; border-radius: 0.375rem; }
    .entry-price { font-size: var(--text-xs); line-height: var(--text-xs--line-height); text-align: center; color: var(--color-surface-500); }
    .empty-state { text-align: center; color: var(--color-surface-500); margin-top: 3rem; }
  }
  /* Preserve the unlayered time accent that previously targeted Tailwind's group marker. */
  :global([data-time-period]) .collection-entry:hover > .entry-card {
    border-color: var(--time-accent);
    opacity: 0.85;
  }
</style>
