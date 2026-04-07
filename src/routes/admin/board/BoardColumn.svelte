<script lang="ts">
import { dndzone } from "svelte-dnd-action";

export interface CardItem {
	id: string;
	_id: string;
	name: string;
	email?: string;
	phone?: string;
	category: string;
	type?: string;
	status: string;
	source?: string;
	notes?: string;
	boardColumnId?: string;
	boardPosition?: number;
}

export interface ColumnData {
	id: string;
	name: string;
	position: number;
	cards: CardItem[];
}

interface Props {
	column: ColumnData;
	canDelete: boolean;
	editingColumnId: string | null;
	editingColumnName: string;
	showColumnMenu: string | null;
	onconsider: (columnId: string, e: CustomEvent<{ items: CardItem[] }>) => void;
	onfinalize: (columnId: string, e: CustomEvent<{ items: CardItem[] }>) => void;
	onrename: (columnId: string) => void;
	ondelete: (columnId: string) => void;
	onstartrename: (columnId: string, currentName: string) => void;
	oncancelrename: () => void;
	ontogglemenu: (columnId: string) => void;
	onupdateeditname: (name: string) => void;
	oncardclick: (card: CardItem) => void;
}

let {
	column,
	canDelete,
	editingColumnId,
	editingColumnName,
	showColumnMenu,
	onconsider,
	onfinalize,
	onrename,
	ondelete,
	onstartrename,
	oncancelrename,
	ontogglemenu,
	onupdateeditname,
	oncardclick,
}: Props = $props();

function getCategoryColor(category: string): string {
	return category === "photography"
		? "var(--status-peach)"
		: "var(--status-lavender)";
}
</script>

<div class="board-column">
	<div class="column-header">
		{#if editingColumnId === column.id}
			<form onsubmit={(e) => { e.preventDefault(); onrename(column.id); }} class="rename-form">
				<input
					type="text"
					value={editingColumnName}
					oninput={(e) => onupdateeditname(e.currentTarget.value)}
					class="rename-input"
					onkeydown={(e) => { if (e.key === "Escape") oncancelrename(); }}
				/>
				<button type="submit" class="rename-save">save</button>
			</form>
		{:else}
			<div class="column-title-row">
				<h3 class="column-title">{column.name}</h3>
				<span class="column-count">{column.cards.length}</span>
			</div>
			<div class="column-actions">
				<button
					class="column-menu-btn"
					aria-label="Column options"
					onclick={() => ontogglemenu(column.id)}
				>
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
						<circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>
					</svg>
				</button>
				{#if showColumnMenu === column.id}
					<div class="column-dropdown">
						<button onclick={() => onstartrename(column.id, column.name)}>rename</button>
						{#if canDelete}
							<button class="danger" onclick={() => ondelete(column.id)}>delete</button>
						{/if}
					</div>
				{/if}
			</div>
		{/if}
	</div>

	<div
		class="column-body"
		use:dndzone={{ items: column.cards, type: "card", dropTargetStyle: {} }}
		onconsider={(e) => onconsider(column.id, e)}
		onfinalize={(e) => onfinalize(column.id, e)}
	>
		{#each column.cards as card (card.id)}
			<button class="board-card" onclick={() => oncardclick(card)}>
				<span class="card-name">{card.name}</span>
				<div class="card-meta">
					<span class="category-dot" style="background: {getCategoryColor(card.category)}"></span>
					<span>{card.type || card.category}</span>
				</div>
				{#if card.email}
					<span class="card-email">{card.email}</span>
				{/if}
			</button>
		{/each}
	</div>
</div>

<style>
	.board-column {
		flex: 0 0 280px;
		display: flex;
		flex-direction: column;
		min-height: 200px;
	}

	/* Column header */
	.column-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0 0 14px;
		border-bottom: 1px solid var(--admin-border);
		margin-bottom: 14px;
		position: relative;
	}

	.column-title-row {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.column-title {
		font-family: "Synonym", system-ui, sans-serif;
		font-size: 0.82rem;
		font-weight: 500;
		color: var(--admin-text-muted);
		letter-spacing: 0.03em;
		margin: 0;
	}

	.column-count {
		font-size: 0.72rem;
		color: var(--admin-text-subtle);
		background: var(--admin-surface);
		padding: 2px 7px;
		border-radius: 10px;
	}

	.column-actions {
		position: relative;
	}

	.column-menu-btn {
		background: none;
		border: none;
		cursor: pointer;
		padding: 4px;
		color: var(--admin-text-subtle);
		transition: color 0.15s;
	}

	.column-menu-btn:hover {
		color: var(--admin-text);
	}

	.column-menu-btn svg {
		width: 16px;
		height: 16px;
	}

	.column-dropdown {
		position: absolute;
		top: 100%;
		right: 0;
		background: var(--admin-bg);
		border: 1px solid var(--admin-border-strong);
		border-radius: 6px;
		padding: 4px;
		z-index: 20;
		min-width: 120px;
	}

	.column-dropdown button {
		display: block;
		width: 100%;
		text-align: left;
		background: none;
		border: none;
		color: var(--admin-text);
		padding: 8px 12px;
		font-family: "Synonym", system-ui, sans-serif;
		font-size: 0.82rem;
		cursor: pointer;
		border-radius: 4px;
		text-transform: lowercase;
	}

	.column-dropdown button:hover {
		background: var(--admin-surface);
	}

	.column-dropdown button.danger {
		color: var(--status-rose);
	}

	/* Rename form */
	.rename-form {
		display: flex;
		align-items: center;
		gap: 6px;
		width: 100%;
	}

	.rename-input {
		flex: 1;
		background: var(--admin-surface);
		border: 1px solid var(--admin-border-strong);
		color: var(--admin-text);
		padding: 4px 8px;
		border-radius: 4px;
		font-family: "Synonym", system-ui, sans-serif;
		font-size: 0.82rem;
		text-transform: lowercase;
	}

	.rename-save {
		background: none;
		border: none;
		color: var(--admin-accent);
		font-size: 0.78rem;
		cursor: pointer;
		font-family: "Synonym", system-ui, sans-serif;
		text-transform: lowercase;
	}

	/* Column body (drop zone) */
	.column-body {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 10px;
		min-height: 60px;
	}

	/* Cards */
	.board-card {
		display: block;
		width: 100%;
		text-align: left;
		background: var(--admin-surface-raised);
		border: 1px solid var(--admin-border);
		border-radius: 8px;
		padding: 14px 16px;
		cursor: grab;
		transition: background 0.15s, border-color 0.15s, box-shadow 0.15s;
	}

	.board-card:hover {
		background: rgba(255, 255, 255, 0.07);
		border-color: var(--admin-border-strong);
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
	}

	.board-card:active {
		cursor: grabbing;
	}

	.card-name {
		display: block;
		font-size: 0.88rem;
		font-weight: 500;
		color: var(--admin-heading);
		margin-bottom: 8px;
	}

	.card-meta {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 0.75rem;
		color: var(--admin-text-muted);
	}

	.category-dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		flex-shrink: 0;
	}

	.card-email {
		display: block;
		font-size: 0.72rem;
		color: var(--admin-text-subtle);
		margin-top: 6px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	@media (max-width: 768px) {
		.board-column {
			flex: none;
			width: 100%;
		}

		.board-card {
			cursor: pointer;
		}
	}
</style>
