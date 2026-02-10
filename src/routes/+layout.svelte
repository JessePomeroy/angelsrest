<!--
  Root Layout
  
  Main layout wrapper for all pages. Handles:
  - Desktop nav (hidden on mobile)
  - Mobile header gif (hidden on desktop, not shown on homepage)
  - Mobile theme switcher (only on homepage)
  - Mobile bottom nav with spacer
  - Footer (desktop only)
  
  Theme-aware elements:
  - Header gif switches between ponyolovesham (dark) / ponyolovesham2 (light)
-->

<script lang="ts">
  import type { Snippet } from "svelte";
  import { page } from "$app/stores";
  import { injectAnalytics } from "@vercel/analytics/sveltekit";
  
  // Theme-aware header gifs for non-homepage routes
  import headerGifDark from "$lib/assets/ponyolovesham.gif";
  import headerGifLight from "$lib/assets/ponyolovesham2.gif";
  
  // Layout components
  import Nav from "$lib/components/Nav.svelte";
  import BottomNav from "$lib/components/BottomNav.svelte";
  import Footer from "$lib/components/Footer.svelte";
  import ThemeSwitcher from "$lib/components/ThemeSwitcher.svelte";
  
  // Theme store for reactive gif switching
  import { isDark } from "$lib/stores/theme";
  
  import "$lib/styles/global.css";

  let { children }: { children: Snippet } = $props();

  // Vercel analytics
  injectAnalytics();
</script>

<div class="flex flex-col min-h-screen">
  <!-- Desktop navigation (hidden on mobile) -->
  <Nav />
  
  <!-- Mobile header - only shown on non-homepage routes -->
  {#if $page.url.pathname !== "/"}
    <div class="md:hidden">
      <!-- Theme-aware gif: dark = ponyolovesham, light = ponyolovesham2 -->
      <img src={$isDark ? headerGifDark : headerGifLight} alt="" class="w-full" />
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
