<!--
  Sticky Mobile Bar

  A mobile-only bar that lives inline in the document flow and sticks
  above the bottom nav when scrolled past. Uses CSS sticky for smooth,
  reflow-free positioning and an IntersectionObserver to toggle the
  dark background + box-shadow bleed when stuck.

  Props:
    - bottomOffset: distance from viewport bottom when stuck (default: 4rem - 1px for bottom nav)
    - class: additional classes on the outer div

  Usage:
    <StickyMobileBar>
      {#snippet children(isStuck)}
        <span class={isStuck ? 'text-white' : ''}>$15</span>
        <button>buy now</button>
      {/snippet}
    </StickyMobileBar>
-->

<script lang="ts">
import type { Snippet } from "svelte";

let {
	children,
	bottomOffset = "calc(4rem - 1px)",
	class: extraClass = "",
}: {
	children: Snippet<[boolean]>;
	bottomOffset?: string;
	class?: string;
} = $props();

let sentinel: HTMLDivElement | undefined = $state();
let isStuck = $state(false);

$effect(() => {
	if (!sentinel) return;
	const observer = new IntersectionObserver(
		([entry]) => {
			isStuck = !entry.isIntersecting;
		},
		{ threshold: 0, rootMargin: "0px 0px -64px 0px" },
	);
	observer.observe(sentinel);
	return () => observer.disconnect();
});
</script>

<div
	class="md:hidden sticky z-40 py-2 px-4 transition-all duration-200 {isStuck ? 'text-surface-50' : ''} {extraClass}"
	style:bottom={bottomOffset}
	style:background={isStuck ? "var(--color-surface-900)" : undefined}
	style:box-shadow={isStuck
		? "-50vw 0 0 0 var(--color-surface-900), 50vw 0 0 0 var(--color-surface-900)"
		: undefined}
>
	{@render children(isStuck)}
</div>
<!-- Sentinel: placed after the bar so observer fires when the bar's bottom reaches the nav -->
<div bind:this={sentinel} class="md:hidden h-0"></div>
