<!--
  PortableText Image Component
  
  Custom component for rendering images within Sanity's PortableText.
  This gets used when the rich text editor contains an image block.
-->

<script lang="ts">
  import { urlFor } from "$lib/sanity/client";

  /**
   * PortableText passes the block value as `portableText.value`
   * which contains the Sanity image object.
   */
  let { portableText } = $props();
  
  // The image data from Sanity
  const value = portableText?.value;
</script>

{#if value?.asset}
  <figure class="my-8">
    <img
      src={urlFor(value).width(800).url()}
      alt={value.alt || ''}
      class="w-full h-auto rounded-lg"
      loading="lazy"
    />
    {#if value.caption}
      <figcaption class="text-center text-sm text-surface-400 mt-2">
        {value.caption}
      </figcaption>
    {/if}
  </figure>
{/if}
