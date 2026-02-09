<!--
  Blog Listing Page
  
  This is a Svelte component that displays a list of blog posts.
  It receives data from +page.server.ts via the `data` prop.
  
  File naming: +page.svelte = this is the UI for this route (/blog)
-->

<script lang="ts">
  // SEO component for meta tags (title, description, etc.)
  import SEO from "$lib/components/SEO.svelte";
  
  // Our custom BlogCard component for displaying post previews
  import BlogCard from "$lib/components/BlogCard.svelte";

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

<div class="max-w-2xl mx-auto">
  <h1 class="text-2xl font-light tracking-wider lowercase mb-8">blog</h1>

  {#if data.posts && data.posts.length > 0}
    <div class="flex flex-col gap-8">
      {#each data.posts as post}
        <BlogCard {post} />
      {/each}
    </div>
  {:else}
    <p class="text-surface-400">no posts yet — check back soon!</p>
  {/if}
</div>
