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

let canvas = $state<HTMLCanvasElement>();
let art = $state.raw<{ chars: string[]; paint: (chars: string[]) => void }>();
let hovering = $state(false);
let toggled = $state(false);
let reducedMotion = $state(true);
const active = $derived(!reducedMotion && !!art && (hovering || toggled));

onMount(() => {
	const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
	const syncMotion = () => { reducedMotion = motion.matches; };
	syncMotion();
	motion.addEventListener("change", syncMotion);
	return () => motion.removeEventListener("change", syncMotion);
});

$effect(() => {
	// Snapshot each generation's inputs before its asynchronous image completion.
	const output = canvas;
	const imageSrc = src;
	const characters = charSet;
	const spacing = resolution;
	art = undefined;
	if (reducedMotion || !output) return;

	const image = new Image();
	let disposed = false;
	image.crossOrigin = "anonymous";
	image.onerror = () => {
		image.onload = image.onerror = null;
		if (!disposed) console.error("ASCII image failed to load.");
	};
	image.onload = () => {
		image.onload = image.onerror = null;
		if (disposed) return;
		try {
			const { cols, rows } = calcGridSize(image.width, image.height, spacing);
			if (cols < 1 || rows < 1 || !characters.length) return;
			const source = document.createElement("canvas");
			source.width = cols;
			source.height = rows;
			const sourceContext = source.getContext("2d");
			const context = output.getContext("2d");
			if (!sourceContext || !context) return;
			sourceContext.drawImage(image, 0, 0, cols, rows);
			const pixels = sourceContext.getImageData(0, 0, cols, rows);
			const chars = pixelsToAscii(pixels.data, cols, rows, characters);

			output.width = image.width;
			output.height = image.height;
			const charWidth = image.width / cols;
			const charHeight = image.height / rows;
			context.font = `${Math.min(charWidth, charHeight) * 1.2}px monospace`;
			context.textBaseline = "top";
			const paint = (frame: string[]) => {
				context.fillStyle = "#1e293b";
				context.fillRect(0, 0, output.width, output.height);
				context.fillStyle = "#e2e8f0";
				for (let y = 0; y < rows; y++) {
					for (let x = 0; x < cols; x++) {
						context.fillText(frame[y * cols + x], x * charWidth, y * charHeight);
					}
				}
			};
			paint(chars);
			art = { chars, paint };
		} catch {
			// Decoding or canvas access may fail; the ordinary image stays available.
			console.error("ASCII rendering failed; showing the original image.");
		}
	};

	// Isolate the CORS request from the ordinary photo's non-CORS browser cache.
	try {
		const canvasSrc = new URL(imageSrc, document.baseURI);
		if (canvasSrc.protocol === "http:" || canvasSrc.protocol === "https:") {
			canvasSrc.searchParams.set("ascii", "1");
		}
		image.src = canvasSrc.href;
	} catch {
		image.onload = image.onerror = null;
		console.error("ASCII image URL is invalid.");
	}
	return () => {
		disposed = true;
		image.onload = image.onerror = null;
	};
});

$effect(() => {
	const current = art;
	if (!active || !current) return;
	const start = performance.now();
	const duration = settleDuration;
	const order = buildSettleOrder(current.chars);
	const settled = new Set<number>();
	const pool = buildScramblePool(charSet);
	let disposed = false;
	let request: number;
	const animate = (now: number) => {
		if (disposed) return;
		const progress = Math.min((now - start) / duration, 1);
		const count = Math.floor(progress * order.length);
		while (settled.size < count) settled.add(order[settled.size]);
		try {
			current.paint(progress < 1 ? buildAnimationFrame(current.chars, settled, pool) : current.chars);
		} catch {
			art = undefined;
			console.error("ASCII rendering failed; showing the original image.");
			return;
		}
		if (progress < 1) request = requestAnimationFrame(animate);
	};
	request = requestAnimationFrame(animate);
	return () => {
		disposed = true;
		cancelAnimationFrame(request);
	};
});

function reset() {
	hovering = false;
	toggled = false;
}

function toggle() {
	const next = !active;
	hovering = false;
	toggled = next;
}
</script>

<button
	type="button"
	class="ascii-image-container"
	aria-label={alt ? `${alt} — toggle ASCII art` : "Toggle ASCII art"}
	aria-pressed={active}
	disabled={reducedMotion}
	onpointerenter={(event) => { if (event.pointerType === "mouse") hovering = true; }}
	onpointerleave={() => hovering = false}
	onclick={toggle}
	onblur={reset}
	onkeydown={(event) => { if (event.key === "Escape") reset(); }}
>
	<img {src} {alt} class={className} style:visibility={active ? "hidden" : "visible"} />
	<canvas
		bind:this={canvas}
		class="{className} ascii-overlay"
		aria-hidden="true"
		style:visibility={active ? "visible" : "hidden"}
	></canvas>
</button>

<style>
	.ascii-image-container {
		display: block;
		width: 100%;
		padding: 0;
		border: 0;
		background: transparent;
		color: inherit;
		cursor: pointer;
		position: relative;
		overflow: hidden;
	}
	.ascii-image-container:disabled { cursor: default; }
	.ascii-image-container:focus-visible { outline: 2px solid var(--time-accent); outline-offset: -3px; }
	.ascii-image-container > img { display: block; }
	.ascii-overlay { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
</style>
