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

<article class="max-w-4xl mx-auto">
  <!-- Hero Header -->
  <header class="mb-12 text-center">
    <span class="text-xs tracking-widest text-surface-400 uppercase mb-4 block">
      Client Story
    </span>
    <h1 class="text-4xl md:text-6xl font-light tracking-wide mb-8">
      {post.title}
    </h1>
    {#if post.author || post.publishedAt}
      <div class="flex items-center justify-center gap-4 text-sm text-surface-400">
        {#if post.author}
          <span>Photos by {post.author.name}</span>
          {#if post.publishedAt}<span>•</span>{/if}
        {/if}
        {#if post.publishedAt}
          <span>{formatDate(post.publishedAt)}</span>
        {/if}
      </div>
    {/if}
  </header>

  <!-- Full-bleed Featured Image -->
  {#if post.mainImage}
    <div class="mb-12 -mx-4 md:-mx-20 rounded-lg overflow-hidden">
      <img
        src={urlFor(post.mainImage).width(1600).url()}
        alt={post.title}
        class="w-full h-auto"
      />
    </div>
  {/if}

  <!-- Brief / Approach / Result -->
  <div class="grid gap-6 mb-12 max-w-2xl mx-auto">
    {#if post.brief}
      <section class="text-center">
        <h3 class="text-xs tracking-widest text-surface-400 uppercase mb-2">
          The Brief
        </h3>
        <p class="text-xl italic">{post.brief}</p>
      </section>
    {/if}

    {#if post.approach}
      <section class="bg-surface-800/30 p-6 rounded-lg">
        <h3 class="text-xs tracking-widest text-surface-400 uppercase mb-2 text-center">
          Our Approach
        </h3>
        <p class="text-lg">{post.approach}</p>
      </section>
    {/if}

    {#if post.result}
      <section class="text-center">
        <h3 class="text-xs tracking-widest text-surface-400 uppercase mb-2">
          The Result
        </h3>
        <p class="text-xl italic">{post.result}</p>
      </section>
    {/if}
  </div>

  <!-- Gallery Body -->
  {#if post.body}
    <div class="prose prose-invert prose-surface max-w-none">
      <PortableText value={post.body} {components} />
    </div>
  {/if}

  <!-- Story footer -->
  <footer class="mt-16 pt-8 border-t border-surface-500/20 text-center">
    <p class="text-surface-400 italic">
      Thank you for sharing your day with us 💕
    </p>
    {#if post.author}
      <p class="text-surface-500 mt-2">
        — {post.author.name}
      </p>
    {/if}
  </footer>
</article>
