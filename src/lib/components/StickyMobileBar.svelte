<!--
  Sticky Mobile Bar

  A mobile-only purchase slot. Its single panel docks above navigation while
  the slot is below the viewport, then returns inline without changing the
  document height. Tall panels remain scrollable in either position.

  Props:
    - bottomOffset: distance from viewport bottom when stuck (default: measured bottom-nav height when inside the site layout)
    - class: additional classes on the outer div

  Usage:
    <StickyMobileBar>
      {#snippet children(isStuck)}
        <span>$15</span>
        <button>buy now</button>
      {/snippet}
    </StickyMobileBar>
-->

<script lang="ts">
import { getContext, type Snippet } from "svelte";
import { MOBILE_CHROME, type MobileChrome } from "./mobileNavigation";
const chrome = getContext<MobileChrome | undefined>(MOBILE_CHROME);
let barSize = $state<ResizeObserverSize[]>();
let slotSize = $state<ResizeObserverSize[]>();
let barVisible = $state(false);
let bar = $state<HTMLDivElement>();
let slot = $state<HTMLDivElement>();
let belowViewport = $state(false);
let scrollable = $state(false);

const isStuck = $derived(belowViewport && !!barSize?.[0]?.blockSize && !!slotSize?.[0]?.inlineSize);

function measureOverflow() {
	if (bar) scrollable = bar.scrollHeight > bar.clientHeight;
}

$effect(() => {
	if (barSize) measureOverflow();
});

$effect(() => {
	if (!bar || !chrome) return;
	const observer = new IntersectionObserver(([entry]) => { barVisible = entry.isIntersecting; });
	observer.observe(bar);
	return () => observer.disconnect();
});
$effect(() => {
	if (!chrome) return;
	chrome.purchaseBarHeight = barVisible ? barSize?.[0]?.blockSize ?? 0 : 0;
	chrome.purchaseBarDocked = barVisible && isStuck;
	return () => {
		chrome.purchaseBarHeight = 0;
		chrome.purchaseBarDocked = false;
	};
});

let {
	children,
	bottomOffset = "var(--mobile-nav-height, calc(4rem - 1px))",
	class: extraClass = "",
}: {
	children: Snippet<[boolean]>;
	bottomOffset?: string;
	class?: string;
} = $props();

$effect(() => {
	// Resolve CSS offsets again after nav, font-driven size or prop changes.
	void bottomOffset;
	void chrome?.bottomNavHeight;
	if (!slot || !bar || !barSize?.[0]?.blockSize || !slotSize?.[0]?.inlineSize) {
		belowViewport = false;
		return;
	}
	const offset = Number.parseFloat(getComputedStyle(bar).bottom) || 0;
	let frame = 0;
	let active = true;
	const measure = () => {
		frame = 0;
		if (!active || !bar || !slot) return;
		const currentOffset = Number.parseFloat(getComputedStyle(bar).bottom) || 0;
		belowViewport = slot.getBoundingClientRect().bottom > window.innerHeight - currentOffset;
	};
	const schedule = () => {
		if (active && !frame) frame = requestAnimationFrame(measure);
	};
	const observer = new IntersectionObserver(schedule, {
		threshold: [0, 1], rootMargin: `0px 0px -${offset}px 0px`,
	});
	observer.observe(slot);
	// An above-to-below scroll jump can stay at intersection ratio zero.
	window.addEventListener("scroll", schedule, { passive: true });
	window.addEventListener("resize", schedule);
	schedule();
	return () => {
		active = false;
		observer.disconnect();
		window.removeEventListener("scroll", schedule);
		window.removeEventListener("resize", schedule);
		cancelAnimationFrame(frame);
	};
});
</script>

<div
 bind:this={slot}
 bind:borderBoxSize={slotSize}
 class="sticky-slot"
 style:height={barSize?.[0] ? `${barSize[0].blockSize}px` : undefined}
 style:--purchase-bottom={bottomOffset}
>
<div
 bind:this={bar}
 bind:borderBoxSize={barSize}
	class="sticky-bar {extraClass}"
	class:stuck={isStuck}
	class:scrollable
	style:width={isStuck && slotSize?.[0] ? `${slotSize[0].inlineSize}px` : undefined}
	style:bottom={bottomOffset}
	style:background={isStuck ? "var(--color-surface-900)" : undefined}
	style:box-shadow={isStuck
		? "-50vw 0 0 0 var(--color-surface-900), 50vw 0 0 0 var(--color-surface-900)"
		: undefined}
>
	<div bind:borderBoxSize={null, measureOverflow}>
	{@render children(isStuck)}
	</div>
</div>
</div>
<!-- Keep the existing end marker and surrounding caller-owned flow spacing. -->
<div class="sticky-sentinel"></div>

<style>
  @layer components {
    .sticky-slot { position: relative; min-inline-size: 0; }
    .sticky-bar { --purchase-focus-color: var(--color-surface-900); position: sticky; z-index: 40; max-block-size: max(0px, calc(100dvh - var(--purchase-bottom) - 1rem)); padding-top: 0.5rem; padding-bottom: calc(0.5rem + var(--mobile-purchase-safe-area, 0px)); padding-inline: 0; transition: background-color 200ms cubic-bezier(0.4, 0, 0.2, 1); }
    .sticky-bar.scrollable { overflow: auto; scroll-padding-block: 0.5rem; }
    .sticky-bar.scrollable :global(:focus-visible) { outline-offset: -3px; }
    :global(.dark) .sticky-bar, .sticky-bar.stuck { --purchase-focus-color: var(--color-surface-50); }
    .sticky-bar.stuck { position: fixed; color: var(--color-surface-50); }
    .sticky-sentinel { height: 0; }
    @media (min-width: 48rem) { .sticky-slot, .sticky-bar, .sticky-sentinel { display: none; } }
  }
</style>
