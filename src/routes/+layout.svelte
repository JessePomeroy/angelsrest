<script lang="ts">
  import type { Snippet } from "svelte";
  import { page } from "$app/stores";
  import headerGif from "$lib/assets/ponyolovesham.gif";
  import Nav from "$lib/components/Nav.svelte";
  import BottomNav from "$lib/components/BottomNav.svelte";
  import Footer from "$lib/components/Footer.svelte";
  import "$lib/styles/global.css";
  import { Analytics } from "@vercel/analytics/svelte";

  let { children }: { children: Snippet } = $props();
</script>

<div class="flex flex-col min-h-screen">
  <Nav />
  {#if $page.url.pathname !== "/"}
    <div class="md:hidden">
      <img src={headerGif} alt="" class="w-full" />
    </div>
    <div class="h-4 md:hidden"></div>
    <div class="hidden md:block h-6"></div>
  {/if}

  <main class="flex-1 max-w-[1400px] !mx-auto w-full px-8 pt-2 pb-32 md:pb-8">
    {@render children()}
  </main>
  <Footer />
  <!-- Spacer for fixed bottom nav on mobile -->
  <div class="h-20 md:hidden"></div>
  <BottomNav />
</div>
