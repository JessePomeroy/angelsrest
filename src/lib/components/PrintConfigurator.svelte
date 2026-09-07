<script lang="ts">
import { V2_BORDER_OPTIONS } from "@jessepomeroy/print-catalog";
import type { PrintSelection } from "$lib/shop/printSelection.svelte";
let { selection }: { selection: PrintSelection } = $props();
const id = $props.id();
</script>

<div class="configuration">
	<div>
		<label for={`${id}-paper`} class="field-label">
			Material
		</label>
		<select id={`${id}-paper`} class="choice" bind:value={selection.paper} disabled={!selection.papers.length}>
			{#each selection.papers as paper (paper.slug)}
				<option value={paper.slug}>{paper.name}</option>
			{/each}
		</select>
	</div>

	<div>
		<label for={`${id}-size`} class="field-label">
			Size
		</label>
		<select id={`${id}-size`} class="choice" bind:value={selection.size} disabled={!selection.sizes.length}>
			{#each selection.sizes as size (size.slug)}
				<option value={size.slug}>{size.label}</option>
			{/each}
		</select>
	</div>

	{#if selection.bordersEnabled}
		<div>
			<label for={`${id}-border`} class="field-label">
				Border
			</label>
			<select
				id={`${id}-border`}
				class="choice"
				bind:value={selection.border}
				disabled={selection.frame !== "none"}
			>
				{#each V2_BORDER_OPTIONS as border (border.value)}
					<option value={border.value}>{border.label}</option>
				{/each}
			</select>
			{#if selection.frame !== "none"}
				<p class="border-note">border included with frame</p>
			{/if}
		</div>
	{/if}

	{#if selection.framesEnabled}
		<div>
			<label for={`${id}-frame`} class="field-label">
				Frame
			</label>
			<select id={`${id}-frame`} class="choice" bind:value={selection.frame}>
				{#each selection.frames as frame (frame.value)}
					<option value={frame.value}>{frame.label}</option>
				{/each}
			</select>
		</div>
	{/if}
</div>

<style>
  @layer components {
    .configuration > :global(:not(:last-child)) { margin-block-start: 0; margin-block-end: 1.0rem; }
    .field-label { display: block; font-size: var(--text-sm); line-height: var(--text-sm--line-height); color: var(--color-surface-600); margin-bottom: 0.25rem; }
    :global(.dark) .field-label { color: var(--color-surface-300); }
    .choice { display: block; border-radius: 0.375rem; border: 1px solid; border-color: var(--color-surface-300); background-color: transparent; font-size: var(--text-base); line-height: var(--text-base--line-height); padding-block: 0.25rem; width: 100%; }
    :global(.dark) .choice { border-color: var(--color-surface-600); }
    .choice:focus-visible { outline-style: solid; outline-width: 2px; outline-offset: 2px; outline-color: var(--color-surface-900); }
    :global(.dark) .choice:focus-visible { outline-color: var(--color-surface-50); }
    .choice:disabled { opacity: 0.5; }
    .border-note { font-size: var(--text-xs); line-height: var(--text-xs--line-height); color: var(--color-surface-500); }
  }
</style>
