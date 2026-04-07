<script lang="ts">
import StatusDot from "$lib/admin/components/StatusDot.svelte";
import type { Contract } from "$lib/admin/types";
import {
	CONTRACT_STATUS_COLORS,
	formatCents,
	formatDate,
	getStatusColor,
} from "$lib/admin/utils";

interface Props {
	contracts: Contract[];
	onselect: (contract: Contract) => void;
}

let { contracts, onselect }: Props = $props();
</script>

{#if contracts.length === 0}
	<div class="empty-state">no contracts found</div>
{:else}
	<div class="table-wrap">
		<table class="ct-table">
			<thead>
				<tr>
					<th>title</th>
					<th>client</th>
					<th>category</th>
					<th>event date</th>
					<th>total price</th>
					<th>status</th>
				</tr>
			</thead>
			<tbody>
				{#each contracts as contract (contract._id)}
					<tr
						class="ct-row"
						role="button"
						tabindex="0"
						onclick={() => onselect(contract)}
						onkeydown={(e) => {
							if (e.key === "Enter" || e.key === " ") {
								e.preventDefault();
								onselect(contract);
							}
						}}
					>
						<td class="td-title">{contract.title}</td>
						<td class="td-client"
							>{contract.clientName ?? ""}</td
						>
						<td class="td-category"
							>{contract.category || "\u2014"}</td
						>
						<td class="td-date"
							>{contract.eventDate
								? formatDate(contract.eventDate)
								: "\u2014"}</td
						>
						<td class="td-price"
							>{contract.totalPrice
								? formatCents(contract.totalPrice)
								: "\u2014"}</td
						>
						<td>
							<StatusDot
								color={getStatusColor(
									CONTRACT_STATUS_COLORS,
									contract.status,
								)}
								label={contract.status}
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

	.ct-table {
		width: 100%;
		border-collapse: collapse;
		text-align: left;
		font-size: 0.85rem;
	}

	.ct-table th {
		padding: 0 16px 12px 0;
		color: var(--admin-text-subtle);
		font-weight: 400;
		font-size: 0.75rem;
		letter-spacing: 0.04em;
		border-bottom: 1px solid var(--admin-border);
		white-space: nowrap;
	}

	.ct-table td {
		padding: 14px 16px 14px 0;
		border-bottom: 1px solid var(--admin-border);
		white-space: nowrap;
	}

	.ct-row {
		cursor: pointer;
		transition: background 0.12s;
	}

	.ct-row:hover {
		background: var(--admin-active);
	}

	.td-title {
		font-weight: 500;
		color: var(--admin-heading);
	}

	.td-client {
		color: var(--admin-text);
	}

	.td-category {
		color: var(--admin-text-subtle);
		font-size: 0.8rem;
	}

	.td-date {
		color: var(--admin-text-muted);
		font-size: 0.82rem;
	}

	.td-price {
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
