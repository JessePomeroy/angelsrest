<script lang="ts">
import SEO from "$lib/components/SEO.svelte";
import BehindTheScenes from "$lib/components/templates/BehindTheScenes.svelte";
import CaseStudy from "$lib/components/templates/CaseStudy.svelte";
import ClientStory from "$lib/components/templates/ClientStory.svelte";
import Standard from "$lib/components/templates/Standard.svelte";
import Technical from "$lib/components/templates/Technical.svelte";

let { data } = $props();
const post = $derived(data.post);

const templateType = $derived(post.presentation);
</script>

<SEO
  title={`${post.seoTitle || post.title} | angel's rest`}
  description={post.seoDescription || `Read ${post.title} on Angel's Rest blog.`}
  url={`${post.siteUrl}/blog/${post.slug}`}
/>

{#if templateType === 'standard'}
  <Standard {post} />
{:else if templateType === 'caseStudy'}
  <CaseStudy {post} />
{:else if templateType === 'behindTheScenes'}
  <BehindTheScenes {post} />
{:else if templateType === 'technical'}
  <Technical {post} />
{:else if templateType === 'clientStory'}
  <ClientStory {post} />
{:else}
  <!-- The server validates presentations; this is a defensive rendering fallback. -->
  <Standard {post} />
{/if}
