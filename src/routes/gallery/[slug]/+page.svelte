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

  import SEO from "$lib/components/SEO.svelte";
  import GalleryModal from "$lib/components/GalleryModal.svelte";

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
  description="Photo gallery: {data.gallery.title}"
  url="https://angelsrest.online/gallery/{data.gallery.title.toLowerCase().replace(/\s+/g, '-')}"
/>

<div class="p-4">
  <!-- Back link to gallery index -->
  <a href="/gallery" class="text-sm opacity-70 hover:opacity-100">← Back</a>

  <!-- Gallery title -->
  <h1 class="text-2xl font-bold mt-2 mb-4">{data.gallery.title}</h1>

  <!-- 
    Masonry image grid using CSS columns
    - columns-2/3/4 creates the masonry effect (images flow into columns)
    - break-inside-avoid prevents images from splitting across columns
    - Uses optimized thumbnail URLs (400px webp)
  -->
  <div class="columns-2 md:columns-3 lg:columns-4 gap-4 p-4">
    {#each data.gallery.images as image, i}
      <button
        class="mb-4 w-full break-inside-avoid"
        onclick={() => openModal(i)}
      >
        <img
          src={image.thumbnail}
          alt={image.alt || ""}
          class="w-full h-auto hover:scale-105 transition-transform rounded-md"
          loading="lazy"
        />
      </button>
    {/each}
  </div>
</div>

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
