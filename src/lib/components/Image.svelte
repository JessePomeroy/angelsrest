<!--
  Sanity Image Component
  
  Renders images from Sanity CMS with automatic optimization.
  Uses the shared urlFor helper from sanity/client.
-->

<script lang="ts">
  import { urlFor } from "$lib/sanity/client";

  export let src: any;
  export let alt: string = "";
  export let width: number = 800;
</script>

{#if src?.asset?._ref}
  <!-- Sanity image reference -->
  <img
    src={urlFor(src).width(width).auto("format").quality(75).url()!}
    alt={alt || src.alt || ""}
    class="w-full h-auto object-cover rounded-xl"
    loading="lazy"
    decoding="async"
  />
{:else}
  <!-- Fallback for direct URLs -->
  <img
    src={src?.asset?.url || src}
    {alt}
    class="w-full h-auto object-cover rounded-xl"
    loading="lazy"
  />
{/if}
