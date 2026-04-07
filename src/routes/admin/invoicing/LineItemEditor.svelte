<script lang="ts">
import type { InvoiceItem } from "$lib/admin/types";

interface Props {
	items: InvoiceItem[];
	onitems: (items: InvoiceItem[]) => void;
	pricePlaceholder?: string;
	priceLabel?: string;
	formatTotal: (cents: number) => string;
	convertPrice?: (price: number) => number;
	required?: boolean;
}

let {
	items,
	onitems,
	pricePlaceholder = "price ($)",
	priceLabel = "line items",
	formatTotal,
	convertPrice,
	required = false,
}: Props = $props();

function addItem() {
	onitems([...items, { description: "", quantity: 1, unitPrice: 0 }]);
}

function removeItem(index: number) {
	onitems(items.filter((_, i) => i !== index));
}

function lineTotal(item: InvoiceItem): number {
	const total = item.quantity * item.unitPrice;
	return convertPrice ? convertPrice(total) : total;
}
</script>

<div class="items-section">
	<div class="items-header">
		<span class="form-label"
			>{priceLabel}
			{#if required}<span class="required">*</span>{/if}</span
		>
	</div>
	{#each items as item, i}
		<div class="item-row">
			<input
				class="form-input item-desc"
				type="text"
				placeholder="description"
				bind:value={item.description}
				required
			/>
			<input
				class="form-input item-qty"
				type="number"
				min="1"
				step="1"
				placeholder="qty"
				bind:value={item.quantity}
				required
			/>
			<input
				class="form-input item-price"
				type="number"
				min="0"
				step="0.01"
				placeholder={pricePlaceholder}
				bind:value={item.unitPrice}
				required
			/>
			<span class="item-line-total">{formatTotal(lineTotal(item))}</span>
			{#if items.length > 1}
				<button
					type="button"
					class="btn-remove-item"
					onclick={() => removeItem(i)}
					aria-label="Remove item"
				>
					<svg
						width="14"
						height="14"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						><line x1="18" y1="6" x2="6" y2="18" /><line
							x1="6"
							y1="6"
							x2="18"
							y2="18"
						/></svg
					>
				</button>
			{/if}
		</div>
	{/each}
	<button type="button" class="btn-add-item" onclick={addItem}
		>+ add item</button
	>
</div>

<style>
	.items-section {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.items-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.form-label {
		font-size: 0.76rem;
		color: var(--admin-text-muted);
		font-weight: 400;
		letter-spacing: 0.02em;
	}

	.required {
		color: var(--status-rose);
	}

	.item-row {
		display: flex;
		gap: 8px;
		align-items: center;
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

	.item-desc {
		flex: 3;
		min-width: 0;
	}

	.item-qty {
		flex: 0 0 60px;
		text-align: center;
	}

	.item-price {
		flex: 0 0 90px;
		text-align: right;
	}

	.item-line-total {
		flex: 0 0 80px;
		text-align: right;
		font-size: 0.82rem;
		color: var(--admin-text-muted);
		font-variant-numeric: tabular-nums;
	}

	.btn-remove-item {
		background: none;
		border: none;
		color: var(--admin-text-subtle);
		cursor: pointer;
		padding: 4px;
		border-radius: 4px;
		transition: color 0.15s;
		flex-shrink: 0;
	}

	.btn-remove-item:hover {
		color: var(--status-rose);
	}

	.btn-add-item {
		background: none;
		border: none;
		color: var(--admin-text-muted);
		cursor: pointer;
		font-size: 0.8rem;
		font-family: "Synonym", system-ui, sans-serif;
		padding: 4px 0;
		text-align: left;
		transition: color 0.15s;
	}

	.btn-add-item:hover {
		color: var(--admin-heading);
	}

	@media (max-width: 768px) {
		.item-row {
			flex-wrap: wrap;
		}

		.item-desc {
			flex: 1 1 100%;
		}

		.item-line-total {
			flex: 1;
			text-align: left;
		}
	}
</style>
