<script lang="ts">
import StatusDot from "$lib/admin/components/StatusDot.svelte";
import type { Invoice, InvoiceItem } from "$lib/admin/types";
import {
	formatCents,
	formatDate,
	getStatusColor,
	INVOICE_STATUS_COLORS,
} from "$lib/admin/utils";

interface Props {
	invoices: Invoice[];
	onselect: (invoice: Invoice) => void;
}

let { invoices, onselect }: Props = $props();

function calcSubtotal(items: InvoiceItem[]): number {
	return items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
}

function calcTax(subtotal: number, taxPercent: number): number {
	return Math.round(subtotal * (taxPercent / 100));
}
</script>

{#if invoices.length === 0}
	<div class="empty-state">no invoices found</div>
{:else}
	<div class="table-wrap">
		<table class="inv-table">
			<thead>
				<tr>
					<th>invoice #</th>
					<th>type</th>
					<th>client</th>
					<th>items</th>
					<th>total</th>
					<th>due date</th>
					<th>status</th>
				</tr>
			</thead>
			<tbody>
				{#each invoices as inv (inv._id)}
					{@const subtotal = calcSubtotal(inv.items)}
					{@const tax = calcTax(subtotal, inv.taxPercent || 0)}
					{@const total = subtotal + tax}
					<tr
						class="inv-row"
						role="button"
						tabindex="0"
						onclick={() => onselect(inv)}
						onkeydown={(e) => {
							if (e.key === "Enter" || e.key === " ") {
								e.preventDefault();
								onselect(inv);
							}
						}}
					>
						<td class="td-number">{inv.invoiceNumber}</td>
						<td class="td-type"
							>{inv.invoiceType || "one-time"}</td
						>
						<td class="td-client">{inv.clientName}</td>
						<td class="td-items"
							>{inv.items.length} item{inv.items.length !== 1
								? "s"
								: ""}</td
						>
						<td class="td-total">{formatCents(total)}</td>
						<td class="td-date"
							>{inv.dueDate
								? formatDate(inv.dueDate)
								: "\u{2014}"}</td
						>
						<td>
							<StatusDot
								color={getStatusColor(
									INVOICE_STATUS_COLORS,
									inv.status,
								)}
								label={inv.status}
							/>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}

<style>
	.table-wrap {
		overflow-x: auto;
		-webkit-overflow-scrolling: touch;
	}

	.inv-table {
		width: 100%;
		border-collapse: collapse;
		text-align: left;
		font-size: 0.85rem;
	}

	.inv-table th {
		padding: 0 16px 12px 0;
		color: var(--admin-text-subtle);
		font-weight: 400;
		font-size: 0.75rem;
		letter-spacing: 0.04em;
		border-bottom: 1px solid var(--admin-border);
		white-space: nowrap;
	}

	.inv-table td {
		padding: 14px 16px 14px 0;
		border-bottom: 1px solid var(--admin-border);
		white-space: nowrap;
	}

	.inv-row {
		cursor: pointer;
		transition: background 0.12s;
	}

	.inv-row:hover {
		background: var(--admin-active);
	}

	.td-number {
		font-weight: 500;
		color: var(--admin-heading);
	}

	.td-type {
		color: var(--admin-text-subtle);
		font-size: 0.8rem;
	}

	.td-client {
		color: var(--admin-text);
	}

	.td-items,
	.td-date {
		color: var(--admin-text-muted);
		font-size: 0.82rem;
	}

	.td-total {
		font-weight: 500;
		color: var(--admin-heading);
		font-variant-numeric: tabular-nums;
	}

	.empty-state {
		padding: 48px 0;
		color: var(--admin-text-subtle);
		font-size: 0.88rem;
	}
</style>
