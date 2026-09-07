<!--
  Technical Write-up Template
  
  A technical-focused layout for gear details, film stocks, and development notes.
  Features a gear grid and monospace typography.
  
  Uses the provider-neutral equipment list from the public Blog DTO.
  
  Used for: Film stock reviews, gear tests, development notes, technical tutorials.
-->

<script lang="ts">
import type { BlogPostDetail } from "$lib/blog/content";
import BlogRichText from "$lib/components/BlogRichText.svelte";
import { formatDate } from "$lib/utils/format";

let { post }: { post: BlogPostDetail } = $props();
</script>

<article class="post">
  <!-- Technical Header -->
  <header class="post-header">
    <span class="template-label">
      Technical Write-up
    </span>
    <h1 class="post-title">
      {post.title}
    </h1>
    {#if post.author || post.publishedAt}
      <div class="byline">
        {#if post.author}
          <span>{post.author.name}</span>
          {#if post.publishedAt}<span>•</span>{/if}
        {/if}
        {#if post.publishedAt}
          <span>{formatDate(post.publishedAt)}</span>
        {/if}
      </div>
    {/if}
  </header>

  <!-- Gear Grid -->
  {#if post.equipment.length > 0}
    <section class="equipment">
      <h2 class="equipment-heading">
        Gear Used
      </h2>
      <div class="equipment-grid">
        {#each post.equipment as item, i (i)}
          <div class="equipment-item">
            {#if item.kind === 'photography'}
              {#if item.camera}
                <p class="equipment-name">{item.camera}</p>
              {/if}
              {#if item.lens}
                <p class="equipment-detail">{item.lens}</p>
              {/if}
              {#if item.filmStock}
                <p class="film-stock">{item.filmStock}</p>
              {/if}
              {#if item.developer}
                <p class="equipment-notes">{item.developer}</p>
              {/if}
            {:else}
              {#if item.label}
                <p class="equipment-name">{item.label}</p>
              {/if}
              {#if item.details && item.details !== item.label}
                <p class="equipment-notes">{item.details}</p>
              {/if}
            {/if}
          </div>
        {/each}
      </div>
    </section>
  {/if}

  <!-- Featured Image -->
  {#if post.mainImage}
    <div class="featured-image">
      <img
        src={post.mainImage.src}
        alt={post.mainImage.alt}
        class="featured-photo"
      />
    </div>
  {/if}

  <!-- Technical content -->
  <div class="article-body article-body--technical">
    {#if post.body.length > 0}
      <BlogRichText blocks={post.body} />
    {/if}
  </div>

  <!-- Technical footer -->
  <footer class="post-footer">
    <div class="technical-notes">
      <span>Technical Notes</span>
      <span>•</span>
      <span>{post.equipment.length} items listed</span>
    </div>
  </footer>
</article>

<style>
  @layer components {
    .post { max-width: 48rem; margin-inline: auto; }
    .post-header, .equipment { margin-bottom: 3rem; }
    .template-label { font-size: var(--text-xs); line-height: var(--text-xs--line-height); letter-spacing: 0.1em; color: var(--color-surface-400); text-transform: uppercase; margin-bottom: 1rem; display: block; }
    .post-title { font-size: var(--text-3xl); }
    @media (min-width: 48rem) { .post-title { font-size: var(--text-4xl); } }
    .byline { display: flex; align-items: center; gap: 1rem; font-size: var(--text-sm); line-height: var(--text-sm--line-height); color: var(--color-surface-400); }
    .equipment-heading { font-size: var(--text-sm); color: var(--color-surface-400); text-transform: uppercase; }
    .equipment-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1rem; }
    @media (min-width: 48rem) { .equipment-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
    .equipment-item { background-color: color-mix(in oklab, var(--color-surface-800) 50%, transparent); padding: 1rem; border-radius: 0.5rem; text-align: center; }
    .equipment-name { font-size: var(--text-sm); line-height: var(--text-sm--line-height); color: var(--color-surface-300); }
    .equipment-detail { font-size: var(--text-sm); line-height: var(--text-sm--line-height); color: var(--color-surface-400); }
    .film-stock { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; font-size: var(--text-sm); line-height: var(--text-sm--line-height); }
    .equipment-notes { font-size: var(--text-xs); line-height: var(--text-xs--line-height); color: var(--color-surface-500); }
    .featured-image { margin-bottom: 2rem; border-radius: 0.5rem; overflow: hidden; }
    .featured-photo { width: 100%; height: auto; }
    .article-body--technical { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; font-size: var(--text-sm); line-height: var(--text-sm--line-height); }
    .post-footer { margin-top: 3rem; padding-top: 2rem; border-top-width: 1px; border-top-style: solid; border-color: color-mix(in oklab, var(--color-surface-500) 20%, transparent); }
    .technical-notes { display: flex; align-items: center; gap: 0.5rem; font-size: var(--text-xs); line-height: var(--text-xs--line-height); color: var(--color-surface-500); }
  }
</style>
