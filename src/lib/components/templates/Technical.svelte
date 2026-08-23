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

<article class="max-w-3xl mx-auto">
  <!-- Technical Header -->
  <header class="mb-12">
    <span class="text-xs tracking-widest text-surface-400 uppercase mb-4 block">
      Technical Write-up
    </span>
    <h1 class="text-3xl md:text-4xl font-light tracking-wide mb-4">
      {post.title}
    </h1>
    {#if post.author || post.publishedAt}
      <div class="flex items-center gap-4 text-sm text-surface-400">
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
    <section class="mb-12">
      <h2 class="text-sm tracking-widest text-surface-400 uppercase mb-4">
        Gear Used
      </h2>
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
        {#each post.equipment as item, i (i)}
          <div class="bg-surface-800/50 p-4 rounded-lg text-center">
            {#if item.kind === 'photography'}
              {#if item.camera}
                <p class="text-sm text-surface-300">{item.camera}</p>
              {/if}
              {#if item.lens}
                <p class="text-sm text-surface-400">{item.lens}</p>
              {/if}
              {#if item.filmStock}
                <p class="font-mono text-sm text-accent-400">{item.filmStock}</p>
              {/if}
              {#if item.developer}
                <p class="text-xs text-surface-500">{item.developer}</p>
              {/if}
            {:else}
              {#if item.label}
                <p class="text-sm text-surface-300">{item.label}</p>
              {/if}
              {#if item.details && item.details !== item.label}
                <p class="text-xs text-surface-500">{item.details}</p>
              {/if}
            {/if}
          </div>
        {/each}
      </div>
    </section>
  {/if}

  <!-- Featured Image -->
  {#if post.mainImage}
    <div class="mb-8 rounded-lg overflow-hidden">
      <img
        src={post.mainImage.src}
        alt={post.mainImage.alt}
        class="w-full h-auto"
      />
    </div>
  {/if}

  <!-- Technical content -->
  <div class="prose dark:prose-invert max-w-none font-mono text-sm">
    {#if post.body.length > 0}
      <BlogRichText blocks={post.body} />
    {/if}
  </div>

  <!-- Technical footer -->
  <footer class="mt-12 pt-8 border-t border-surface-500/20">
    <div class="flex items-center gap-2 text-xs text-surface-500">
      <span>Technical Notes</span>
      <span>•</span>
      <span>{post.equipment.length} items listed</span>
    </div>
  </footer>
</article>
