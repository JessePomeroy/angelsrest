<!--
  Reactive Gradient Background

  Desktop: two gradient orbs follow the cursor with heavy easing.
  Mobile: CSS animation drifts the orbs around the viewport.
  Colors come from time-theme CSS vars (currently hardcoded golden for testing).
-->

<script lang="ts">
import { onMount } from "svelte";
import { browser } from "$app/environment";

let currentX = $state(0.3);
let currentY = $state(0.2);
let hasMouse = $state(false);
let animFrame: number;

onMount(() => {
	let mouseX = 0.3;
	let mouseY = 0.2;

	const onMouseMove = (e: MouseEvent) => {
		hasMouse = true;
		mouseX = e.clientX / window.innerWidth;
		mouseY = e.clientY / window.innerHeight;
	};

	window.addEventListener("mousemove", onMouseMove, { passive: true });

	const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

	function animate() {
		if (hasMouse) {
			currentX = lerp(currentX, mouseX, 0.03);
			currentY = lerp(currentY, mouseY, 0.03);
		}
		animFrame = requestAnimationFrame(animate);
	}

	if (browser) {
		animFrame = requestAnimationFrame(animate);
	}

	return () => {
		window.removeEventListener("mousemove", onMouseMove);
		cancelAnimationFrame(animFrame);
	};
});
</script>

<div
	class="fixed inset-0 -z-10 pointer-events-none"
	aria-hidden="true"
>
	{#if hasMouse}
		<!-- Desktop: cursor-following orbs -->
		<div
			class="orb orb-primary"
			style:left="{currentX * 100}%"
			style:top="{currentY * 100}%"
		></div>
		<div
			class="orb orb-secondary"
			style:left="{(1 - currentX) * 100}%"
			style:top="{(1 - currentY) * 100}%"
		></div>
	{:else}
		<!-- Mobile: CSS-animated drifting orbs -->
		<div class="orb orb-primary animate-drift-1"></div>
		<div class="orb orb-secondary animate-drift-2"></div>
	{/if}
</div>

<style>
	.orb {
		position: absolute;
		border-radius: 50%;
		transform: translate(-50%, -50%);
	}

	.orb-primary {
		width: 90vmax;
		height: 90vmax;
		filter: blur(80px);
		opacity: 0.8;
		background: radial-gradient(
			circle,
			var(--time-glow, rgba(129, 140, 248, 0.28)) 0%,
			var(--time-glow, rgba(129, 140, 248, 0.2)) 20%,
			var(--time-glow, rgba(129, 140, 248, 0.12)) 40%,
			var(--time-glow, rgba(129, 140, 248, 0.05)) 55%,
			transparent 70%
		);
		filter: blur(80px);
	}

	.orb-secondary {
		width: 70vmax;
		height: 70vmax;
		opacity: 0.6;
		background: radial-gradient(
			circle,
			var(--time-tint, rgba(167, 139, 250, 0.22)) 0%,
			var(--time-tint, rgba(167, 139, 250, 0.16)) 20%,
			var(--time-tint, rgba(167, 139, 250, 0.09)) 40%,
			var(--time-tint, rgba(167, 139, 250, 0.03)) 55%,
			transparent 70%
		);
		filter: blur(60px);
	}

	@keyframes drift-1 {
		0%, 100% { left: 30%; top: 20%; }
		25% { left: 65%; top: 40%; }
		50% { left: 40%; top: 70%; }
		75% { left: 20%; top: 45%; }
	}

	@keyframes drift-2 {
		0%, 100% { left: 70%; top: 75%; }
		25% { left: 35%; top: 50%; }
		50% { left: 60%; top: 25%; }
		75% { left: 80%; top: 55%; }
	}

	.animate-drift-1 {
		animation: drift-1 45s ease-in-out infinite;
	}

	.animate-drift-2 {
		animation: drift-2 55s ease-in-out infinite;
	}
</style>
