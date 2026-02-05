<script lang="ts">
  import type { Snippet } from "svelte";
  import Nav from "$lib/components/Nav.svelte";
  import BottomNav from "$lib/components/BottomNav.svelte";
  import Footer from "$lib/components/Footer.svelte";
  import "$lib/styles/global.css";

  let { children }: { children: Snippet } = $props();
</script>

<div class="flex flex-col min-h-screen">
  <Nav />
  <main class="flex-1 max-w-[1400px] mx-auto w-full p-8 pb-24 md:pb-8">
    {@render children()}
  </main>
  <Footer />
  <BottomNav />
</div>
