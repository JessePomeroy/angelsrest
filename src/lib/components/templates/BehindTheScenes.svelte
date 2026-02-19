<!--
  Behind the Scenes Template
  
  A narrative-focused, storytelling layout with full-width images
  and serif typography for a more personal, journal-like feel.
  
  Features:
  - Full-width featured image
  - Larger serif body text for readability
  - Signature footer with author name
  
  Used for: Stories about shoots, personal reflections, process breakdowns.
-->

<script lang="ts">
  import { PortableText } from "@portabletext/svelte";
  import PortableTextImage from "../PortableTextImage.svelte";
  import { urlFor } from "$lib/sanity/client";

  const components = {
    types: { image: PortableTextImage },
  };

  let { post } = $props();

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

<article class="max-w-3xl mx-auto">
  <!-- Header with narrative feel -->
  <header class="mb-12">
    <span class="text-xs tracking-widest text-surface-400 uppercase mb-4 block">
      Behind the Scenes
    </span>
    <h1 class="text-4xl md:text-5xl font-light tracking-wide mb-6">
      {post.title}
    </h1>
    {#if post.author || post.publishedAt}
      <div class="flex items-center gap-4 text-sm text-surface-400">
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

  <!-- Full-width featured image -->
  {#if post.mainImage}
    <div class="mb-12 -mx-4 md:-mx-12">
      <img
        src={urlFor(post.mainImage).width(1400).url()}
        alt={post.title}
        class="w-full h-auto"
      />
    </div>
  {/if}

  <!-- Body with narrative styling -->
  <div class="prose prose-lg prose-invert prose-surface max-w-none font-serif">
    {#if post.body}
      <PortableText value={post.body} {components} />
    {/if}
  </div>

  <!-- Signature footer -->
  <footer class="mt-12 pt-8 border-t border-surface-500/20 text-center">
    {#if post.author}
      <p class="text-surface-400 italic">
        — {post.author.name}
      </p>
    {/if}
  </footer>
</article>
