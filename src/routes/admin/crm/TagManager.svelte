<script lang="ts">
import AdminModal from "$lib/admin/components/AdminModal.svelte";
import type { ClientTag } from "$lib/admin/types";

interface Props {
	tags: ClientTag[];
	saving: boolean;
	oncreate: (name: string, color: string) => void;
	ondelete: (tagId: string) => void;
	onclose: () => void;
}

let { tags, saving, oncreate, ondelete, onclose }: Props = $props();

let newTagName = $state("");
let newTagColor = $state("#818cf8");

const tagColors = [
	"#818cf8",
	"#f472b6",
	"#34d399",
	"#fbbf24",
	"#fb923c",
	"#a78bfa",
	"#38bdf8",
	"#f87171",
	"#4ade80",
	"#c084fc",
];

function handleCreate() {
	if (!newTagName) return;
	oncreate(newTagName, newTagColor);
	newTagName = "";
	newTagColor = "#818cf8";
}
</script>

<AdminModal title="manage tags" onclose={onclose} size="narrow">
	<div class="tag-manager-body">
		<form class="tag-create-form" onsubmit={(e) => { e.preventDefault(); handleCreate(); }}>
			<input
				class="form-input tag-name-input"
				type="text"
				placeholder="new tag name..."
				bind:value={newTagName}
			/>
			<div class="tag-color-picker">
				{#each tagColors as color}
					<button
						type="button"
						class="color-swatch"
						class:selected={newTagColor === color}
						style="background: {color}"
						onclick={() => { newTagColor = color; }}
						aria-label="Select color {color}"
					></button>
				{/each}
			</div>
			<button type="submit" class="btn-save" disabled={saving || !newTagName}>
				{saving ? "creating..." : "create tag"}
			</button>
		</form>

		{#if tags.length > 0}
			<div class="tag-list">
				{#each tags as tag (tag._id)}
					<div class="tag-list-item">
						<span class="tag-dot-inline" style="background: {tag.color || '#818cf8'}"></span>
						<span class="tag-list-name">{tag.name}</span>
						<button class="tag-delete-btn" onclick={() => ondelete(tag._id)} aria-label="Delete tag {tag.name}">
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
						</button>
					</div>
				{/each}
			</div>
		{:else}
			<div class="no-tags-text">no tags created yet</div>
		{/if}
	</div>
</AdminModal>

<style>
	.tag-manager-body {
		padding: 0 28px 28px;
		display: flex;
		flex-direction: column;
		gap: 20px;
	}

	.tag-create-form {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.form-input {
		padding: 8px 10px;
		background: rgba(255, 255, 255, 0.03);
		color: var(--admin-text);
		border: 1px solid var(--admin-border-strong);
		border-radius: 6px;
		font-size: 0.85rem;
		font-family: "Synonym", system-ui, sans-serif;
		outline: none;
		transition: border-color 0.15s;
	}

	.form-input:focus {
		border-color: var(--admin-accent);
	}

	.tag-name-input {
		width: 100%;
	}

	.tag-color-picker {
		display: flex;
		gap: 6px;
		flex-wrap: wrap;
	}

	.color-swatch {
		width: 22px;
		height: 22px;
		border-radius: 50%;
		border: 2px solid transparent;
		cursor: pointer;
		transition: border-color 0.15s, transform 0.15s;
	}

	.color-swatch:hover {
		transform: scale(1.15);
	}

	.color-swatch.selected {
		border-color: var(--admin-heading);
	}

	.btn-save {
		padding: 7px 16px;
		border-radius: 6px;
		font-size: 0.82rem;
		font-family: "Synonym", system-ui, sans-serif;
		cursor: pointer;
		transition: background 0.15s, border-color 0.15s, opacity 0.15s;
		border: 1px solid transparent;
		background: rgba(129, 140, 248, 0.15);
		border-color: rgba(129, 140, 248, 0.25);
		color: var(--admin-accent-hover);
		font-weight: 500;
	}

	.btn-save:hover {
		background: rgba(129, 140, 248, 0.22);
	}

	.btn-save:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.tag-list {
		display: flex;
		flex-direction: column;
		gap: 0;
	}

	.tag-list-item {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 10px 0;
		border-bottom: 1px solid var(--admin-border);
	}

	.tag-list-item:last-child {
		border-bottom: none;
	}

	.tag-dot-inline {
		display: inline-block;
		width: 8px;
		height: 8px;
		border-radius: 50%;
		flex-shrink: 0;
	}

	.tag-list-name {
		flex: 1;
		font-size: 0.85rem;
		color: var(--admin-text);
	}

	.tag-delete-btn {
		background: none;
		border: none;
		color: var(--admin-text-subtle);
		cursor: pointer;
		padding: 4px;
		border-radius: 4px;
		transition: color 0.15s;
	}

	.tag-delete-btn:hover {
		color: var(--status-rose);
	}

	.no-tags-text {
		font-size: 0.76rem;
		color: var(--admin-text-subtle);
	}

	@media (max-width: 768px) {
		.tag-manager-body {
			padding: 0 20px 20px;
		}
	}
</style>
