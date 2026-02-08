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

<section>
  <!-- Page heading -->
  <h1 class="text-2xl font-light tracking-wider lowercase mb-8">blog</h1>

  <!--
    Conditional rendering with {#if}
    
    Check if we have posts before trying to loop through them.
    This prevents errors if posts is undefined or empty.
  -->
  {#if data.posts && data.posts.length > 0}
    <!--
      CSS Grid layout:
      - grid-cols-1: 1 column on mobile
      - md:grid-cols-2: 2 columns on medium screens and up
      - gap-8: spacing between cards
    -->
    <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
      <!--
        {#each} loop - iterates over the posts array.
        For each post, render a BlogCard component.
        
        Passing {post} is shorthand for post={post}
        (when prop name matches variable name)
      -->
      {#each data.posts as post}
        <BlogCard {post} />
      {/each}
    </div>
  {:else}
    <!-- Shown when there are no posts yet -->
    <p class="text-surface-400">no posts yet — check back soon!</p>
  {/if}
</section>
