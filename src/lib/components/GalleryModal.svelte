<script lang="ts">
import { ChevronLeftIcon, ChevronRightIcon, XIcon } from "@lucide/svelte";
import { trapFocus } from "$lib/utils/focusTrap";
import { openModal } from "$lib/utils/openModal";

interface GalleryImage {
	full?: string;
	url?: string;
	alt?: string;
	width?: number;
	height?: number;
	fullWidth?: number;
	fullHeight?: number;
	srcset?: string;
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

function imageSizes(image: GalleryImage | undefined) {
	return image?.fullWidth && image.fullHeight
		? `min(calc(100vw - 16px), calc((100dvh - 108px) * ${image.fullWidth / image.fullHeight}))` : "100vw";
}

$effect(() => {
	if (images.length < 2) return;
	const preloadIndexes = [
		(index + 1) % images.length,
		(index - 1 + images.length) % images.length,
	];
	preloadIndexes.forEach((i) => {
		const img = new Image();
		img.sizes = imageSizes(images[i]);
		if (images[i]?.srcset) img.srcset = images[i].srcset;
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
  <button type="button" class="close-lightbox" aria-label="Close lightbox" onclick={onClose}>
    <XIcon size={20} aria-hidden="true" />
  </button>

  <div class="image-stage" role="document">
    {#if images.length}
    <img
      src={getImageUrl(images[index])}
      srcset={images[index]?.srcset} sizes={imageSizes(images[index])}
      width={images[index]?.fullWidth ?? images[index]?.width} height={images[index]?.fullHeight ?? images[index]?.height}
      decoding="async"
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

  </div>

  {#if images.length > 1}
    <div class="image-navigation">
      <button type="button" class="image-previous" aria-label="Previous image" onclick={prev}>
        <ChevronLeftIcon size={20} aria-hidden="true" />
      </button>
      <span class="image-count" aria-live="polite" aria-atomic="true">{index + 1}/{images.length}</span>
      <button type="button" class="image-next" aria-label="Next image" onclick={next}>
        <ChevronRightIcon size={20} aria-hidden="true" />
      </button>
    </div>
  {/if}
</dialog>

<style>
  @layer components {
    .lightbox {
      position: fixed;
      inset: 0;
      box-sizing: border-box;
      width: 100%;
      height: 100%;
      height: 100dvh;
      max-width: none;
      max-height: none;
      margin: 0;
      padding: max(6px, env(safe-area-inset-top)) max(8px, env(safe-area-inset-right))
        max(6px, env(safe-area-inset-bottom)) max(8px, env(safe-area-inset-left));
      border: 0;
      background: #090909;
      color: white;
      overflow: hidden;
    }

    .lightbox[open] {
      display: grid;
      grid-template-rows: 44px minmax(0, 1fr) 44px;
      gap: 4px;
    }

    .image-stage {
      display: grid;
      grid-template: minmax(0, 1fr) / minmax(0, 1fr);
      place-items: center;
      min-height: 0;
      pointer-events: none;
    }

    .gallery-image {
      width: auto;
      height: auto;
      max-width: 100%;
      max-height: 100%;
      min-height: 0;
      min-width: 0;
      object-fit: contain;
      pointer-events: auto;
    }

    .close-lightbox { justify-self: end; }
    .image-navigation {
      justify-self: center;
      display: flex;
      align-items: center;
      gap: 0.25rem;
    }

    .image-count {
      min-width: 5ch;
      text-align: center;
      font-size: var(--text-xs);
      font-variant-numeric: tabular-nums;
    }

    .lightbox button {
      display: grid;
      place-items: center;
      width: 44px;
      height: 44px;
      padding: 0;
      border: 0;
      border-radius: 50%;
      background: transparent;
      color: inherit;
      cursor: pointer;
    }

    .lightbox button:focus-visible { outline: 2px solid currentColor; }
    @media (hover: hover) {
      .lightbox button:hover { background: #282828; }
    }
  }
</style>
