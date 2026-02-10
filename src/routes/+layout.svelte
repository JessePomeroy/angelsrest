<script lang="ts">
  import type { Snippet } from "svelte";
  import { page } from "$app/stores";
  import { injectAnalytics } from "@vercel/analytics/sveltekit";
  import headerGifDark from "$lib/assets/ponyolovesham.gif";
  import headerGifLight from "$lib/assets/ponyolovesham2.gif";
  import Nav from "$lib/components/Nav.svelte";
  import BottomNav from "$lib/components/BottomNav.svelte";
  import Footer from "$lib/components/Footer.svelte";
  import ThemeSwitcher from "$lib/components/ThemeSwitcher.svelte";
  import { isDark } from "$lib/stores/theme";
  import "$lib/styles/global.css";

  let { children }: { children: Snippet } = $props();

  injectAnalytics();
</script>

<div class="flex flex-col min-h-screen">
  <Nav />
  {#if $page.url.pathname !== "/"}
    <div class="md:hidden">
      <img src={$isDark ? headerGifDark : headerGifLight} alt="" class="w-full" />
    </div>
    <div class="h-4 md:hidden"></div>
    <div class="hidden md:block h-6"></div>
  {/if}

  <main
    class="flex-1 max-w-[1400px] !mx-auto w-full px-1 pt-2 pb-2 md:pb-4 md:px-8"
  >
    {@render children()}
  </main>
  <Footer />
  <!-- Mobile theme toggle - positioned above About button (homepage only) -->
  {#if $page.url.pathname === "/"}
    <div class="fixed bottom-20 right-4 z-40 md:hidden">
      <ThemeSwitcher />
    </div>
  {/if}
  <!-- Spacer for fixed bottom nav on mobile -->
  <div class="h-20 md:hidden"></div>
  <BottomNav />
</div>
