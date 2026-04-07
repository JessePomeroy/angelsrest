<script lang="ts">
import type { OrderStatus } from "$lib/admin/types";
import { getStatusColor, ORDER_STATUS_COLORS } from "$lib/admin/utils";

interface OrderItem {
	productName: string;
	quantity: number;
	price: number;
}

interface ShippingAddress {
	line1: string;
	line2?: string;
	city: string;
	state: string;
	postalCode: string;
	country: string;
}

export interface OrderData {
	_id: string;
	orderNumber: string;
	createdAt: string;
	customerName: string;
	customerEmail: string;
	total: number;
	currency: string;
	status: OrderStatus;
	items: OrderItem[];
	shippingAddress: ShippingAddress | null;
	notes: string;
	stripeFees?: number;
}

interface Props {
	orders: OrderData[];
	onorderclick: (order: OrderData) => void;
	onupdatestatus: (orderId: string, newStatus: string) => void;
}

let { orders, onorderclick, onupdatestatus }: Props = $props();

const statuses: OrderStatus[] = [
	"new",
	"printing",
	"ready",
	"shipped",
	"delivered",
	"refunded",
];

function formatCurrency(amount: number, currency = "usd") {
	return new Intl.NumberFormat("en-US", {
		style: "currency",
		currency: currency.toUpperCase(),
	}).format(amount / 100);
}

function formatDate(dateStr: string) {
	return new Date(dateStr).toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
		year: "numeric",
		hour: "numeric",
		minute: "2-digit",
	});
}
</script>

{#if orders.length === 0}
	<div class="empty-state">no orders found</div>
{:else}
	<div class="table-wrap">
		<table class="orders-table">
			<thead>
				<tr>
					<th>order</th>
					<th>date</th>
					<th>customer</th>
					<th>items</th>
					<th>total</th>
					<th>status</th>
				</tr>
			</thead>
			<tbody>
				{#each orders as order (order._id)}
					<tr
						class="order-row"
						role="button"
						tabindex="0"
						onclick={() => onorderclick(order)}
						onkeydown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onorderclick(order); }}}
					>
						<td class="td-order">{order.orderNumber}</td>
						<td class="td-date">{formatDate(order.createdAt)}</td>
						<td>
							<div class="customer-cell">
								<span class="customer-name">{order.customerName || "\u2014"}</span>
								<span class="customer-email">{order.customerEmail || "\u2014"}</span>
							</div>
						</td>
						<td class="td-items">
							{order.items?.length || 0} item{(order.items?.length || 0) !== 1 ? "s" : ""}
						</td>
						<td class="td-total">{formatCurrency(order.total, order.currency)}</td>
						<!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
						<td onclick={(e) => e.stopPropagation()}>
							<div class="status-cell">
								<span class="status-dot" style="background: {getStatusColor(ORDER_STATUS_COLORS, order.status)}"></span>
								<select
									value={order.status}
									onchange={(e) => onupdatestatus(order._id, e.currentTarget.value)}
									class="status-select"
								>
									{#each statuses as status}
										<option value={status}>{status}</option>
									{/each}
								</select>
							</div>
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

	.orders-table {
		width: 100%;
		border-collapse: collapse;
		text-align: left;
		font-size: 0.85rem;
	}

	.orders-table th {
		padding: 0 16px 12px 0;
		color: var(--admin-text-subtle);
		font-weight: 400;
		font-size: 0.75rem;
		letter-spacing: 0.04em;
		border-bottom: 1px solid var(--admin-border);
	}

	.orders-table td {
		padding: 14px 16px 14px 0;
		border-bottom: 1px solid var(--admin-border);
	}

	.order-row {
		cursor: pointer;
		transition: background 0.12s;
	}

	.order-row:hover {
		background: var(--admin-active);
	}

	.td-order {
		font-family: monospace;
		font-size: 0.8rem;
		color: var(--admin-text-muted);
	}

	.td-date {
		font-size: 0.82rem;
		color: var(--admin-text-muted);
		white-space: nowrap;
	}

	.customer-cell {
		display: flex;
		flex-direction: column;
	}

	.customer-name {
		color: var(--admin-heading);
	}

	.customer-email {
		font-size: 0.78rem;
		color: var(--admin-text-subtle);
	}

	.td-items {
		font-size: 0.82rem;
		color: var(--admin-text-muted);
	}

	.td-total {
		font-weight: 500;
		color: var(--admin-heading);
	}

	.status-cell {
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}

	.status-dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		flex-shrink: 0;
	}

	.status-select {
		padding: 4px 8px;
		background: transparent;
		border: 1px solid var(--admin-border-strong);
		border-radius: 5px;
		color: var(--admin-text);
		font-size: 0.78rem;
		font-family: "Synonym", system-ui, sans-serif;
	}

	.empty-state {
		padding: 48px 0;
		color: var(--admin-text-subtle);
		font-size: 0.88rem;
	}
</style>
