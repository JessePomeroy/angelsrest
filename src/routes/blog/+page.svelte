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
</script>

<!--
  SEO Component
  Sets the page title, meta description, and canonical URL.
  Important for search engines and social sharing.
-->
<SEO
  title="blog | angel's rest"
  description="Thoughts on photography, art, and creative process."
  url="https://angelsrest.online/blog"
/>

<section class="blog-index">
  <header class="section-heading">
    <h1>blog</h1>
    <span>{data.posts?.length ?? 0} entries</span>
  </header>

  {#if data.posts && data.posts.length > 0}
    <div class="post-list">
      {#each data.posts as post (post.slug)}
        <BlogCard {post} />
      {/each}
    </div>
  {:else}
    <p class="text-surface-400">no posts yet — check back soon!</p>
  {/if}
</section>

<style>
  .blog-index { width: min(100%, 980px); margin-inline: auto; }
  .section-heading { display: flex; min-height: 56px; align-items: flex-start; justify-content: space-between; border-bottom: 1px solid color-mix(in srgb, currentColor 15%, transparent); }
  .section-heading h1 { font-size: 1.35rem; font-weight: 500; }
  .section-heading span { padding-top: 5px; color: color-mix(in srgb, currentColor 55%, transparent); font-size: 0.68rem; letter-spacing: 0.12em; }
  .post-list { display: flex; flex-direction: column; }
</style>
