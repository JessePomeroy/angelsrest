<script lang="ts">
import type { Snippet } from "svelte";

interface FilterOption {
	value: string;
	label: string;
}

interface FilterConfig {
	options: FilterOption[];
	value: string;
	allLabel: string;
	onchange: (value: string) => void;
}

interface Props {
	filters: FilterConfig[];
	searchQuery: string;
	searchPlaceholder?: string;
	onsearch: (query: string) => void;
	actions?: Snippet;
}

let {
	filters,
	searchQuery,
	searchPlaceholder = "search...",
	onsearch,
	actions,
}: Props = $props();
</script>

<div class="filter-bar">
	<div class="filter-controls">
		{#each filters as filter}
			<select
				class="filter-select"
				value={filter.value}
				onchange={(e) => filter.onchange(e.currentTarget.value)}
			>
				<option value="all">{filter.allLabel}</option>
				{#each filter.options as opt}
					<option value={opt.value}>{opt.label}</option>
				{/each}
			</select>
		{/each}

		<input
			type="text"
			class="filter-search"
			placeholder={searchPlaceholder}
			value={searchQuery}
			oninput={(e) => onsearch(e.currentTarget.value)}
		/>
	</div>

	{#if actions}
		<div class="filter-actions">
			{@render actions()}
		</div>
	{/if}
</div>

<style>
	.filter-bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		margin-bottom: 24px;
		flex-wrap: wrap;
	}

	.filter-controls {
		display: flex;
		align-items: center;
		gap: 10px;
		flex-wrap: wrap;
	}

	.filter-select {
		padding: 7px 10px;
		background: rgba(255, 255, 255, 0.03);
		color: var(--admin-text);
		border: 1px solid var(--admin-border-strong);
		border-radius: 6px;
		font-size: 0.82rem;
		font-family: "Synonym", system-ui, sans-serif;
		text-transform: lowercase;
		cursor: pointer;
		outline: none;
	}

	.filter-select option {
		background: var(--admin-bg);
	}

	.filter-search {
		padding: 7px 10px;
		background: rgba(255, 255, 255, 0.03);
		color: var(--admin-text);
		border: 1px solid var(--admin-border-strong);
		border-radius: 6px;
		font-size: 0.82rem;
		font-family: "Synonym", system-ui, sans-serif;
		outline: none;
		min-width: 160px;
		transition: border-color 0.15s;
	}

	.filter-search:focus {
		border-color: var(--admin-accent);
	}

	.filter-search::placeholder {
		color: var(--admin-text-subtle);
	}

	.filter-actions {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	@media (max-width: 768px) {
		.filter-bar {
			flex-direction: column;
			align-items: stretch;
		}

		.filter-controls {
			flex-direction: column;
		}

		.filter-select,
		.filter-search {
			width: 100%;
		}
	}
</style>
