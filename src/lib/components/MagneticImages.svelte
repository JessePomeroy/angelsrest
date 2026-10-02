<script lang="ts">
import type { Snippet } from "svelte";

let { children }: { children: Snippet } = $props();

// Mark links/buttons with data-magnetic-item. A nested data-magnetic-target
// limits the frame to the photograph when a card also contains a caption.
// Keep the last anchor across gutters so one frame travels between photographs.
// Geometry, lazy-image resizing and responsive reflow remain owned by CSS.
function trackImages(node: HTMLDivElement) {
	const hover = window.matchMedia("(hover: hover) and (pointer: fine)");
	let anchor: HTMLElement | null = null;

	function itemFrom(target: EventTarget | null) {
		const item = target instanceof Element ? target.closest<HTMLElement>("[data-magnetic-item]") : null;
		return item && node.contains(item) ? item : null;
	}

	function keyboardItem() {
		return document.activeElement?.matches(":focus-visible") ? itemFrom(document.activeElement) : null;
	}

	function select(item: HTMLElement | null) {
		node.toggleAttribute("data-magnetic-visible", item !== null);
		if (!item) return;
		const target = item.querySelector<HTMLElement>("[data-magnetic-target]") ?? item;
		if (target === anchor) return;
		anchor?.removeAttribute("data-magnetic-anchor");
		anchor = target;
		anchor.setAttribute("data-magnetic-anchor", "");
	}

	function onPointerOver(event: PointerEvent) {
		if (event.pointerType === "touch" || !hover.matches || keyboardItem()) return;
		const item = itemFrom(event.target);
		if (item) select(item);
	}

	function onPointerLeave() {
		select(keyboardItem());
	}

	function onFocusIn() {
		select(keyboardItem() ?? (hover.matches ? node.querySelector<HTMLElement>("[data-magnetic-item]:hover") : null));
	}

	function onFocusOut(event: FocusEvent) {
		if (!itemFrom(event.relatedTarget)) select(null);
	}

	node.addEventListener("pointerover", onPointerOver);
	node.addEventListener("pointerleave", onPointerLeave);
	node.addEventListener("focusin", onFocusIn);
	node.addEventListener("focusout", onFocusOut);
	return {
		destroy() {
			node.removeEventListener("pointerover", onPointerOver);
			node.removeEventListener("pointerleave", onPointerLeave);
			node.removeEventListener("focusin", onFocusIn);
			node.removeEventListener("focusout", onFocusOut);
			anchor?.removeAttribute("data-magnetic-anchor");
		},
	};
}
</script>

<div class="magnetic-images" use:trackImages>
	{@render children()}
	<div class="magnetic-indicator" aria-hidden="true"></div>
</div>

<style>
	.magnetic-images { position: relative; anchor-scope: --magnetic-image; }
	.magnetic-indicator { display: none; pointer-events: none; }
	/* The shared frame replaces the site's ordinary link-hover dimming. */
	.magnetic-images :global([data-magnetic-item]:hover) { opacity: 1; }

	/* Focus stays immediate and visible, including without scripting or anchors. */
	.magnetic-images :global([data-magnetic-item]:focus-visible) {
		outline: 2px solid currentColor;
		outline-offset: 3px;
	}

	@supports (anchor-scope: --magnetic-image) and (inset: anchor(inside)) {
		.magnetic-images :global([data-magnetic-anchor]) { anchor-name: --magnetic-image; }
		.magnetic-indicator {
			display: block;
			position: absolute;
			position-anchor: --magnetic-image;
			inset: anchor(inside);
			z-index: 1;
			border: 2px solid var(--time-accent, currentColor);
			border-radius: var(--magnetic-radius, 0);
			background: color-mix(in srgb, var(--time-accent, currentColor) 5%, transparent);
			opacity: 0;
			transition: opacity 120ms ease-out;
		}
		.magnetic-images:global([data-magnetic-visible]):has(:global([data-magnetic-anchor])) > .magnetic-indicator { opacity: 1; }
		@media (hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference) {
			.magnetic-images:global([data-magnetic-visible]) > .magnetic-indicator {
				transition: inset 320ms cubic-bezier(0.16, 1, 0.3, 1), opacity 120ms ease-out;
			}
		}
	}

	/* Touch browsers can restore :focus-visible after closing a dialog. Keep the
	   ordinary focus outline there, without leaving a decorative hover overlay. */
	@media (hover: none), (pointer: coarse) {
		.magnetic-indicator { display: none; }
	}

	@supports not ((anchor-scope: --magnetic-image) and (inset: anchor(inside))) {
		@media (hover: hover) and (pointer: fine) {
			.magnetic-images :global([data-magnetic-item]:hover) {
				outline: 2px solid var(--time-accent, currentColor);
				outline-offset: 3px;
			}
		}
	}
</style>
