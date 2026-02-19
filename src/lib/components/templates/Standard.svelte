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

<article class="max-w-2xl mx-auto">
  <!-- Post Header -->
  <header class="mb-8">
    <!-- Categories -->
    {#if post.categories && post.categories.length > 0}
      <div class="flex gap-2 mb-4">
        {#each post.categories as category}
          <span class="text-xs text-surface-400 tracking-wider">
            {category.title}
          </span>
        {/each}
      </div>
    {/if}

    <h1 class="text-3xl md:text-4xl font-light tracking-wide mb-4">
      {post.title}
    </h1>

    <!-- Author and Date -->
    <div class="flex items-center gap-4 text-sm text-surface-400">
      {#if post.author}
        <div class="flex items-center gap-2">
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

  <!-- Featured Image -->
  {#if post.mainImage}
    <div class="mb-8 rounded-lg overflow-hidden">
      <img
        src={urlFor(post.mainImage).width(800).url()}
        alt={post.title}
        class="w-full h-auto"
      />
    </div>
  {/if}

  <!-- Body -->
  <div class="prose prose-invert prose-surface max-w-none">
    {#if post.body}
      <PortableText value={post.body} {components} />
    {/if}
  </div>

  <!-- Back link -->
  <div class="mt-12 pt-8 border-t border-surface-500/20">
    <a href="/blog" class="text-surface-400 hover:text-surface-200 transition-colors">
      ← back to blog
    </a>
  </div>
</article>
