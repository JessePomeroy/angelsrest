<!--
  Standard Blog Post Template
  
  A clean, simple layout for regular blog posts.
  Features: featured image → body content → back link.
  
  Used for: General blog posts without special formatting needs.
-->

<script lang="ts">
import type { BlogPostDetail } from "$lib/blog/content";
import BlogRichText from "$lib/components/BlogRichText.svelte";
import PostByline from "./PostByline.svelte";

let { post }: { post: BlogPostDetail } = $props();
</script>

<article class="post">
  <!-- Post Header -->
  <header class="post-header">
    <!-- Categories -->
    {#if post.categories && post.categories.length > 0}
      <div class="categories">
        {#each post.categories as category (category.title)}
          <span class="category">
            {category.title}
          </span>
        {/each}
      </div>
    {/if}

    <h1 class="post-title">
      {post.title}
    </h1>

    <!-- Author and Date -->
    <PostByline {post} portrait alwaysDate />
  </header>

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

  <!-- Body -->
  <div class="article-body">
    {#if post.body.length > 0}
      <BlogRichText blocks={post.body} />
    {/if}
  </div>

  <!-- Back link -->
  <div class="post-footer">
    <a href="/blog" class="back-link">
      ← back to blog
    </a>
  </div>
</article>

<style>
  @layer components {
    .post { max-width: 42rem; margin-inline: auto; }
    .post-header { margin-bottom: 2rem; }
    .categories { display: flex; gap: 0.5rem; margin-bottom: 1rem; }
    .category { font-size: var(--text-xs); line-height: var(--text-xs--line-height); color: var(--color-surface-400); letter-spacing: 0.05em; }
    .post-title { font-size: var(--text-3xl); }
    @media (min-width: 48rem) { .post-title { font-size: var(--text-4xl); } }
    .featured-image { margin-bottom: 2rem; border-radius: 0.5rem; overflow: hidden; }
    .featured-photo { width: 100%; height: auto; }
    .post-footer { margin-top: 3rem; padding-top: 2rem; border-top-width: 1px; border-top-style: solid; border-color: color-mix(in oklab, var(--color-surface-500) 20%, transparent); }
    .back-link { color: var(--color-surface-400); transition-property: color, background-color, border-color, outline-color, text-decoration-color, fill, stroke; transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1); transition-duration: 150ms; }
    .back-link:hover { color: var(--color-surface-200); }
  }
</style>
