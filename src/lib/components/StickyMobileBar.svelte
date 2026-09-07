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
        <span>$15</span>
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
    .sticky-bar { position: sticky; z-index: 40; padding-block: 0.5rem; padding-inline: 1rem; transition: all 200ms cubic-bezier(0.4, 0, 0.2, 1); }
    .sticky-bar.stuck { color: var(--color-surface-50); }
    .sticky-sentinel { height: 0; }
    @media (min-width: 48rem) { .sticky-bar, .sticky-sentinel { display: none; } }
  }
</style>
