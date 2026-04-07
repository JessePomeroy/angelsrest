<script lang="ts">
import AdminModal from "$lib/admin/components/AdminModal.svelte";

interface CardItem {
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

interface Props {
	client: CardItem;
	onclose: () => void;
}

let { client, onclose }: Props = $props();

function getCategoryColor(category: string): string {
	return category === "photography"
		? "var(--status-peach)"
		: "var(--status-lavender)";
}
</script>

<AdminModal title={client.name} {onclose}>
	<div class="modal-body">
		<div class="detail-grid">
			{#if client.email}
				<div class="detail-row">
					<span class="detail-label">email</span>
					<span class="detail-value">{client.email}</span>
				</div>
			{/if}
			{#if client.phone}
				<div class="detail-row">
					<span class="detail-label">phone</span>
					<span class="detail-value">{client.phone}</span>
				</div>
			{/if}
			<div class="detail-row">
				<span class="detail-label">category</span>
				<span class="detail-value">
					<span class="category-dot" style="background: {getCategoryColor(client.category)}"></span>
					{client.category}
				</span>
			</div>
			{#if client.type}
				<div class="detail-row">
					<span class="detail-label">type</span>
					<span class="detail-value">{client.type}</span>
				</div>
			{/if}
			<div class="detail-row">
				<span class="detail-label">status</span>
				<span class="detail-value">{client.status}</span>
			</div>
			{#if client.source}
				<div class="detail-row">
					<span class="detail-label">source</span>
					<span class="detail-value">{client.source}</span>
				</div>
			{/if}
			{#if client.notes}
				<div class="detail-row">
					<span class="detail-label">notes</span>
					<span class="detail-value">{client.notes}</span>
				</div>
			{/if}
		</div>
		<div class="modal-footer">
			<a href="/admin/crm" class="link-btn">manage in clients →</a>
		</div>
	</div>
</AdminModal>

<style>
	.modal-body {
		display: flex;
		flex-direction: column;
		gap: 16px;
		padding: 0 28px 28px;
	}

	.detail-grid {
		display: flex;
		flex-direction: column;
		gap: 14px;
	}

	.detail-row {
		display: flex;
		align-items: flex-start;
		gap: 12px;
	}

	.detail-label {
		font-size: 0.78rem;
		color: var(--admin-text-subtle);
		min-width: 70px;
		flex-shrink: 0;
	}

	.detail-value {
		font-size: 0.85rem;
		color: var(--admin-text);
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.category-dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		flex-shrink: 0;
	}

	.modal-footer {
		padding-top: 16px;
		border-top: 1px solid var(--admin-border);
	}

	.link-btn {
		font-size: 0.82rem;
		color: var(--admin-accent);
		text-decoration: none;
		transition: opacity 0.15s;
	}

	.link-btn:hover {
		opacity: 0.8;
	}
</style>
