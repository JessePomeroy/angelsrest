<!--
  Case Study Template
  
  A structured layout for project case studies with dedicated sections
  for The Brief, The Approach, and The Result.
  
  Provider-neutral fields used:
  - brief: What the client needed or project goals
  - approach: Creative direction, gear choices, film stocks
  - outcome: Final delivery or personal reflection
  
  Used for: Portfolio pieces, client projects, personal experiments.
-->

<script lang="ts">
import type { BlogPostDetail } from "$lib/blog/content";
import BlogRichText from "$lib/components/BlogRichText.svelte";
import { formatDate } from "$lib/utils/format";

let { post }: { post: BlogPostDetail } = $props();
</script>

<article class="max-w-3xl mx-auto">
  <!-- Header -->
  <header class="mb-12 text-center">
    <span class="text-xs tracking-widest text-surface-400 uppercase mb-4 block">
      Case Study
    </span>
    <h1 class="text-4xl md:text-5xl font-light tracking-wide mb-6">
      {post.title}
    </h1>
    {#if post.author || post.publishedAt}
      <div class="flex items-center justify-center gap-4 text-sm text-surface-400">
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

  <!-- Featured Image -->
  {#if post.mainImage}
    <div class="mb-12 rounded-lg overflow-hidden">
      <img
        src={post.mainImage.src}
        alt={post.mainImage.alt}
        width={post.mainImage.width}
        height={post.mainImage.height}
        class="w-full h-auto"
      />
    </div>
  {/if}

  <!-- Brief / Approach / Result Grid -->
  <div class="grid gap-8 mb-12">
    {#if post.brief}
      <section class="bg-surface-800/50 p-6 rounded-lg">
        <h2 class="text-sm tracking-widest text-surface-400 uppercase mb-2">
          The Brief
        </h2>
        <p class="text-lg">{post.brief}</p>
      </section>
    {/if}

    {#if post.approach}
      <section class="bg-surface-800/50 p-6 rounded-lg">
        <h2 class="text-sm tracking-widest text-surface-400 uppercase mb-2">
          The Approach
        </h2>
        <p class="text-lg">{post.approach}</p>
      </section>
    {/if}

    {#if post.outcome}
      <section class="bg-surface-800/50 p-6 rounded-lg">
        <h2 class="text-sm tracking-widest text-surface-400 uppercase mb-2">
          The Result
        </h2>
        <p class="text-lg">{post.outcome}</p>
      </section>
    {/if}
  </div>

  <!-- Body Content -->
  {#if post.body.length > 0}
    <div class="prose dark:prose-invert max-w-none">
      <BlogRichText blocks={post.body} />
    </div>
  {/if}
</article>
