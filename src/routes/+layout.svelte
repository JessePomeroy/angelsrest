<!--
  Root Layout
  
  Main layout wrapper for all pages. Handles:
  - Desktop nav (hidden on mobile)
  - Mobile header gif (hidden on desktop, not shown on homepage)
  - Mobile theme switcher (only on homepage)
  - Mobile bottom nav with spacer
  - Footer (desktop only)
-->

<svelte:head>
  <meta property="og:title" content={ogTitle} />
  <meta property="og:description" content={ogDesc} />
  <meta property="og:image" content={ogImage} />
  <meta property="og:url" content="https://www.angelsrest.online" />
  <meta property="og:type" content="website" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:image" content={ogImage} />
  <link rel="icon" type="image/png" href="/favicon.png" />
</svelte:head>

<script lang="ts">
import { enableVisualEditing } from "@sanity/visual-editing";
import { injectAnalytics } from "@vercel/analytics/sveltekit";
import type { Snippet } from "svelte";
import { onMount } from "svelte";
import { page } from "$app/stores";

// Header gif for non-homepage routes
import headerGif from "$lib/assets/ponyolovesham.gif";
import BottomNav from "$lib/components/BottomNav.svelte";
import Footer from "$lib/components/Footer.svelte";
// Layout components
import Nav from "$lib/components/Nav.svelte";
import ThemeSwitcher from "$lib/components/ThemeSwitcher.svelte";

// Time-aware theming
import { timeTheme } from "$lib/stores/timeTheme.svelte";

import "$lib/styles/global.css";

let { children, data }: { children: Snippet; data: any } = $props();

const ogTitle = $derived(data.siteSettings?.siteTitle || "Angel's Rest");
const ogDesc = $derived(
	data.siteSettings?.seo?.description || "Photography by Jesse Pomeroy",
);
const ogImage = $derived(
	data.siteSettings?.seo?.ogImageUrl ||
		"https://www.angelsrest.online/og-image.png",
);

// Vercel analytics
injectAnalytics();

// Keep time period in sync reactively
$effect(() => {
	// This runs whenever timeTheme.period changes
	timeTheme.apply();
});

onMount(() => {
	// Enable Sanity Visual Editing overlay when in preview mode
	if (data.isPreview) {
		const disable = enableVisualEditing();
		return () => {
			disable();
			timeTheme.destroy();
		};
	}
	return () => timeTheme.destroy();
});
</script>

<!-- SVG filter for film grain — generates fractal noise, no image needed -->
<svg style="display:none" aria-hidden="true">
  <filter id="grain-filter">
    <feTurbulence
      type="fractalNoise"
      baseFrequency="0.5"
      numOctaves="5"
      stitchTiles="stitch"
    />
    <feColorMatrix type="saturate" values="0" />
  </filter>
</svg>

<!-- Grain overlay — styled in grain.css -->
<div class="grain-overlay" aria-hidden="true"></div>

<div class="flex flex-col min-h-screen relative z-10">
  <!-- Desktop navigation (hidden on mobile) -->
  <Nav />
  
  <!-- Mobile header - only shown on non-homepage routes -->
  {#if $page.url.pathname !== "/"}
    <div class="md:hidden">
      <img src={headerGif} alt="" class="w-full" />
    </div>
    <div class="h-4 md:hidden"></div>
    <div class="hidden md:block h-6"></div>
  {/if}

  <!-- Main content area -->
  <main
    class="flex-1 max-w-[1400px] !mx-auto w-full px-1 pt-2 pb-2 md:pb-4 md:px-8"
  >
    {@render children()}
  </main>
  
  <!-- Desktop footer (hidden on mobile) -->
  <Footer siteSettings={data.siteSettings} />
  
  <!-- Mobile theme toggle - fixed position above bottom nav, homepage only -->
  {#if $page.url.pathname === "/"}
    <div class="fixed bottom-20 right-4 z-40 md:hidden">
      <ThemeSwitcher />
    </div>
  {/if}
  
  <!-- Spacer to prevent content from hiding behind fixed bottom nav -->
  <div class="h-20 md:hidden"></div>
  
  <!-- Mobile bottom navigation (hidden on desktop) -->
  <BottomNav />
</div>

