<script lang="ts">
import { trapFocus } from "$lib/utils/focusTrap";

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
	((currentIndex + offset) % images.length + images.length) % images.length,
);
let dialogEl = $state<HTMLDivElement | null>(null);
let previouslyFocused: HTMLElement | null = null;

$effect(() => {
	if (dialogEl) {
		previouslyFocused = document.activeElement as HTMLElement;
		const closeBtn = dialogEl.querySelector<HTMLElement>(
			'[aria-label="Close lightbox"]',
		);
		closeBtn?.focus();
	}
	return () => {
		previouslyFocused?.focus();
	};
});

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

function handleKeydown(e: KeyboardEvent) {
	if (e.key === "Escape") onClose();
	if (e.key === "ArrowRight") next();
	if (e.key === "ArrowLeft") prev();
	if (dialogEl) trapFocus(e, dialogEl);
}

let touchStartX = 0;

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

<svelte:window onkeydown={handleKeydown} />

<div
  class="lightbox"
  onclick={(e) => {
    // Only close when the click hits the backdrop itself, not a child.
    // Removes the need for stopPropagation on the inner content div.
    if (e.target === e.currentTarget) onClose();
  }}
  onkeydown={(e) => {
    // a11y: click handler above needs a matching keyboard handler on the
    // same element. Escape-to-close is the natural pair. Arrow-key
    // navigation / tab trap is still handled globally via svelte:window
    // below so the keys work even when focus has drifted.
    if (e.key === "Escape" && e.target === e.currentTarget) onClose();
  }}
  role="dialog"
  aria-modal="true"
  aria-label="Image lightbox — {index + 1} of {images.length}"
  tabindex="-1"
  bind:this={dialogEl}
>
  <div class="image-stage" role="document">
    <button
      class="close-lightbox"
      aria-label="Close lightbox"
      onclick={onClose}
    >
      x
    </button>

    <div class="image-count" aria-live="polite">
      {index + 1}/{images.length}
    </div>

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
</div>

<style>
  @layer components {
    .lightbox { position: fixed; inset: 0; background: rgb(0 0 0 / 90%); -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px); z-index: 50; display: flex; align-items: center; justify-content: center; }
    .image-stage { position: relative; max-width: 90vw; max-height: 90vh; }
    .close-lightbox { position: absolute; top: 1rem; right: 1rem; z-index: 10; padding: 0.5rem; color: color-mix(in oklab, white 70%, transparent); border-radius: 9999px; }
    .image-count { position: absolute; top: 1rem; left: 1rem; color: color-mix(in oklab, white 70%, transparent); font-size: var(--text-sm); line-height: var(--text-sm--line-height); }
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
