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
  <meta property="og:title" content="Angel's Rest" />
  <meta property="og:description" content="Photography by Jesse Pomeroy" />
  <meta property="og:image" content="https://www.angelsrest.online/og-image.png" />
  <meta property="og:url" content="https://www.angelsrest.online" />
  <meta property="og:type" content="website" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:image" content="https://www.angelsrest.online/og-image.png" />
  <link rel="icon" type="image/png" href="/favicon.png" />
</svelte:head>

<script lang="ts">
import type { Snippet } from "svelte";
import { page } from "$app/stores";
import { injectAnalytics } from "@vercel/analytics/sveltekit";
import { onMount } from "svelte";

// Header gif for non-homepage routes
import headerGif from "$lib/assets/ponyolovesham.gif";

// Layout components
import Nav from "$lib/components/Nav.svelte";
import BottomNav from "$lib/components/BottomNav.svelte";
import Footer from "$lib/components/Footer.svelte";
import ThemeSwitcher from "$lib/components/ThemeSwitcher.svelte";

// Time-aware theming
import { timeTheme } from "$lib/stores/timeTheme.svelte";

import "$lib/styles/global.css";

let { children }: { children: Snippet } = $props();

// Vercel analytics
injectAnalytics();

// Keep time period in sync reactively
$effect(() => {
  // This runs whenever timeTheme.period changes
  timeTheme.apply();
});

onMount(() => {
  return () => timeTheme.destroy();
});
</script>

<!-- SVG filter for film grain — generates fractal noise, no image needed -->
<svg style="display:none" aria-hidden="true">
  <filter id="grain-filter">
    <feTurbulence
      type="fractalNoise"
      baseFrequency="0.65"
      numOctaves="3"
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
  <Footer />
  
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
