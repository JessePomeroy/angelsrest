<!--
  Behind the Scenes Template
  
  A narrative-focused, storytelling layout with full-width images
  and serif typography for a more personal, journal-like feel.
  
  Features:
  - Full-width featured image
  - Larger serif body text for readability
  - Signature footer with author name
  
  Used for: Stories about shoots, personal reflections, process breakdowns.
-->

<script lang="ts">
import type { BlogPostDetail } from "$lib/blog/content";
import BlogRichText from "$lib/components/BlogRichText.svelte";
import { formatDate } from "$lib/utils/format";

let { post }: { post: BlogPostDetail } = $props();
</script>

<article class="post">
  <!-- Header with narrative feel -->
  <header class="post-header">
    <span class="template-label">
      Behind the Scenes
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

  <!-- Full-width featured image -->
  {#if post.mainImage}
    <div class="featured-image">
      <img
        src={post.mainImage.src}
        alt={post.mainImage.alt}
        class="featured-photo"
      />
    </div>
  {/if}

  <!-- Body with narrative styling -->
  <div class="article-body article-body--narrative">
    {#if post.body.length > 0}
      <BlogRichText blocks={post.body} />
    {/if}
  </div>

  <!-- Signature footer -->
  <footer class="post-footer">
    {#if post.author}
      <p class="signature">
        — {post.author.name}
      </p>
    {/if}
  </footer>
</article>

<style>
  @layer components {
    .post { max-width: 48rem; margin-inline: auto; }
    .post-header { margin-bottom: 3rem; }
    .template-label { font-size: var(--text-xs); line-height: var(--text-xs--line-height); letter-spacing: 0.1em; color: var(--color-surface-400); text-transform: uppercase; margin-bottom: 1rem; display: block; }
    .post-title { font-size: var(--text-4xl); }
    @media (min-width: 48rem) { .post-title { font-size: var(--text-5xl); } }
    .byline { display: flex; align-items: center; gap: 1rem; font-size: var(--text-sm); line-height: var(--text-sm--line-height); color: var(--color-surface-400); }
    .featured-image { margin-bottom: 3rem; margin-inline: -1rem; }
    @media (min-width: 48rem) { .featured-image { margin-inline: -3rem; } }
    .featured-photo { width: 100%; height: auto; }
    .article-body--narrative { font-family: ui-serif, Georgia, Cambria, "Times New Roman", Times, serif; }
    .post-footer { margin-top: 3rem; padding-top: 2rem; border-top-width: 1px; border-top-style: solid; border-color: color-mix(in oklab, var(--color-surface-500) 20%, transparent); text-align: center; }
    .signature { color: var(--color-surface-400); font-style: italic; }
  }
</style>
