<script lang="ts">
import { V2_BORDER_OPTIONS } from "@jessepomeroy/print-catalog";
import type { PrintSelection } from "$lib/shop/printSelection.svelte";
let { selection }: { selection: PrintSelection } = $props();
const id = $props.id();
</script>

<div class="space-y-4">
	<div>
		<label for={`${id}-paper`} class="block text-sm text-surface-600 dark:text-surface-300 mb-1">
			Material
		</label>
		<select id={`${id}-paper`} class="block rounded-md border border-surface-300 dark:border-surface-600 bg-transparent text-base py-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-surface-900 dark:focus-visible:outline-surface-50 disabled:opacity-50 w-full" bind:value={selection.paper} disabled={!selection.papers.length}>
			{#each selection.papers as paper (paper.slug)}
				<option value={paper.slug}>{paper.name}</option>
			{/each}
		</select>
	</div>

	<div>
		<label for={`${id}-size`} class="block text-sm text-surface-600 dark:text-surface-300 mb-1">
			Size
		</label>
		<select id={`${id}-size`} class="block rounded-md border border-surface-300 dark:border-surface-600 bg-transparent text-base py-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-surface-900 dark:focus-visible:outline-surface-50 disabled:opacity-50 w-full" bind:value={selection.size} disabled={!selection.sizes.length}>
			{#each selection.sizes as size (size.slug)}
				<option value={size.slug}>{size.label}</option>
			{/each}
		</select>
	</div>

	{#if selection.bordersEnabled}
		<div>
			<label for={`${id}-border`} class="block text-sm text-surface-600 dark:text-surface-300 mb-1">
				Border
			</label>
			<select
				id={`${id}-border`}
				class="block rounded-md border border-surface-300 dark:border-surface-600 bg-transparent text-base py-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-surface-900 dark:focus-visible:outline-surface-50 disabled:opacity-50 w-full"
				bind:value={selection.border}
				disabled={selection.frame !== "none"}
			>
				{#each V2_BORDER_OPTIONS as border (border.value)}
					<option value={border.value}>{border.label}</option>
				{/each}
			</select>
			{#if selection.frame !== "none"}
				<p class="text-xs text-surface-500 mt-1">border included with frame</p>
			{/if}
		</div>
	{/if}

	{#if selection.framesEnabled}
		<div>
			<label for={`${id}-frame`} class="block text-sm text-surface-600 dark:text-surface-300 mb-1">
				Frame
			</label>
			<select id={`${id}-frame`} class="block rounded-md border border-surface-300 dark:border-surface-600 bg-transparent text-base py-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-surface-900 dark:focus-visible:outline-surface-50 disabled:opacity-50 w-full" bind:value={selection.frame}>
				{#each selection.frames as frame (frame.value)}
					<option value={frame.value}>{frame.label}</option>
				{/each}
			</select>
		</div>
	{/if}
</div>
