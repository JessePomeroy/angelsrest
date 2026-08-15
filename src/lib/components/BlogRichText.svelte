<script lang="ts">
import type { BlogTextBlock, BlogTextSpan as BlogSpan } from "$lib/blog/content";
import BlogTextSpan from "$lib/components/BlogTextSpan.svelte";

let { blocks }: { blocks: BlogTextBlock[] } = $props();
</script>

{#snippet spans(values: BlogSpan[])}
  {#each values as span, index (index)}<BlogTextSpan {span} />{/each}
{/snippet}

{#each blocks as block, index (index)}
  {#if block.type === 'paragraph'}
    <p>{@render spans(block.spans)}</p>
  {:else if block.type === 'heading' && block.level === 2}
    <h2>{@render spans(block.spans)}</h2>
  {:else if block.type === 'heading' && block.level === 3}
    <h3>{@render spans(block.spans)}</h3>
  {:else if block.type === 'heading' && block.level === 4}
    <h4>{@render spans(block.spans)}</h4>
  {:else if block.type === 'quote'}
    <blockquote>{@render spans(block.spans)}</blockquote>
  {:else if block.type === 'list' && block.style === 'bullet'}
    <ul>
      {#each block.items as item, itemIndex (itemIndex)}
        <li>{@render spans(item.spans)}</li>
      {/each}
    </ul>
  {:else if block.type === 'list'}
    <ol>
      {#each block.items as item, itemIndex (itemIndex)}
        <li>{@render spans(item.spans)}</li>
      {/each}
    </ol>
  {:else if block.type === 'image'}
    <figure class="my-8">
      <img
        src={block.image.src}
        alt={block.image.alt}
        width={block.image.width}
        height={block.image.height}
        class="w-full h-auto rounded-lg"
        loading="lazy"
      />
      {#if block.image.caption}
        <figcaption class="text-center text-sm text-surface-400 mt-2">
          {block.image.caption}
        </figcaption>
      {/if}
    </figure>
  {/if}
{/each}
