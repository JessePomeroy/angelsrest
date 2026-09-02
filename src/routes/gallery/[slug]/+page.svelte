<script lang="ts">
/**
 * Gallery Detail Page
 * Shows all images in a single gallery with masonry layout.
 * Click an image to open the lightbox modal.
 *
 * Images are optimized:
 * - thumbnail (400px) for the grid
 * - full (1600px) for the lightbox
 */

import GalleryModal from "$lib/components/GalleryModal.svelte";
import SEO from "$lib/components/SEO.svelte";

// Page data from the load function (contains gallery object with images)
let { data } = $props();

// Modal state
let modalOpen = $state(false); // Whether the lightbox is visible
let selectedIndex = $state(0); // Which image to show in the lightbox

// Open the modal at a specific image index
function openModal(index: number) {
	selectedIndex = index;
	modalOpen = true;
}
</script>

<SEO
  title="{data.gallery.title} | angel's rest"
  description={data.gallery.seo?.description || data.gallery.description || `Photo gallery: ${data.gallery.title}`}
  image={data.gallery.seo?.ogImageUrl || data.gallery.images[0]?.full || undefined}
  url={data.gallery.canonicalUrl}
/>

<section class="gallery-detail">
  <header class="gallery-heading">
    <a href="/gallery">← back</a>
    <h1>{data.gallery.title}</h1>
  </header>

  <!-- 
    Masonry image grid using CSS columns
    - columns-2/3/4 creates the masonry effect (images flow into columns)
    - break-inside-avoid prevents images from splitting across columns
    - Uses optimized thumbnail URLs (400px webp)
  -->
  <div class="image-grid">
    {#each data.gallery.images as image, i (image.full ?? i)}
      <button
        class="image-button"
        onclick={() => openModal(i)}
        aria-label="View image {i + 1}"
      >
        <img
          src={image.thumbnail}
          alt={image.alt || "Gallery image " + (i + 1)}
          loading="lazy"
        />
      </button>
    {/each}
  </div>
</section>

<!-- 
  Lightbox modal
  - Only rendered when modalOpen is true
  - Passes the images array, starting index, and close callback
-->
{#if modalOpen}
  <GalleryModal
    images={data.gallery.images}
    currentIndex={selectedIndex}
    onClose={() => (modalOpen = false)}
  />
{/if}

<style>
  .gallery-detail { width: 100%; }
  .gallery-heading { min-height: 88px; margin-bottom: 8px; border-bottom: 1px solid color-mix(in srgb, currentColor 15%, transparent); }
  .gallery-heading a { color: color-mix(in srgb, currentColor 58%, transparent); font-size: 0.72rem; letter-spacing: 0.06em; }
  .gallery-heading a:hover { color: currentColor; }
  .gallery-heading h1 { margin-top: 8px; font-size: 1.35rem; font-weight: 500; }
  .image-grid { columns: 2; column-gap: 8px; }
  .image-button { display: block; width: 100%; margin: 0 0 8px; padding: 0; break-inside: avoid; border: 0; background: transparent; cursor: zoom-in; }
  .image-button img { display: block; width: 100%; height: auto; transition: opacity 180ms ease; }
  .image-button:hover img { opacity: 0.86; }
  .image-button:focus-visible { outline: 1px solid var(--time-accent); outline-offset: 2px; }
  @media (min-width: 768px) { .image-grid { columns: 3; } }
  @media (min-width: 1100px) { .image-grid { columns: 4; } }
</style>
