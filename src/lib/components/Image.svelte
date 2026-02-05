<script lang="ts">
  import { createImageUrlBuilder } from "@sanity/image-url";

  export let src: any;
  export let alt: string = "";
  export let width: number = 800;

  // Create builder once
  const builder = createImageUrlBuilder({
    projectId: import.meta.env.VITE_SANITY_PROJECT_ID,
    dataset: "production",
  });
</script>

{#if src?.asset?._ref}
  <img
    src={builder.image(src).width(width).auto("format").quality(75).url()!}
    alt={alt || src.alt || ""}
    class="w-full h-auto object-cover rounded-xl"
    loading="lazy"
    decoding="async"
  />
{:else}
  <!-- Fallback for direct asset refs -->
  <img
    src={src?.asset?.url || src}
    {alt}
    class="w-full h-auto object-cover rounded-xl"
    loading="lazy"
  />
{/if}

<!-- {#if src}
  <figure class="img-variant">
    <img
      src={src.asset.url}
      {alt}
      width={src.asset.metadata.dimensions.width}
      height={src.asset.metadata.dimensions.height}
      {sizes}
      class="object-cover w-full h-auto rounded-xl"
      loading="lazy"
      decoding="async"
    />
  </figure>
{/if} -->
