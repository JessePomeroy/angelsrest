<script lang="ts">
import type {
  BlogList,
  BlogListItem,
  BlogTextBlock,
  BlogTextSpan as BlogSpan,
} from "$lib/blog/content";
import BlogTextSpan from "$lib/components/BlogTextSpan.svelte";

let { blocks }: { blocks: BlogTextBlock[] } = $props();
</script>

{#snippet spans(values: BlogSpan[])}
  {#each values as span, index (index)}<BlogTextSpan {span} />{/each}
{/snippet}

{#snippet listItem(item: BlogListItem)}
  {#if item.blockStyle === 'normal'}
    {@render spans(item.spans)}
  {:else}
    <svelte:element this={item.blockStyle}>{@render spans(item.spans)}</svelte:element>
  {/if}
  {#each item.children as child, childIndex (childIndex)}
    {@render list(child)}
  {/each}
{/snippet}

{#snippet list(value: BlogList)}
  {#if value.style === 'bullet'}
    <ul>
      {#each value.items as item, itemIndex (itemIndex)}
        <li>{@render listItem(item)}</li>
      {/each}
    </ul>
  {:else}
    <ol>
      {#each value.items as item, itemIndex (itemIndex)}
        <li>{@render listItem(item)}</li>
      {/each}
    </ol>
  {/if}
{/snippet}

{#each blocks as block, index (index)}
  {#if block.type === 'paragraph'}
    <p>{@render spans(block.spans)}</p>
  {:else if block.type === 'heading' && block.level === 1}
    <h1>{@render spans(block.spans)}</h1>
  {:else if block.type === 'heading' && block.level === 2}
    <h2>{@render spans(block.spans)}</h2>
  {:else if block.type === 'heading' && block.level === 3}
    <h3>{@render spans(block.spans)}</h3>
  {:else if block.type === 'heading' && block.level === 4}
    <h4>{@render spans(block.spans)}</h4>
  {:else if block.type === 'quote'}
    <blockquote>{@render spans(block.spans)}</blockquote>
  {:else if block.type === 'list'}
    {@render list(block)}
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
