<script lang="ts">
import { onMount } from "svelte";

interface Props {
	onSign: (data: string) => void;
	width?: number;
	height?: number;
}

let { onSign, width = 400, height = 150 }: Props = $props();
let canvas: HTMLCanvasElement;
let ctx: CanvasRenderingContext2D;
let drawing = $state(false);
let hasDrawn = $state(false);

onMount(() => {
	ctx = canvas.getContext("2d")!;
	// Read the themed surface-900 so the stroke follows the theme instead of
	// being hardcoded. Fall back to a dark grey if the var isn't set.
	const strokeColor = getComputedStyle(canvas)
		.getPropertyValue("--color-surface-900")
		.trim() || "#1a1a1a";
	ctx.strokeStyle = strokeColor;
	ctx.lineWidth = 2;
	ctx.lineCap = "round";
	ctx.lineJoin = "round";
});

function getPos(e: MouseEvent | TouchEvent): { x: number; y: number } {
	const rect = canvas.getBoundingClientRect();
	const scaleX = canvas.width / rect.width;
	const scaleY = canvas.height / rect.height;

	if ("touches" in e) {
		const touch = e.touches[0];
		return {
			x: (touch.clientX - rect.left) * scaleX,
			y: (touch.clientY - rect.top) * scaleY,
		};
	}
	return {
		x: (e.clientX - rect.left) * scaleX,
		y: (e.clientY - rect.top) * scaleY,
	};
}

function startDraw(e: MouseEvent | TouchEvent) {
	e.preventDefault();
	drawing = true;
	const pos = getPos(e);
	ctx.beginPath();
	ctx.moveTo(pos.x, pos.y);
}

function draw(e: MouseEvent | TouchEvent) {
	if (!drawing) return;
	e.preventDefault();
	hasDrawn = true;
	const pos = getPos(e);
	ctx.lineTo(pos.x, pos.y);
	ctx.stroke();
}

function stopDraw() {
	drawing = false;
}

function clear() {
	ctx.clearRect(0, 0, canvas.width, canvas.height);
	hasDrawn = false;
}

function done() {
	if (!hasDrawn) return;
	onSign(canvas.toDataURL("image/png"));
}
</script>

<div class="signature-pad">
	<!--
		A signature canvas is an interactive drawing surface, not static
		content. role="img" is wrong (implies read-only) and Svelte flags
		it. Leaving the role off lets the canvas be treated as a custom
		widget; aria-label still describes its purpose to screen readers,
		and the "clear" / "done" buttons below give keyboard-only users a
		way to interact without drawing.
	-->
	<canvas
		bind:this={canvas}
		{width}
		{height}
		aria-label="Signature drawing area. Use the canvas to draw your signature, or the buttons below to clear or accept."
		onmousedown={startDraw}
		onmousemove={draw}
		onmouseup={stopDraw}
		onmouseleave={stopDraw}
		ontouchstart={startDraw}
		ontouchmove={draw}
		ontouchend={stopDraw}
	></canvas>
	<div class="actions">
		<button type="button" class="clear" onclick={clear} aria-label="Clear signature">clear</button>
		<button type="button" class="done" onclick={done} disabled={!hasDrawn} aria-label="Accept signature">done</button>
	</div>
</div>

<style>
	.signature-pad {
		display: inline-flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	canvas {
		border: 1px solid var(--color-surface-300, #ccc);
		border-radius: 4px;
		background: var(--color-surface-50, #fff);
		cursor: crosshair;
		touch-action: none;
		max-width: 100%;
		height: auto;
	}

	.actions {
		display: flex;
		gap: 0.5rem;
		justify-content: flex-end;
	}

	button {
		padding: 0.375rem 1rem;
		font-size: 0.8125rem;
		border-radius: 4px;
		cursor: pointer;
		border: 1px solid var(--color-surface-300, #ccc);
		background: var(--color-surface-50, #fff);
		color: var(--color-surface-800, #333);
		transition: background 0.15s;
	}

	button:hover {
		background: var(--color-surface-100, #f5f5f5);
	}

	button.done {
		background: var(--color-surface-900, #1a1a1a);
		color: var(--color-surface-50, #fff);
		border-color: var(--color-surface-900, #1a1a1a);
	}

	button.done:hover {
		background: var(--color-surface-700, #333);
	}

	button:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
</style>
