<!--
  Standard Blog Post Template
  
  A clean, simple layout for regular blog posts.
  Features: featured image → body content → back link.
  
  Used for: General blog posts without special formatting needs.
-->

<script lang="ts">
import type { BlogPostDetail } from "$lib/blog/content";
import BlogRichText from "$lib/components/BlogRichText.svelte";
import { formatDate } from "$lib/utils/format";

let { post }: { post: BlogPostDetail } = $props();
</script>

<article class="max-w-2xl mx-auto">
  <!-- Post Header -->
  <header class="mb-8">
    <!-- Categories -->
    {#if post.categories && post.categories.length > 0}
      <div class="flex gap-2 mb-4">
        {#each post.categories as category (category.title)}
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
              src={post.author.image.src}
              alt={post.author.image.alt}
              width={post.author.image.width}
              height={post.author.image.height}
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
        src={post.mainImage.src}
        alt={post.mainImage.alt}
        width={post.mainImage.width}
        height={post.mainImage.height}
        class="w-full h-auto"
      />
    </div>
  {/if}

  <!-- Body -->
  <div class="prose dark:prose-invert max-w-none">
    {#if post.body.length > 0}
      <BlogRichText blocks={post.body} />
    {/if}
  </div>

  <!-- Back link -->
  <div class="mt-12 pt-8 border-t border-surface-500/20">
    <a href="/blog" class="text-surface-400 hover:text-surface-200 transition-colors">
      ← back to blog
    </a>
  </div>
</article>
