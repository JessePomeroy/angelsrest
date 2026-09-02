<script lang="ts">
/**
 * Gallery Index Page
 * Shows a grid of all galleries — click one to view its images.
 * Data comes from the Convex-owned public portfolio projection.
 */
import SEO from "$lib/components/SEO.svelte";

// Page data from the load function (contains galleries array)
let { data } = $props();
</script>

<SEO
    title="gallery | angel's rest"
    description="Photo galleries by Jesse Pomeroy. Portrait, landscape, street, and editorial photography."
    url="https://angelsrest.online/gallery"
/>

<!--
  Gallery grid
  - Responsive columns: 2 on mobile, 3 on medium screens
  - Each gallery links to /gallery/[slug] for the detail view
-->
<section class="gallery-index">
    <header class="section-heading">
        <h1>gallery</h1>
        <span>{data.galleries.length} collections</span>
    </header>
    <div class="gallery-columns">
        {#each data.galleries as gallery (gallery.slug)}
            <a href="/gallery/{gallery.slug}" class="gallery-entry">
                <div class="image-frame">
                    <img src={gallery.preview} alt={gallery.title} loading="lazy" />
                </div>
                <div class="entry-caption">
                    <h2>{gallery.title}</h2>
                </div>
            </a>
        {/each}
    </div>
</section>

<style>
    .gallery-index { width: 100%; }
    .section-heading {
        display: flex;
        min-height: 56px;
        margin-bottom: 24px;
        align-items: flex-start;
        justify-content: space-between;
        border-bottom: 1px solid color-mix(in srgb, currentColor 15%, transparent);
    }
    .section-heading h1 { font-size: 1.35rem; font-weight: 500; }
    .section-heading span { padding-top: 5px; color: color-mix(in srgb, currentColor 55%, transparent); font-size: 0.68rem; letter-spacing: 0.12em; }
    .gallery-columns { columns: 2; column-gap: 18px; }
    .gallery-entry { display: block; margin-bottom: 24px; break-inside: avoid; color: inherit; }
    .image-frame { overflow: hidden; border: 1px solid color-mix(in srgb, currentColor 13%, transparent); }
    .image-frame img { width: 100%; transition: transform 400ms cubic-bezier(.22,1,.36,1); }
    .gallery-entry:hover img { transform: scale(1.018); }
    .entry-caption { display: flex; padding-top: 9px; align-items: baseline; justify-content: space-between; border-top: 1px solid color-mix(in srgb, currentColor 10%, transparent); }
    .entry-caption h2 { font-family: "Synonym", sans-serif; font-size: 0.72rem; font-weight: 400; letter-spacing: 0.13em; }
    @media (min-width: 768px) { .gallery-columns { columns: 3; } }
    @media (max-width: 520px) { .gallery-columns { columns: 1; } }
</style>
