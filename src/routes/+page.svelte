<!--
  Homepage
  
  Landing page with hero gif, tagline, and CTA buttons.
  
  Theme-aware elements:
  - Hero gif switches between clouds2 (dark) / clouds3 (light)
  
  Desktop-specific:
  - Locks viewport to prevent scroll (keeps nav + hero + footer in view)
-->

<script>
  // Theme-aware hero gifs
  import heroGifDark from "$lib/assets/clouds2.gif";
  import heroGifLight from "$lib/assets/clouds3.gif";
  
  import SEO from "$lib/components/SEO.svelte";
  import { isDark } from "$lib/stores/theme";
</script>

<!-- 
  Desktop-only styles: lock viewport to prevent scroll
  This keeps the entire homepage (nav + content + footer) visible without scrolling
-->
<svelte:head>
  <style>
    @media (min-width: 768px) {
      html, body {
        overflow: hidden;
        height: 100vh;
      }
    }
  </style>
</svelte:head>

<!-- Page SEO metadata -->
<SEO
  title="angel's rest"
  description="Photography portfolio and print shop by Jesse Pomeroy. Fine art photography, prints, zines, and commissions."
  url="https://angelsrest.online"
/>

<!-- Hero section -->
<section
  class="flex flex-col items-center justify-center text-center min-h-0 gap-4 md:gap-6"
>
  <!-- Theme-aware hero gif: dark = clouds2, light = clouds3 -->
  <img src={$isDark ? heroGifDark : heroGifLight} alt="Angel's Rest" class="max-w-full w-200 rounded-md" />

  <!-- Tagline -->
  <p class="text-surface-400 text-sm tracking-[0.2em] lowercase">
    artist in residence[midwest]
  </p>
  
  <!-- CTA buttons - wrap on mobile -->
  <div class="flex flex-wrap justify-center gap-4 mt-4">
    <a
      href="/gallery"
      class="btn preset-filled-surface-50 px-8 py-3 text-xs tracking-[0.15em] uppercase"
      >View Gallery</a
    >
    <a
      href="/shop"
      class="btn preset-outlined-surface-50 px-8 py-3 text-xs tracking-[0.15em] uppercase"
      >Shop Prints</a
    >
    <a
      href="/about"
      class="btn preset-outlined-surface-50 px-8 py-3 text-xs tracking-[0.15em] uppercase"
      >Book Session</a
    >
  </div>
</section>
