<script lang="ts">
let {
	images = [],
	currentIndex = 0,
	onClose,
}: {
	images: any[];
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

function getImageUrl(img: any) {
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
	if (e.key === "Tab" && dialogEl) {
		const focusable = dialogEl.querySelectorAll<HTMLElement>(
			'button:not([disabled]), [tabindex]:not([tabindex="-1"])',
		);
		if (focusable.length === 0) return;
		const first = focusable[0];
		const last = focusable[focusable.length - 1];
		if (e.shiftKey && document.activeElement === first) {
			e.preventDefault();
			last.focus();
		} else if (!e.shiftKey && document.activeElement === last) {
			e.preventDefault();
			first.focus();
		}
	}
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
  class="fixed inset-0 bg-black/90 backdrop-blur-sm z-50 flex items-center justify-center"
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
  <div class="relative max-w-[90vw] max-h-[90vh]" role="document">
    <button
      class="absolute top-4 right-4 z-10 p-2 text-white/70 rounded-full hover:bg-white hover:text-black"
      aria-label="Close lightbox"
      onclick={onClose}
    >
      x
    </button>

    <div class="absolute top-4 left-4 text-white/70 text-sm" aria-live="polite">
      {index + 1}/{images.length}
    </div>

    <img
      src={getImageUrl(images[index])}
      alt={images[index]?.alt || `Gallery image ${index + 1} of ${images.length}`}
      class="max-w-full max-h-[90vh] object-contain rounded-md"
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
        class="absolute left-4 top-1/2 -translate-y-1/2 text-white/70 hover:text-white text-4xl"
        aria-label="Previous image"
        onclick={prev}
      >
        ‹
      </button>
      <button
        type="button"
        class="absolute right-4 top-1/2 -translate-y-1/2 text-white/70 hover:text-white text-4xl"
        aria-label="Next image"
        onclick={next}
      >
        ›
      </button>
    {/if}
  </div>
</div>
