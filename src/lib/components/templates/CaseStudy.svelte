<!--
  Case Study Template
  
  A structured layout for project case studies with dedicated sections
  for The Brief, The Approach, and The Result.
  
  Schema fields used:
  - brief: What the client needed or project goals
  - approach: Creative direction, gear choices, film stocks
  - result: Final delivery or personal reflection
  
  Used for: Portfolio pieces, client projects, personal experiments.
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
        src={urlFor(post.mainImage).width(1200).url()}
        alt={post.title}
        class="w-full h-auto"
      />
    </div>
  {/if}

  <!-- Brief / Approach / Result Grid -->
  <div class="grid gap-8 mb-12">
    {#if post.brief}
      <section class="bg-surface-800/50 p-6 rounded-lg">
        <h3 class="text-sm tracking-widest text-surface-400 uppercase mb-2">
          The Brief
        </h3>
        <p class="text-lg">{post.brief}</p>
      </section>
    {/if}

    {#if post.approach}
      <section class="bg-surface-800/50 p-6 rounded-lg">
        <h3 class="text-sm tracking-widest text-surface-400 uppercase mb-2">
          The Approach
        </h3>
        <p class="text-lg">{post.approach}</p>
      </section>
    {/if}

    {#if post.result}
      <section class="bg-surface-800/50 p-6 rounded-lg">
        <h3 class="text-sm tracking-widest text-surface-400 uppercase mb-2">
          The Result
        </h3>
        <p class="text-lg">{post.result}</p>
      </section>
    {/if}
  </div>

  <!-- Body Content -->
  {#if post.body}
    <div class="prose prose-invert prose-surface max-w-none">
      <PortableText value={post.body} {components} />
    </div>
  {/if}
</article>
