<script lang="ts">
  import type { Snippet } from "svelte";
  import { page } from "$app/stores";
  import headerGif from "$lib/assets/ponyolovesham.gif";
  import Nav from "$lib/components/Nav.svelte";
  import BottomNav from "$lib/components/BottomNav.svelte";
  import Footer from "$lib/components/Footer.svelte";
  import "$lib/styles/global.css";

  let { children }: { children: Snippet } = $props();
</script>

<div class="flex flex-col min-h-screen">
  <Nav />
  {#if $page.url.pathname !== "/"}
    <div class="md:hidden">
      <img src={headerGif} alt="" class="w-full" />
    </div>
    <div class="h-8 md:hidden"></div>
    <div class="hidden md:block h-36"></div>
  {/if}

  <main class="flex-1 max-w-[1400px] !mx-auto w-full p-8 pb-24 md:pb-8">
    {@render children()}
  </main>
  <Footer />
  <BottomNav />
</div>
