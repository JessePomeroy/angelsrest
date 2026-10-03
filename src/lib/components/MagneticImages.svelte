<script lang="ts">
import type { Snippet } from "svelte";
import { on } from "svelte/events";

let { children }: { children: Snippet } = $props();

// Animate offsets so CSS anchors keep following layout changes.
// Native anchor animation gap: https://bugzilla.mozilla.org/show_bug.cgi?id=1924226
function animateFrame(frame: HTMLElement, from: DOMRect, to: DOMRect) {
	const margin = [
		from.top - to.top, to.right - from.right,
		to.bottom - from.bottom, from.left - to.left,
	].map(value => `${value}px`).join(" ");

	return frame.animate({ margin: [margin, "0px"] }, {
		duration: 320,
		easing: "cubic-bezier(0.16, 1, 0.3, 1)",
	});
}

// Mark controls with data-magnetic-item; a nested data-magnetic-target limits the frame to its image.
// Keep the last anchor across gutters so one frame travels between photographs.
function trackImages(node: HTMLDivElement) {
	if (!CSS.supports("(anchor-scope: --magnetic-image) and (inset: anchor(inside))")) return;
	const frame = node.querySelector<HTMLElement>(".magnetic-indicator");
	if (!frame) return;

	const hover = matchMedia("(hover: hover) and (pointer: fine)");
	const motion = matchMedia(
		"(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)",
	);
	let anchor: HTMLElement | null = null;
	let animation: Animation | undefined;

	const stopAnimation = () => animation?.cancel();
	const itemFrom = (target: EventTarget | null) => {
		const item = target instanceof Element ? target.closest<HTMLElement>("[data-magnetic-item]") : null;
		return item && node.contains(item) ? item : null;
	};
	const focusedItem = () => document.activeElement?.matches(":focus-visible")
		? itemFrom(document.activeElement) : null;
	const hoveredItem = () => hover.matches
		? node.querySelector<HTMLElement>("[data-magnetic-item]:hover") : null;

	const highlight = (item: HTMLElement | null) => {
		const target = item?.querySelector<HTMLElement>("[data-magnetic-target]") ?? item;
		// The visibility marker can be gone while the frame is still fading.
		const wasVisible = node.contains(anchor) &&
			(node.hasAttribute("data-magnetic-visible") || Number(getComputedStyle(frame).opacity) > 0);
		node.toggleAttribute("data-magnetic-visible", item !== null);
		if (!target) return;
		if (target === anchor) return;

		const shouldAnimate = motion.matches && wasVisible;
		const from = shouldAnimate ? frame.getBoundingClientRect() : null;
		const to = shouldAnimate ? target.getBoundingClientRect() : null;
		stopAnimation();
		anchor?.removeAttribute("data-magnetic-anchor");
		anchor = target;
		anchor.setAttribute("data-magnetic-anchor", "");
		if (!from || !to) return;
		animation = animateFrame(frame, from, to);
	};

	const cleanup = [
		on(node, "pointerover", event => {
			const item = itemFrom(event.target);
			if (!item || event.pointerType === "touch" || !hover.matches || focusedItem()) return;
			highlight(item);
		}),
		on(node, "pointerleave", () => highlight(focusedItem())),
		on(node, "focusin", () => highlight(focusedItem() ?? hoveredItem())),
		on(node, "focusout", event => {
			if (itemFrom(event.relatedTarget)) return;
			highlight(null);
		}),
		on(motion, "change", stopAnimation),
	];

	return () => {
		cleanup.forEach(dispose => dispose());
		stopAnimation();
		anchor?.removeAttribute("data-magnetic-anchor");
	};
}
</script>

<div class="magnetic-images" {@attach trackImages}>
	{@render children()}
	<div class="magnetic-indicator" aria-hidden="true"></div>
</div>

<style>
	.magnetic-images { position: relative; anchor-scope: --magnetic-image; --magnetic-opacity: 0; }
	.magnetic-images :global([data-magnetic-item]:hover) { opacity: 1; }
	.magnetic-indicator {
		display: none; position: absolute; position-anchor: --magnetic-image; inset: anchor(inside);
		pointer-events: none; z-index: 1; opacity: var(--magnetic-opacity);
		border: 2px solid var(--time-accent, currentColor); border-radius: var(--magnetic-radius, 0);
		background: color-mix(in srgb, var(--time-accent, currentColor) 5%, transparent);
		transition: opacity 120ms ease-out;
	}
	.magnetic-images:global([data-magnetic-visible]):has(:global([data-magnetic-anchor])) { --magnetic-opacity: 1; }
	@media (hover: hover) and (pointer: fine) {
		.magnetic-images :global([data-magnetic-item]:hover) { outline: 2px solid var(--time-accent, currentColor); outline-offset: 3px; }
	}
	@supports (anchor-scope: --magnetic-image) and (inset: anchor(inside)) {
		.magnetic-images :global([data-magnetic-anchor]) { anchor-name: --magnetic-image; }
		.magnetic-images :global([data-magnetic-item]:hover) { outline: none; }
		.magnetic-indicator { display: block; }
	}
	@media (hover: none), (pointer: coarse) {
		.magnetic-indicator { display: none; }
	}
	.magnetic-images :global([data-magnetic-item]:focus-visible) { outline: 2px solid currentColor; outline-offset: 3px; }
</style>
