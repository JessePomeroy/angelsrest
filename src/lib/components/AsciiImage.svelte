<!--
  AsciiImage Component

  Displays an image that transforms into ASCII art on hover.
  Renders ASCII to canvas so both image and ASCII use identical object-cover behavior.
-->

<script lang="ts">
import { onMount } from "svelte";
import {
	calcGridSize,
	pixelsToAscii,
	buildScramblePool,
	buildSettleOrder,
	buildAnimationFrame,
} from "$lib/utils/asciiGenerator";

let {
	src,
	alt = "",
	class: className = "",
	charSet = " .,:;i1tfLCG08@",
	resolution = 4,
	settleDuration = 2000,
}: {
	src: string;
	alt?: string;
	class?: string;
	charSet?: string;
	resolution?: number;
	settleDuration?: number;
} = $props();

// Audit L7: $state so bind:this stays reactive. asciiCanvas isn't read
// reactively anywhere (only written inside loadAndGenerate + renderAsciiToCanvas
// after the bind has settled), so it doesn't need the same treatment.
let sourceCanvas = $state<HTMLCanvasElement>() as HTMLCanvasElement;
let asciiCanvas: HTMLCanvasElement;
let asciiDataUrl = $state("");
let displayedAsciiUrl = $state("");
let isHovering = $state(false);
let imageLoaded = $state(false);
let reducedMotion = $state(true);
let disposed = true;
let pendingImage: HTMLImageElement | undefined;

let animationFrame: number | null = null;
let asciiChars: string[] = [];
let settledIndices: Set<number> = new Set();
let asciiCols = 0;
let asciiRows = 0;
let imgWidth = 0;
let imgHeight = 0;

const scramblePool = $derived(buildScramblePool(charSet));

onMount(() => {
	disposed = false;
	const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
	function syncMotion() {
		reducedMotion = motion.matches;
		stopAnimation();
		if (!reducedMotion) {
			if (!imageLoaded && !pendingImage) loadAndGenerate();
			else if (isHovering) startScrambleAnimation();
		}
	}
	syncMotion();
	motion.addEventListener("change", syncMotion);
	return () => {
		disposed = true;
		motion.removeEventListener("change", syncMotion);
		stopAnimation();
		if (pendingImage) {
			pendingImage.onload = null;
			pendingImage.onerror = null;
			pendingImage = undefined;
		}
	};
});

function loadAndGenerate() {
	const img = new Image();
	pendingImage = img;
	img.crossOrigin = "anonymous";

	img.onerror = (e) => {
		img.onload = null;
		img.onerror = null;
		pendingImage = undefined;
		if (disposed) return;
		console.error("ASCII image failed to load:", e);
	};

	img.onload = () => {
		img.onload = null;
		img.onerror = null;
		pendingImage = undefined;
		if (disposed || reducedMotion) return;
		const ctx = sourceCanvas.getContext("2d");
		if (!ctx) return;

		imgWidth = img.width;
		imgHeight = img.height;

		const grid = calcGridSize(imgWidth, imgHeight, resolution);
		asciiCols = grid.cols;
		asciiRows = grid.rows;

		sourceCanvas.width = asciiCols;
		sourceCanvas.height = asciiRows;
		ctx.drawImage(img, 0, 0, asciiCols, asciiRows);

		let imageData;
		try {
			imageData = ctx.getImageData(0, 0, asciiCols, asciiRows);
		} catch (e) {
			console.error("Canvas tainted - CORS issue with image:", e);
			return;
		}

		asciiChars = pixelsToAscii(imageData.data, asciiCols, asciiRows, charSet);
		asciiDataUrl = renderAsciiToCanvas(asciiChars);
		imageLoaded = true;
		if (isHovering) startScrambleAnimation();
	};

	img.src = src;
}

function renderAsciiToCanvas(chars: string[]): string {
	const width = imgWidth || 800;
	const height = imgHeight || 1000;

	const charWidth = width / asciiCols;
	const charHeight = height / asciiRows;
	const fontSize = Math.min(charWidth, charHeight) * 1.2;

	asciiCanvas.width = width;
	asciiCanvas.height = height;

	const ctx = asciiCanvas.getContext("2d");
	if (!ctx) return "";

	ctx.fillStyle = "#1e293b";
	ctx.fillRect(0, 0, width, height);

	ctx.fillStyle = "#e2e8f0";
	ctx.font = `${fontSize}px monospace`;
	ctx.textBaseline = "top";

	for (let y = 0; y < asciiRows; y++) {
		for (let x = 0; x < asciiCols; x++) {
			const char = chars[y * asciiCols + x];
			ctx.fillText(char, x * charWidth, y * charHeight);
		}
	}

	return asciiCanvas.toDataURL();
}

function startScrambleAnimation() {
	if (disposed || reducedMotion || !asciiChars.length) return;

	if (animationFrame !== null) cancelAnimationFrame(animationFrame);

	settledIndices = new Set();
	const startTime = performance.now();
	const indicesToSettle = buildSettleOrder(asciiChars);

	function animate(currentTime: number) {
		animationFrame = null;
		if (disposed || reducedMotion || !isHovering) return;
		const elapsed = currentTime - startTime;
		const progress = Math.min(elapsed / settleDuration, 1);

		const shouldBeSettled = Math.floor(progress * indicesToSettle.length);

		while (
			settledIndices.size < shouldBeSettled &&
			settledIndices.size < indicesToSettle.length
		) {
			settledIndices.add(indicesToSettle[settledIndices.size]);
		}

		const currentChars = buildAnimationFrame(asciiChars, settledIndices, scramblePool);
		displayedAsciiUrl = renderAsciiToCanvas(currentChars);

		if (progress < 1 && isHovering) {
			animationFrame = requestAnimationFrame(animate);
		} else if (progress >= 1) {
			displayedAsciiUrl = asciiDataUrl;
		}
	}

	animationFrame = requestAnimationFrame(animate);
}

function stopAnimation() {
	if (animationFrame !== null) {
		cancelAnimationFrame(animationFrame);
		animationFrame = null;
	}
}

function handleMouseEnter() {
	isHovering = true;
	startScrambleAnimation();
}

function handleMouseLeave() {
	isHovering = false;
	stopAnimation();
}
</script>

<div
  class="ascii-image-container relative overflow-hidden"
  onmouseenter={handleMouseEnter}
  onmouseleave={handleMouseLeave}
  role="img"
  aria-label={alt}
>
  <!-- Original image -->
  <img
    {src}
    {alt}
    class={className}
    style="visibility: {isHovering && imageLoaded && !reducedMotion ? 'hidden' : 'visible'};"
  />

  <!-- ASCII as image - uses same object-cover as original -->
  {#if imageLoaded && isHovering && !reducedMotion}
    <img
      src={displayedAsciiUrl || asciiDataUrl}
      alt=""
      class="{className} absolute inset-0"
      aria-hidden="true"
    />
  {/if}

  <!-- Hidden canvases -->
  <canvas bind:this={sourceCanvas} class="hidden"></canvas>
  <canvas bind:this={asciiCanvas} class="hidden"></canvas>
</div>

<style>
  .ascii-image-container {
    cursor: pointer;
  }
</style>
