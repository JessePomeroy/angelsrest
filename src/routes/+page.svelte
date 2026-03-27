<!--
  Homepage

  Landing page with hero gif, tagline, and CTA buttons.

  Desktop-specific:
  - Locks viewport to prevent scroll (keeps nav + hero + footer in view)
-->

<script>
    import heroGif from "$lib/assets/clouds2.gif";
    import SEO from "$lib/components/SEO.svelte";
</script>

<!--
  Desktop styles: fit everything in the viewport without scrolling.
  Uses dvh (dynamic viewport height) which accounts for browser chrome
  (address bar, bookmarks bar, etc). Falls back to vh for older browsers.
  min-height instead of height means content can still overflow if the
  viewport is too short, rather than getting clipped.
-->
<svelte:head>
    <style>
        @media (min-width: 768px) {
            html,
            body {
                height: 100vh;
                height: 100dvh;
                overflow: auto;
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

<!-- Hero section - fills available space between nav and footer, centers content -->
<section
    class="flex flex-col items-center justify-center text-center min-h-0 flex-1 gap-4 md:gap-6"
>
    <!-- Hero gif -->
    <img src={heroGif} alt="Angel's Rest" class="max-w-full w-200 rounded-md" />

    <!-- Tagline -->
    <p class="text-surface-400 text-sm tracking-[0.2em] lowercase">
        artist in residence[midwest]
    </p>

    <!-- CTA buttons - wrap on mobile -->
    <div class="flex flex-wrap justify-center gap-4 mt-4">
        <a
            href="/gallery"
            class="btn preset-filled-surface-50 px-8 py-3 text-xs tracking-[0.15em]"
            >view gallery</a
        >
        <a
            href="/shop"
            class="btn preset-outlined-surface-50 px-8 py-3 text-xs tracking-[0.15em]"
            style="color: var(--time-accent);">shop</a
        >
        <a
            href="/about"
            class="btn preset-outlined-surface-50 px-8 py-3 text-xs tracking-[0.15em]"
            >book session</a
        >
    </div>
</section>
