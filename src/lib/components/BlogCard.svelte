<!--
  BlogCard Component
  
  A reusable component that displays a single blog post preview.
  Used on the /blog listing page.
  
  Components in $lib/components/ can be imported anywhere in the app.
-->

<script lang="ts">
  // Import the urlFor helper to generate Sanity image URLs
  import { urlFor } from "$lib/sanity/client";

  /**
   * TypeScript Interface
   * 
   * Defines the shape of the `post` prop we expect.
   * This helps catch errors and enables autocomplete in your editor.
   * 
   * The ? means the field is optional (might not exist).
   */
  interface Post {
    _id: string;
    title: string;
    slug: { current: string };  // Sanity slugs are objects with a .current property
    publishedAt: string;
    mainImage?: any;            // Sanity image object (complex, so we use 'any')
    excerpt?: string;
    author?: {
      name: string;
      image?: any;
    };
    categories?: { title: string }[];
  }

  /**
   * Props declaration using Svelte 5 syntax.
   * 
   * This component expects a single prop called `post`
   * that matches the Post interface above.
   */
  let { post }: { post: Post } = $props();

  /**
   * Helper function to format dates nicely.
   * Converts "2024-01-15" to "January 15, 2024"
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
  The entire card is wrapped in an <a> tag (link).
  Clicking anywhere on the card navigates to the full post.
  
  Classes explained:
  - group: Allows child elements to react to parent hover (group-hover:)
  - block: Makes the <a> behave like a block element (full width)
  - bg-surface-500/10: Background color at 10% opacity
  - border: Border styling
  - rounded-lg: Rounded corners
  - overflow-hidden: Clips content that exceeds bounds (for image zoom effect)
  - hover:border-surface-400/40: Border lightens on hover
  - transition-all: Smooth transitions for all animatable properties
-->
<a
  href="/blog/{post.slug.current}"
  class="group block bg-surface-500/10 border border-surface-500/20 rounded-lg overflow-hidden hover:border-surface-400/40 transition-all"
>
  <!--
    Featured Image (conditional)
    Only renders if post.mainImage exists.
  -->
  {#if post.mainImage}
    <div class="aspect-[16/9] overflow-hidden">
      <!--
        urlFor() is a Sanity helper that builds image URLs.
        .width(600).height(340) - requests a resized image (faster loading)
        .url() - returns the final URL string
        
        group-hover:scale-105 - image zooms slightly when PARENT is hovered
        transition-transform duration-300 - smooth 300ms animation
      -->
      <img
        src={urlFor(post.mainImage).width(600).height(340).url()}
        alt={post.title}
        class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
      />
    </div>
  {/if}

  <!-- Text content area -->
  <div class="p-5">
    <!--
      Categories (conditional)
      Only renders if categories exist and array has items.
    -->
    {#if post.categories && post.categories.length > 0}
      <div class="flex gap-2 mb-2">
        {#each post.categories as category}
          <span class="text-xs text-surface-500 tracking-wider">
            {category.title}
          </span>
        {/each}
      </div>
    {/if}

    <!-- Post title -->
    <h2 class="text-lg font-medium mb-2 group-hover:text-surface-200 transition-colors">
      {post.title}
    </h2>

    <!--
      Excerpt (post preview text)
      line-clamp-2: Truncates text to 2 lines with ellipsis (...)
    -->
    {#if post.excerpt}
      <p class="text-surface-400 text-sm mb-4 line-clamp-2">
        {post.excerpt}
      </p>
    {/if}

    <!-- Author and date metadata -->
    <div class="flex items-center gap-3 text-xs text-surface-500">
      {#if post.author}
        <span>{post.author.name}</span>
        <span>•</span>
      {/if}
      <span>{formatDate(post.publishedAt)}</span>
    </div>
  </div>
</a>
