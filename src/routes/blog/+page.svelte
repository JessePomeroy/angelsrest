<!--
  Blog Listing Page
  
  This is a Svelte component that displays a list of blog posts.
  It receives data from +page.server.ts via the `data` prop.
  
  File naming: +page.svelte = this is the UI for this route (/blog)
-->

<script lang="ts">
// SEO component for meta tags (title, description, etc.)

// Our custom BlogCard component for displaying post previews
import BlogCard from "$lib/components/BlogCard.svelte";
import SEO from "$lib/components/SEO.svelte";

/**
 * $props() is Svelte 5's way to receive props.
 *
 * In SvelteKit, pages automatically receive a `data` prop
 * containing whatever the +page.server.ts load function returned.
 *
 * So: data.posts = the posts array from our server load function
 */
let { data } = $props();
const pageUrl = (pageNumber: number) => pageNumber === 1 ? "/blog" : `/blog?page=${pageNumber}`;
</script>

<!--
  SEO Component
  Sets the page title, meta description, and canonical URL.
  Important for search engines and social sharing.
-->
<SEO
  title={data.pageNumber > 1 ? `blog — page ${data.pageNumber} | angel's rest` : "blog | angel's rest"}
  description="Thoughts on photography, art, and creative process."
  url={`https://angelsrest.online${pageUrl(data.pageNumber)}`}
/>

<section class="blog-index">
  <header class="section-heading">
    <h1>blog</h1>
    <span>{data.totalCount} {data.totalCount === 1 ? "entry" : "entries"}</span>
  </header>

  {#if data.posts && data.posts.length > 0}
    <div class="post-list">
      {#each data.posts as post, index (post.slug)}
        <BlogCard {post} loading={index === 0 ? "eager" : "lazy"} />
      {/each}
    </div>
  {:else}
    <p class="empty-message">no posts yet — check back soon!</p>
  {/if}
  {#if data.pageNumber > 1 || data.hasNext}
    <nav class="pagination" aria-label="Blog pages">
      <div>{#if data.pageNumber > 1}<a href={pageUrl(data.pageNumber - 1)} rel="prev">newer posts</a>{/if}</div>
      <span>page {data.pageNumber}</span>
      <div>{#if data.hasNext}<a href={pageUrl(data.pageNumber + 1)} rel="next">older posts</a>{/if}</div>
    </nav>
  {/if}
</section>

<style>
  .empty-message { color: var(--color-surface-400); }
  .blog-index { width: min(100%, 980px); margin-inline: auto; }
  .section-heading { display: flex; min-height: 56px; align-items: flex-start; justify-content: space-between; border-bottom: 1px solid color-mix(in srgb, currentColor 15%, transparent); }
  .section-heading h1 { font-size: 1.35rem; font-weight: 500; }
  .section-heading span { padding-top: 5px; color: color-mix(in srgb, currentColor 55%, transparent); font-size: 0.68rem; letter-spacing: 0.12em; }
  .post-list { display: flex; flex-direction: column; }
  .pagination { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 16px; margin-top: 24px; font-size: 0.85rem; }
  .pagination > :last-child { text-align: right; }
  .pagination a { display: inline-flex; align-items: center; min-height: 44px; color: inherit; text-underline-offset: 4px; }
  .pagination a:focus-visible { outline: 2px solid var(--time-accent); outline-offset: 4px; }
</style>
