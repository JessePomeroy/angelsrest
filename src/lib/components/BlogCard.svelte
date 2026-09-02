<script lang="ts">
import type { BlogPostSummary } from "$lib/blog/content";
import { formatDate } from "$lib/utils/format";

let { post }: { post: BlogPostSummary } = $props();
</script>

<a
  href="/blog/{post.slug}"
  class="post-row"
>
  <div class="post-copy">
    {#if post.categories.length > 0}
      <div class="categories">
        {#each post.categories as category (category.title)}
          <span>{category.title}</span>
        {/each}
      </div>
    {/if}

    <h2>{post.title}</h2>

    {#if post.excerpt}
      <p class="excerpt">{post.excerpt}</p>
    {/if}

    <div class="post-meta">
      {#if post.author}
        <span>{post.author.name}</span>
        <span aria-hidden="true">/</span>
      {/if}
      <span>{formatDate(post.publishedAt)}</span>
    </div>
  </div>

  {#if post.mainImage}
    <div class="post-image">
      <img src={post.mainImage.src} alt={post.mainImage.alt} />
    </div>
  {/if}
</a>

<style>
  .post-row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(180px, 34%); gap: clamp(24px, 5vw, 64px); padding-block: 28px; color: inherit; border-bottom: 1px solid color-mix(in srgb, currentColor 13%, transparent); }
  .post-copy { min-width: 0; align-self: center; }
  .categories { display: flex; gap: 12px; margin-bottom: 9px; color: var(--time-accent); font-size: 0.65rem; letter-spacing: 0.12em; }
  h2 { margin-bottom: 10px; font-size: clamp(1.05rem, 2vw, 1.35rem); font-weight: 500; line-height: 1.3; }
  .excerpt { display: -webkit-box; margin-bottom: 18px; overflow: hidden; color: color-mix(in srgb, currentColor 62%, transparent); font-size: 0.82rem; line-height: 1.65; line-clamp: 3; -webkit-box-orient: vertical; -webkit-line-clamp: 3; }
  .post-meta { display: flex; gap: 10px; color: color-mix(in srgb, currentColor 48%, transparent); font-size: 0.66rem; letter-spacing: 0.08em; }
  .post-image { min-height: 150px; overflow: hidden; border: 1px solid color-mix(in srgb, currentColor 13%, transparent); }
  .post-image img { width: 100%; height: 100%; object-fit: cover; transition: transform 400ms cubic-bezier(.22,1,.36,1); }
  .post-row:hover .post-image img { transform: scale(1.025); }
  @media (max-width: 640px) {
    .post-row { grid-template-columns: 1fr; gap: 18px; }
    .post-image { grid-row: 1; aspect-ratio: 16 / 9; }
  }
</style>
