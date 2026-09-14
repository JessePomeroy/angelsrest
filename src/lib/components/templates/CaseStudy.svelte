<!--
  Case Study Template
  
  A structured layout for project case studies with dedicated sections
  for The Brief, The Approach, and The Result.
  
  Provider-neutral fields used:
  - brief: What the client needed or project goals
  - approach: Creative direction, gear choices, film stocks
  - outcome: Final delivery or personal reflection
  
  Used for: Portfolio pieces, client projects, personal experiments.
-->

<script lang="ts">
import type { BlogPostDetail } from "$lib/blog/content";
import BlogRichText from "$lib/components/BlogRichText.svelte";
import { formatDate } from "$lib/utils/format";

let { post }: { post: BlogPostDetail } = $props();
</script>

<article class="post">
  <!-- Header -->
  <header class="post-header">
    <span class="template-label">
      Case Study
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

  <!-- Brief / Approach / Result Grid -->
  <div class="project-summary">
    {#if post.brief}
      <section class="summary-section">
        <h2 class="summary-heading">
          The Brief
        </h2>
        <p class="summary-copy">{post.brief}</p>
      </section>
    {/if}

    {#if post.approach}
      <section class="summary-section">
        <h2 class="summary-heading">
          The Approach
        </h2>
        <p class="summary-copy">{post.approach}</p>
      </section>
    {/if}

    {#if post.outcome}
      <section class="summary-section">
        <h2 class="summary-heading">
          The Result
        </h2>
        <p class="summary-copy">{post.outcome}</p>
      </section>
    {/if}
  </div>

  <!-- Body Content -->
  {#if post.body.length > 0}
    <div class="article-body">
      <BlogRichText blocks={post.body} />
    </div>
  {/if}
</article>

<style>
  @layer components {
    .post { max-width: 48rem; margin-inline: auto; }
    .post-header { margin-bottom: 3rem; text-align: center; }
    .template-label { font-size: var(--text-xs); line-height: var(--text-xs--line-height); letter-spacing: 0.1em; color: var(--color-surface-400); text-transform: uppercase; margin-bottom: 1rem; display: block; }
    .post-title { font-size: var(--text-4xl); }
    @media (min-width: 48rem) { .post-title { font-size: var(--text-5xl); } }
    .byline { display: flex; align-items: center; justify-content: center; gap: 1rem; font-size: var(--text-sm); line-height: var(--text-sm--line-height); color: var(--color-surface-400); }
    .featured-image { margin-bottom: 3rem; border-radius: 0.5rem; overflow: hidden; }
    .featured-photo { width: 100%; height: auto; }
    .project-summary { display: grid; gap: 2rem; margin-bottom: 3rem; }
    .summary-section { background-color: color-mix(in oklab, var(--color-surface-800) 50%, transparent); padding: 1.5rem; border-radius: 0.5rem; }
    .summary-heading { font-size: var(--text-sm); color: var(--color-surface-400); text-transform: uppercase; }
    .summary-copy { font-size: var(--text-lg); line-height: var(--text-lg--line-height); }
  }
</style>
