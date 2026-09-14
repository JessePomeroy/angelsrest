<script lang="ts">
import type { BlogTextSpan } from "$lib/blog/content";

let { span }: { span: BlogTextSpan } = $props();

const strong = $derived(span.marks.some((mark) => mark.type === "strong"));
const emphasis = $derived(span.marks.some((mark) => mark.type === "emphasis"));
const href = $derived(span.marks.find((mark) => mark.type === "link")?.href ?? null);
</script>

{#snippet plainText()}
  {#each span.text.split('\n') as line, index (index)}
    {#if index > 0}<br />{/if}{line}
  {/each}
{/snippet}

{#snippet emphasizedText()}
  {#if emphasis}<em>{@render plainText()}</em>{:else}{@render plainText()}{/if}
{/snippet}

{#snippet styledText()}
  {#if strong}<strong>{@render emphasizedText()}</strong>{:else}{@render emphasizedText()}{/if}
{/snippet}

{#if href}
  <a {href}>{@render styledText()}</a>
{:else}
  {@render styledText()}
{/if}
