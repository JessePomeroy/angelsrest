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
<h1 class="sr-only">Angel's Rest Photography</h1>

<section class="home-hero">
    <!-- Hero gif -->
    <div class="hero-image">
        <img src={heroGif} alt="Angel's Rest" />
    </div>

    <!-- Tagline -->
    <p class="hero-tagline">
        artist in residence[midwest]
    </p>

    <!-- CTA buttons - wrap on mobile -->
    <div class="hero-links">
        <a href="/gallery">view gallery</a>
        <a href="/shop">shop</a>
        <a href="/about">book session</a>
    </div>
</section>

<style>
    .home-hero {
        display: flex;
        flex: 1;
        min-height: 0;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 20px;
        text-align: center;
    }

    .hero-image {
        width: min(100%, 900px);
    }

    .hero-image img { width: 100%; }

    .hero-tagline {
        color: color-mix(in srgb, currentColor 58%, transparent);
        font-size: 0.75rem;
        letter-spacing: 0.2em;
    }

    .hero-links {
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        gap: 0;
        border-block: 1px solid color-mix(in srgb, currentColor 14%, transparent);
    }

    .hero-links a {
        min-width: 150px;
        padding: 11px 18px;
        color: inherit;
        border-right: 1px solid color-mix(in srgb, currentColor 14%, transparent);
        font-size: 0.7rem;
        letter-spacing: 0.12em;
    }

    .hero-links a:last-child { border-right: 0; }
    @media (max-width: 520px) {
        .hero-links { width: 100%; }
        .hero-links a { flex: 1 1 100%; border-right: 0; border-bottom: 1px solid color-mix(in srgb, currentColor 14%, transparent); }
        .hero-links a:last-child { border-bottom: 0; }
    }
</style>
