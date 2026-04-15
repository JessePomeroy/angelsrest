<!--
  === Available Post Types ===
  standard, caseStudy, behindTheScenes, technical, clientStory

  === How to Add a New Template ===
  1. Create a new component in src/lib/components/templates/
  2. Import it here and add it to the templates object
  3. Add the new postType to Sanity schema (angelsrest-studio/schemaTypes/post.ts)
  4. Add a case to the {#if} block below
-->

<script lang="ts">
import SEO from "$lib/components/SEO.svelte";
import BehindTheScenes from "$lib/components/templates/BehindTheScenes.svelte";
import CaseStudy from "$lib/components/templates/CaseStudy.svelte";
import ClientStory from "$lib/components/templates/ClientStory.svelte";
import Standard from "$lib/components/templates/Standard.svelte";
import Technical from "$lib/components/templates/Technical.svelte";

let { data } = $props();
const post = $derived(data.post);

const templateType = $derived(post.postType || "standard");

const templates = {
	standard: Standard,
	caseStudy: CaseStudy,
	behindTheScenes: BehindTheScenes,
	technical: Technical,
	clientStory: ClientStory,
};
</script>

<SEO
  title={`${post.title} | angel's rest`}
  description={post.excerpt || `Read ${post.title} on Angel's Rest blog.`}
  url={`https://angelsrest.online/blog/${post.slug.current}`}
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
  <!-- Fallback: standard template for unknown post types -->
  <Standard {post} />
{/if}
