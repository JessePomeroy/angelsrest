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
  <!-- Technical Header -->
  <header class="mb-12">
    <span class="text-xs tracking-widest text-surface-400 uppercase mb-4 block">
      Technical Write-up
    </span>
    <h1 class="text-3xl md:text-4xl font-light tracking-wide mb-4">
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

  <!-- Gear Grid -->
  {#if post.gearUsed && post.gearUsed.length > 0}
    <section class="mb-12">
      <h3 class="text-sm tracking-widest text-surface-400 uppercase mb-4">
        Gear Used
      </h3>
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
        {#each post.gearUsed as gear}
          <div class="bg-surface-800/50 p-4 rounded-lg text-center">
            {#if gear.camera}
              <p class="text-sm text-surface-300">{gear.camera}</p>
            {/if}
            {#if gear.lens}
              <p class="text-sm text-surface-400">{gear.lens}</p>
            {/if}
            {#if gear.filmStock}
              <p class="font-mono text-sm text-accent-400">{gear.filmStock}</p>
            {/if}
            {#if gear.developer}
              <p class="text-xs text-surface-500">{gear.developer}</p>
            {/if}
          </div>
        {/each}
      </div>
    </section>
  {/if}

  <!-- Featured Image -->
  {#if post.mainImage}
    <div class="mb-8 rounded-lg overflow-hidden">
      <img
        src={urlFor(post.mainImage).width(1000).url()}
        alt={post.title}
        class="w-full h-auto"
      />
    </div>
  {/if}

  <!-- Technical content -->
  <div class="prose prose-invert prose-surface max-w-none font-mono text-sm">
    {#if post.body}
      <PortableText value={post.body} {components} />
    {/if}
  </div>

  <!-- Technical footer -->
  <footer class="mt-12 pt-8 border-t border-surface-500/20">
    <div class="flex items-center gap-2 text-xs text-surface-500">
      <span>Technical Notes</span>
      <span>•</span>
      <span>{post.gearUsed?.length || 0} items listed</span>
    </div>
  </footer>
</article>
