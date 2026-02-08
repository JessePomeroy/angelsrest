<!--
  Single Blog Post Page
  
  Displays a full blog post with:
  - Title and metadata (author, date, categories)
  - Featured image
  - Body content (rendered from Portable Text)
  
  This page is rendered for URLs like /blog/my-post-slug
  The slug comes from the folder name [slug]
-->

<script lang="ts">
  // SEO component for meta tags
  import SEO from "$lib/components/SEO.svelte";
  
  /**
   * PortableText is Sanity's rich text format.
   * It stores content as structured data (not HTML),
   * which is more flexible and secure.
   * 
   * The @portabletext/svelte package renders it to HTML.
   */
  import { PortableText } from "@portabletext/svelte";
  
  // Custom component for rendering images in the post body
  import PortableTextImage from "$lib/components/PortableTextImage.svelte";
  
  // Helper to build Sanity image URLs
  import { urlFor } from "$lib/sanity/client";
  
  /**
   * Custom components for PortableText
   * Maps block types to Svelte components
   */
  const components = {
    types: {
      image: PortableTextImage,
    },
  };

  // Get data from +page.server.ts
  let { data } = $props();
  
  /**
   * Destructure the post for easier access.
   * Instead of writing data.post.title everywhere,
   * we can just write post.title
   */
  const post = data.post;

  /**
   * Date formatting helper
   * Same as in BlogCard - could be moved to a shared utils file
   */
  function formatDate(dateStr: string) {
    if (!dateStr) return "";
    const date = new Date(dateStr);
    return date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  }
</script>

<!--
  Dynamic SEO
  The title includes the post title for better search results.
  Each post gets its own unique meta tags.
-->
<SEO
  title="{post.title} | angel's rest"
  description={post.excerpt || `Read ${post.title} on Angel's Rest blog.`}
  url="https://angelsrest.online/blog/{post.slug.current}"
/>

<!--
  <article> is semantic HTML for self-contained content.
  Screen readers and search engines understand it's a blog post.
  
  max-w-2xl mx-auto: Centers content with a readable line width
-->
<article class="max-w-2xl mx-auto">
  
  <!-- Post Header -->
  <header class="mb-8">
    
    <!-- Categories (if any) -->
    {#if post.categories && post.categories.length > 0}
      <div class="flex gap-2 mb-4">
        {#each post.categories as category}
          <span class="text-xs text-surface-400 uppercase tracking-wider">
            {category.title}
          </span>
        {/each}
      </div>
    {/if}

    <!-- Post Title -->
    <h1 class="text-3xl md:text-4xl font-light tracking-wide mb-4">
      {post.title}
    </h1>

    <!-- Author and Date -->
    <div class="flex items-center gap-4 text-sm text-surface-400">
      {#if post.author}
        <div class="flex items-center gap-2">
          <!--
            Author avatar (if they have one)
            .width(32).height(32) - small square image for the avatar
          -->
          {#if post.author.image}
            <img
              src={urlFor(post.author.image).width(32).height(32).url()}
              alt={post.author.name}
              class="w-8 h-8 rounded-full object-cover"
            />
          {/if}
          <span>{post.author.name}</span>
        </div>
        <span>•</span>
      {/if}
      <span>{formatDate(post.publishedAt)}</span>
    </div>
  </header>

  <!-- Featured Image (if post has one) -->
  {#if post.mainImage}
    <div class="mb-8 rounded-lg overflow-hidden">
      <img
        src={urlFor(post.mainImage).width(800).url()}
        alt={post.title}
        class="w-full h-auto"
      />
    </div>
  {/if}

  <!--
    Post Body Content
    
    prose: Tailwind Typography plugin classes for nice text styling
    prose-invert: Dark mode version (light text on dark background)
    max-w-none: Override prose's default max-width
    
    PortableText renders Sanity's block content to HTML.
    The `value` prop receives the body array from Sanity.
  -->
  <!--
    Pass our custom components to PortableText.
    This tells it to use PortableTextImage for image blocks.
  -->
  <div class="prose prose-invert prose-surface max-w-none">
    {#if post.body}
      <PortableText value={post.body} {components} />
    {/if}
  </div>

  <!-- Back to blog link -->
  <div class="mt-12 pt-8 border-t border-surface-500/20">
    <a
      href="/blog"
      class="text-surface-400 hover:text-surface-200 transition-colors"
    >
      ← back to blog
    </a>
  </div>
</article>
