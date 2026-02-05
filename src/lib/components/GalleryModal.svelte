<script lang="ts">
  /**
   * GalleryModal.svelte
   * A fullscreen lightbox modal for viewing images with keyboard navigation.
   *
   * Features:
   * - Arrow keys to navigate between images
   * - Escape key to close
   * - Click backdrop to close
   * - Click image/controls without closing (stopPropagation)
   */

  // Props from parent component
  // - images: array of image objects with url and optional alt
  // - currentIndex: which image to show initially (renamed to initialIndex to capture once)
  // - onClose: callback to close the modal
  let {
    images = [],
    currentIndex: initialIndex = 0,
    onClose,
  }: {
    images: any[];
    currentIndex: number;
    onClose: () => void;
  } = $props();

  // Local state for tracking current image
  // We capture initialIndex once — the modal manages its own navigation from there
  let index = $state(initialIndex);

  // Navigate to next image (wraps around using modulo)
  function next() {
    index = (index + 1) % images.length;
  }

  // Navigate to previous image (wraps around)
  function prev() {
    index = (index - 1 + images.length) % images.length;
  }

  // Global keyboard handler for navigation and closing
  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") onClose();
    if (e.key === "ArrowRight") next();
    if (e.key === "ArrowLeft") prev();
  }

  // Swipe Detection
  let touchStartX = 0;
  let touchEndX = 0;

  function handleTouchStart(e: TouchEvent) {
    touchStartX = e.touches[0].clientX;
  }
  function handleTouchEnd(e: TouchEvent) {
    touchEndX = e.changedTouches[0].clientX;
    handleSwipe();
  }

  function handleSwipe() {
    const swipeThreshold = 50; // minimum distance to trigger swipe
    const diff = touchStartX - touchEndX;
    if (Math.abs(diff) > swipeThreshold) {
      if (diff > 0) {
        next();
      } else {
        prev();
      }
    }
  }
</script>

<!-- Attach keyboard listener to the window so it works regardless of focus -->
<svelte:window on:keydown={handleKeydown} />

<!-- 
  Backdrop (dark overlay)
  - Clicking it closes the modal
  - Has keyboard handler for a11y (Enter/Space also close)
  - role="dialog" and aria-modal for screen readers
  - tabindex="-1" makes it focusable for a11y without adding to tab order
-->
<div
  class="fixed inset-0 bg-black/90 z-50 flex items-center justify-center"
  onclick={onClose}
  onkeydown={(e) => (e.key === "Enter" || e.key === " ") && onClose()}
  role="dialog"
  aria-modal="true"
  tabindex="-1"
>
  <!-- 
    Content container
    - stopPropagation prevents clicks on image/buttons from bubbling up to close the modal
    - role="presentation" tells a11y tools this div isn't interactive itself
  -->
  <div
    class="relative max-w-[90vw] max-h-[90vh]"
    onclick={(e) => e.stopPropagation()}
    role="presentation"
  >
    <!-- Close button (top right) -->
    <button
      class="absolute top-4 right-4 z-10 p-2 text-white/70 rounded-full hover:bg-white hover:text-black"
      aria-label="Close"
      onclick={onClose}
    >
      x
    </button>

    <!-- Image counter showing current position (e.g., "3/10") -->
    <div class="absolute top-4 left-4 text-white/70 text-sm">
      {index + 1}/{images.length}
    </div>

    <!-- 
      The main image
      - max-w-full and max-h-[90vh] keep it within viewport bounds
      - object-contain preserves aspect ratio
    -->
    <img
      src={images[index]?.url || images[index]}
      alt=""
      class="max-w-full max-h-[90vh] object-contain"
      ontouchstart={handleTouchStart}
      ontouchend={handleTouchEnd}
    />

    <!-- Navigation arrows (only shown if more than one image) -->
    {#if images.length > 1}
      <button
        type="button"
        class="absolute left-4 top-1/2 -translate-y-1/2 text-white/70 hover:text-white text-4xl"
        onclick={prev}
      >
        ‹
      </button>
      <button
        type="button"
        class="absolute right-4 top-1/2 -translate-y-1/2 text-white/70 hover:text-white text-4xl"
        onclick={next}
      >
        ›
      </button>
    {/if}
  </div>
</div>
