<!--
  Reactive Gradient Background

  Desktop: two gradient orbs follow the cursor with heavy easing.
  Mobile: CSS animation drifts the orbs around the viewport.
  Colors come from time-theme CSS vars.

  Performance: no blur filters, no SVG filters. Soft edges come from
  wide gradient stops. Positioning via translate3d (compositor-only).
  rAF loop stops when cursor is idle.
-->

<script lang="ts">
import { onMount } from "svelte";

let orbPrimary = $state<HTMLDivElement>();
let orbSecondary = $state<HTMLDivElement>();
let hasMouse = $state(false);

onMount(() => {
	let mouseX = 0.3;
	let mouseY = 0.2;
	let currentX = 0.3;
	let currentY = 0.2;
	let animFrame = 0;
	let idle = true;

	const onMouseMove = (e: MouseEvent) => {
		hasMouse = true;
		mouseX = e.clientX / window.innerWidth;
		mouseY = e.clientY / window.innerHeight;
		if (idle) {
			idle = false;
			animFrame = requestAnimationFrame(animate);
		}
	};

	window.addEventListener("mousemove", onMouseMove, { passive: true });

	function animate() {
		currentX += (mouseX - currentX) * 0.03;
		currentY += (mouseY - currentY) * 0.03;

		// Position via translate3d — compositor-only, no layout thrashing
		const px = currentX * 100;
		const py = currentY * 100;
		if (orbPrimary) {
			orbPrimary.style.transform = `translate3d(${px - 50}vw, ${py - 50}vh, 0)`;
		}
		if (orbSecondary) {
			orbSecondary.style.transform = `translate3d(${(100 - px) - 50}vw, ${(100 - py) - 50}vh, 0)`;
		}

		// Stop looping once converged (within 0.1% of target)
		if (Math.abs(mouseX - currentX) > 0.001 || Math.abs(mouseY - currentY) > 0.001) {
			animFrame = requestAnimationFrame(animate);
		} else {
			idle = true;
		}
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
		<div class="orb orb-primary" bind:this={orbPrimary}></div>
		<div class="orb orb-secondary" bind:this={orbSecondary}></div>
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
		will-change: transform;
	}

	.orb-primary {
		width: 100vmax;
		height: 100vmax;
		opacity: 0.8;
		background: radial-gradient(
			circle,
			var(--time-glow, rgba(129, 140, 248, 0.28)) 0%,
			var(--time-glow, rgba(129, 140, 248, 0.18)) 15%,
			var(--time-glow, rgba(129, 140, 248, 0.10)) 30%,
			var(--time-glow, rgba(129, 140, 248, 0.04)) 45%,
			transparent 60%
		);
	}

	.orb-secondary {
		width: 80vmax;
		height: 80vmax;
		opacity: 0.6;
		background: radial-gradient(
			circle,
			var(--time-tint, rgba(167, 139, 250, 0.22)) 0%,
			var(--time-tint, rgba(167, 139, 250, 0.14)) 15%,
			var(--time-tint, rgba(167, 139, 250, 0.07)) 30%,
			var(--time-tint, rgba(167, 139, 250, 0.02)) 45%,
			transparent 60%
		);
	}

	@keyframes drift-1 {
		0%, 100% { transform: translate3d(-20vw, -30vh, 0); }
		25% { transform: translate3d(15vw, -10vh, 0); }
		50% { transform: translate3d(-10vw, 20vh, 0); }
		75% { transform: translate3d(-30vw, -5vh, 0); }
	}

	@keyframes drift-2 {
		0%, 100% { transform: translate3d(20vw, 25vh, 0); }
		25% { transform: translate3d(-15vw, 0vh, 0); }
		50% { transform: translate3d(10vw, -25vh, 0); }
		75% { transform: translate3d(30vw, 5vh, 0); }
	}

	.animate-drift-1 {
		animation: drift-1 45s ease-in-out infinite;
	}

	.animate-drift-2 {
		animation: drift-2 55s ease-in-out infinite;
	}
</style>
