<script lang="ts">
import { navigating } from "$app/state";

let visible = $state(false);

$effect(() => {
	const destination = navigating.to;
	visible = false;
	if (!destination) return;
	const timeout = setTimeout(() => { visible = true; }, 250);
	return () => clearTimeout(timeout);
});
</script>

<div class="navigation-status" role="status" aria-live="polite" aria-atomic="true">
	{#if visible}<span>Loading page…</span>{/if}
</div>

<style>
	.navigation-status { position: fixed; top: 1rem; left: 50%; transform: translateX(-50%); z-index: 70; pointer-events: none; }
	.navigation-status span { display: block; padding: 0.5rem 0.9rem; border: 1px solid var(--color-surface-400); border-radius: 0.375rem; background: var(--color-surface-50); color: var(--color-surface-900); font-size: var(--text-sm); }
	:global(.dark) .navigation-status span { background: var(--color-surface-900); color: var(--color-surface-50); }
</style>
