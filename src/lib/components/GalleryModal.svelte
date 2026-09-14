<script lang="ts">
import { trapFocus } from "$lib/utils/focusTrap";
import { openModal } from "$lib/utils/openModal";

interface GalleryImage {
	full?: string;
	url?: string;
	alt?: string;
}

let {
	images = [],
	currentIndex = 0,
	onClose,
}: {
	images: GalleryImage[];
	currentIndex: number;
	onClose: () => void;
} = $props();

// Track a local offset from the currentIndex prop rather than mirroring it
// via $effect (the prop-to-state anti-pattern). When the parent opens the
// modal on a new image, currentIndex changes; internal next()/prev() bump
// `offset`, and the rendered index is derived from both.
let offset = $state(0);
let index = $derived(
	images.length ? ((currentIndex + offset) % images.length + images.length) % images.length : 0,
);

let offsetX = $state(0);
let isDragging = $state(false);
let startX = 0;

function getImageUrl(img: GalleryImage | undefined) {
	// Audit L4: if the image object lacks both `full` and `url`, fall back
	// to an empty string (which renders a broken image the UI already
	// handles) rather than returning the whole object — which would
	// serialize as "[object Object]" into the src attribute.
	return img?.full || img?.url || "";
}

$effect(() => {
	if (images.length < 2) return;
	const preloadIndexes = [
		(index + 1) % images.length,
		(index - 1 + images.length) % images.length,
	];
	preloadIndexes.forEach((i) => {
		const img = new Image();
		img.src = getImageUrl(images[i]);
	});
});

function next() {
	offset += 1;
}

function prev() {
	offset -= 1;
}

function handleKeydown(e: KeyboardEvent & { currentTarget: HTMLDialogElement }) {
	if (e.key === "ArrowRight") next();
	if (e.key === "ArrowLeft") prev();
	trapFocus(e, e.currentTarget);
}

function handleTouchStart(e: TouchEvent) {
	isDragging = true;
	startX = e.touches[0].clientX;
	offsetX = 0;
}

function handleTouchMove(e: TouchEvent) {
	if (!isDragging) return;
	offsetX = e.touches[0].clientX - startX;
}

function handleTouchEnd() {
	isDragging = false;
	if (offsetX < -50) next();
	else if (offsetX > 50) prev();
	offsetX = 0;
}
</script>

<dialog
  use:openModal
  class="lightbox"
  onclick={(e) => {
    // Only close when the click hits the backdrop itself, not a child.
    // Removes the need for stopPropagation on the inner content div.
    if (e.target === e.currentTarget) onClose();
  }}
  oncancel={(event) => {
    event.preventDefault();
    onClose();
  }}
  onkeydown={handleKeydown}
  aria-label="Image lightbox — {images.length ? index + 1 : 0} of {images.length}"
>
  <div class="image-stage" class:empty={images.length === 0} role="document">
    <button
      class="close-lightbox"
      aria-label="Close lightbox"
      onclick={onClose}
    >
      x
    </button>

    <div class="image-count" aria-live="polite">
      {images.length ? index + 1 : 0}/{images.length}
    </div>

    {#if images.length}
    <img
      src={getImageUrl(images[index])}
      alt={images[index]?.alt || `Gallery image ${index + 1} of ${images.length}`}
      class="gallery-image"
      style="transform: translateX({offsetX}px); transition: {isDragging
        ? 'none'
        : 'transform 0.2s ease-out'}"
      ontouchstart={handleTouchStart}
      ontouchmove={handleTouchMove}
      ontouchend={handleTouchEnd}
      draggable="false"
    />
    {:else}
      <p>No images available.</p>
    {/if}

    {#if images.length > 1}
      <button
        type="button"
        class="image-previous"
        aria-label="Previous image"
        onclick={prev}
      >
        ‹
      </button>
      <button
        type="button"
        class="image-next"
        aria-label="Next image"
        onclick={next}
      >
        ›
      </button>
    {/if}
  </div>
</dialog>

<style>
  @layer components {
    .lightbox { position: fixed; inset: 0; width: 100%; height: 100%; max-width: none; max-height: none; margin: 0; padding: 0; border: 0; color: white; background: rgb(0 0 0 / 90%); -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px); }
    .lightbox[open] { display: flex; align-items: center; justify-content: center; }
    .lightbox::backdrop { background: transparent; }
    .image-stage { position: relative; max-width: 90vw; max-height: 90vh; }
    .image-stage.empty { min-width: 12rem; padding: 4rem 2rem 2rem; }
    .close-lightbox { position: absolute; top: 1rem; right: 1rem; z-index: 10; padding: 0.5rem; color: color-mix(in oklab, white 70%, transparent); border-radius: 9999px; }
    .image-count { position: absolute; top: 1rem; left: 1rem; z-index: 1; color: color-mix(in oklab, white 70%, transparent); font-size: var(--text-sm); line-height: var(--text-sm--line-height); }
    .gallery-image { max-width: 100%; max-height: 90vh; object-fit: contain; border-radius: 0.375rem; }
    .image-previous, .image-next { position: absolute; top: 50%; translate: 0 -50%; color: color-mix(in oklab, white 70%, transparent); font-size: var(--text-4xl); line-height: var(--text-4xl--line-height); }
    .image-previous { left: 1rem; }
    .image-next { right: 1rem; }
    @media (hover: hover) {
      .close-lightbox:hover { background: white; color: black; }
      .image-previous:hover, .image-next:hover { color: white; }
    }
  }
</style>
