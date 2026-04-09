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
	ctx.strokeStyle = "#1a1a1a";
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
	<canvas
		bind:this={canvas}
		{width}
		{height}
		role="img"
		aria-label="Signature drawing area. Use the canvas to draw your signature."
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
		border: 1px solid #ccc;
		border-radius: 4px;
		background: #fff;
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
		border: 1px solid #ccc;
		background: #fff;
		color: #333;
		transition: background 0.15s;
	}

	button:hover {
		background: #f5f5f5;
	}

	button.done {
		background: #1a1a1a;
		color: #fff;
		border-color: #1a1a1a;
	}

	button.done:hover {
		background: #333;
	}

	button:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
</style>
