<!--
  Single Blog Post Page
  
  This page renders blog posts using a flexible template system based on postType.
  Each post type has a dedicated template component with unique visual layouts.
  
  === Available Post Types ===
  - standard: Simple blog layout (featured image → body → back link)
  - caseStudy: Structured layout with Brief → Approach → Result sections
  - behindTheScenes: Narrative-focused with full-width images, serif font
  - technical: Technical write-ups with gear grid and mono font
  - clientStory: Wedding/client stories with hero header, testimonial-style quotes
  
  === How to Add a New Template ===
  1. Create a new component in src/lib/components/templates/ (e.g., Tutorial.svelte)
  2. Import it in this file and add it to the templates object
  3. Add the new postType to Sanity schema (angelsrest-studio/schemaTypes/post.ts)
  4. Add a case to the {#if} block below to render the new template
  
  This page is rendered for URLs like /blog/my-post-slug
-->

<script lang="ts">
  import SEO from "$lib/components/SEO.svelte";
  
  // Template components - each handles a different post type layout
  import Standard from "$lib/components/templates/Standard.svelte";
  import CaseStudy from "$lib/components/templates/CaseStudy.svelte";
  import BehindTheScenes from "$lib/components/templates/BehindTheScenes.svelte";
  import Technical from "$lib/components/templates/Technical.svelte";
  import ClientStory from "$lib/components/templates/ClientStory.svelte";

  // Get data from +page.server.ts (contains post data including postType)
  let { data } = $props();
  const post = $derived(data.post);

  // Determine which template to use based on postType field from Sanity
  // Falls back to 'standard' if postType is missing
  const templateType = $derived(post.postType || 'standard');

  // Template mapping - maps postType values to their corresponding components
  // Add new templates here when creating new post types
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
