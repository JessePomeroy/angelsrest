<!--
  Client Story Template
  
  A wedding/event story layout with large hero header, testimonial-style
  brief/result sections, and a warm closing message.
  
  Provider-neutral fields used:
  - brief: What the client wanted for their event
  - approach: How you captured the day
  - outcome: Final delivery or favorite moments
  
  Used for: Wedding stories, event recaps, couple features.
-->

<script lang="ts">
import type { BlogPostDetail } from "$lib/blog/content";
import BlogRichText from "$lib/components/BlogRichText.svelte";
import { formatDate } from "$lib/utils/format";

let { post }: { post: BlogPostDetail } = $props();
</script>

<article class="post">
  <!-- Hero Header -->
  <header class="post-header">
    <span class="template-label">
      Client Story
    </span>
    <h1 class="post-title">
      {post.title}
    </h1>
    {#if post.author || post.publishedAt}
      <div class="byline">
        {#if post.author}
          <span>Photos by {post.author.name}</span>
          {#if post.publishedAt}<span>•</span>{/if}
        {/if}
        {#if post.publishedAt}
          <span>{formatDate(post.publishedAt)}</span>
        {/if}
      </div>
    {/if}
  </header>

  <!-- Full-bleed Featured Image -->
  {#if post.mainImage}
    <div class="featured-image">
      <img
        src={post.mainImage.src}
        alt={post.mainImage.alt}
        class="featured-photo"
      />
    </div>
  {/if}

  <!-- Brief / Approach / Result -->
  <div class="project-summary">
    {#if post.brief}
      <section class="testimonial">
        <h2 class="summary-heading">
          The Brief
        </h2>
        <p class="testimonial-copy">{post.brief}</p>
      </section>
    {/if}

    {#if post.approach}
      <section class="approach">
        <h2 class="approach-heading">
          Our Approach
        </h2>
        <p class="approach-copy">{post.approach}</p>
      </section>
    {/if}

    {#if post.outcome}
      <section class="testimonial">
        <h2 class="summary-heading">
          The Result
        </h2>
        <p class="testimonial-copy">{post.outcome}</p>
      </section>
    {/if}
  </div>

  <!-- Gallery Body -->
  {#if post.body.length > 0}
    <div class="article-body">
      <BlogRichText blocks={post.body} />
    </div>
  {/if}

  <!-- Story footer -->
  <footer class="post-footer">
    <p class="closing-message">
      Thank you for sharing your day with us 💕
    </p>
    {#if post.author}
      <p class="signature">
        — {post.author.name}
      </p>
    {/if}
  </footer>
</article>

<style>
  @layer components {
    .post { max-width: 56rem; margin-inline: auto; }
    .post-header { margin-bottom: 3rem; text-align: center; }
    .template-label { font-size: var(--text-xs); line-height: var(--text-xs--line-height); letter-spacing: 0.1em; color: var(--color-surface-400); text-transform: uppercase; margin-bottom: 1rem; display: block; }
    .post-title { font-size: var(--text-4xl); }
    @media (min-width: 48rem) { .post-title { font-size: var(--text-6xl); } }
    .byline { display: flex; align-items: center; justify-content: center; gap: 1rem; font-size: var(--text-sm); line-height: var(--text-sm--line-height); color: var(--color-surface-400); }
    .featured-image { margin-bottom: 3rem; margin-inline: -1rem; border-radius: 0.5rem; overflow: hidden; }
    @media (min-width: 48rem) { .featured-image { margin-inline: -5rem; } }
    .featured-photo { width: 100%; height: auto; }
    .project-summary { display: grid; gap: 1.5rem; margin-bottom: 3rem; max-width: 42rem; margin-inline: auto; }
    .testimonial { text-align: center; }
    .summary-heading { font-size: var(--text-xs); color: var(--color-surface-400); text-transform: uppercase; }
    .testimonial-copy { font-size: var(--text-xl); line-height: var(--text-xl--line-height); font-style: italic; }
    .approach { background-color: color-mix(in oklab, var(--color-surface-800) 30%, transparent); padding: 1.5rem; border-radius: 0.5rem; }
    .approach-heading { font-size: var(--text-xs); color: var(--color-surface-400); text-transform: uppercase; text-align: center; }
    .approach-copy { font-size: var(--text-lg); line-height: var(--text-lg--line-height); }
    .post-footer { margin-top: 4rem; padding-top: 2rem; border-top-width: 1px; border-top-style: solid; border-color: color-mix(in oklab, var(--color-surface-500) 20%, transparent); text-align: center; }
    .closing-message { color: var(--color-surface-400); font-style: italic; }
    .signature { color: var(--color-surface-500); }
  }
</style>
