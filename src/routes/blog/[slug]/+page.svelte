<!--
  Single Blog Post Page
  
  Displays a full blog post with template-based rendering based on postType:
  - caseStudy: Brief → Approach → Result structure
  - behindTheScenes: Narrative, full-width images, serif font
  - technical: Gear grid, mono font, technical details
  - clientStory: Hero header, testimonial-style sections
  
  This page is rendered for URLs like /blog/my-post-slug
-->

<script lang="ts">
  import SEO from "$lib/components/SEO.svelte";
  import Standard from "$lib/components/templates/Standard.svelte";
  import CaseStudy from "$lib/components/templates/CaseStudy.svelte";
  import BehindTheScenes from "$lib/components/templates/BehindTheScenes.svelte";
  import Technical from "$lib/components/templates/Technical.svelte";
  import ClientStory from "$lib/components/templates/ClientStory.svelte";

  // Get data from +page.server.ts
  let { data } = $props();
  const post = $derived(data.post);

  // Default to caseStudy if postType is missing
  const templateType = $derived(post.postType || 'caseStudy');

  // Template component mapping
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

<!-- Render the appropriate template based on postType -->
{#if templateType === 'caseStudy'}
  <CaseStudy {post} />
{:else if templateType === 'behindTheScenes'}
  <BehindTheScenes {post} />
{:else if templateType === 'technical'}
  <Technical {post} />
{:else if templateType === 'clientStory'}
  <ClientStory {post} />
{:else}
  <!-- Fallback: render as caseStudy -->
  <CaseStudy {post} />
{/if}
