<script lang="ts">
  /**
   * SEO Component
   * Reusable head tags for consistent SEO across all pages.
   * Include in each page's <svelte:head> or use directly.
   */

  let {
    title = "angel's rest",
    description = "Photography portfolio and print shop by Jesse Pomeroy. Fine art photography, prints, zines, and commissions.",
    image = "/og-image.jpg",
    url = "https://angelsrest.online",
    type = "website"
  }: {
    title?: string;
    description?: string;
    image?: string;
    url?: string;
    type?: string;
  } = $props();

  // Ensure full URL for image (use $derived to track prop changes)
  let fullImageUrl = $derived(image.startsWith('http') ? image : `https://angelsrest.online${image}`);
</script>

<svelte:head>
  <!-- Primary Meta Tags -->
  <title>{title}</title>
  <meta name="title" content={title} />
  <meta name="description" content={description} />
  <link rel="canonical" href={url} />

  <!-- Open Graph / Facebook / Discord / etc -->
  <meta property="og:type" content={type} />
  <meta property="og:url" content={url} />
  <meta property="og:title" content={title} />
  <meta property="og:description" content={description} />
  <meta property="og:image" content={fullImageUrl} />
  <meta property="og:site_name" content="angel's rest" />

  <!-- Additional SEO -->
  <meta name="robots" content="index, follow" />
  <meta name="author" content="Jesse Pomeroy" />
</svelte:head>
