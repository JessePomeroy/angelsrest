<!--
  Sticky Mobile Bar

  A mobile-only bar that lives inline in the document flow and sticks
  above the bottom nav when scrolled past. Uses CSS sticky for smooth,
  reflow-free positioning and an IntersectionObserver to toggle the
  dark background + box-shadow bleed when stuck.

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
let barVisible = $state(false);
let bar = $state<HTMLDivElement>();

$effect(() => {
	if (!bar || !chrome) return;
	const observer = new IntersectionObserver(([entry]) => { barVisible = entry.isIntersecting; });
	observer.observe(bar);
	return () => observer.disconnect();
});
$effect(() => {
	if (!chrome) return;
	chrome.purchaseBarHeight = barVisible ? barSize?.[0]?.blockSize ?? 0 : 0;
	return () => { chrome.purchaseBarHeight = 0; };
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

let sentinel: HTMLDivElement | undefined = $state();
let isStuck = $state(false);

$effect(() => {
	if (!chrome) return;
	chrome.purchaseBarDocked = barVisible && isStuck;
	return () => { chrome.purchaseBarDocked = false; };
});

$effect(() => {
	if (!sentinel) return;
	const observer = new IntersectionObserver(
		([entry]) => {
			isStuck = !entry.isIntersecting;
		},
		{ threshold: 0, rootMargin: `0px 0px -${chrome?.bottomNavHeight ?? 64}px 0px` },
	);
	observer.observe(sentinel);
	return () => observer.disconnect();
});
</script>

<div
 bind:this={bar}
 bind:borderBoxSize={barSize}
	class="sticky-bar {extraClass}"
	class:stuck={isStuck}
	style:bottom={bottomOffset}
	style:background={isStuck ? "var(--color-surface-900)" : undefined}
	style:box-shadow={isStuck
		? "-50vw 0 0 0 var(--color-surface-900), 50vw 0 0 0 var(--color-surface-900)"
		: undefined}
>
	{@render children(isStuck)}
</div>
<!-- Sentinel: placed after the bar so observer fires when the bar's bottom reaches the nav -->
<div bind:this={sentinel} class="sticky-sentinel"></div>

<style>
  @layer components {
    .sticky-bar { position: sticky; z-index: 40; padding-top: 0.5rem; padding-bottom: calc(0.5rem + var(--mobile-purchase-safe-area, 0px)); padding-inline: 1rem; transition: background-color 200ms cubic-bezier(0.4, 0, 0.2, 1); }
    .sticky-bar.stuck { color: var(--color-surface-50); }
    .sticky-sentinel { height: 0; }
    @media (min-width: 48rem) { .sticky-bar, .sticky-sentinel { display: none; } }
  }
</style>
