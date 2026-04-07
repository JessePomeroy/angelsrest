<script lang="ts">
/**
 * Admin Orders Dashboard
 *
 * A comprehensive order management system with filtering, sorting, and export capabilities.
 * Demonstrates Svelte 5 runes ($state, $derived) for reactive UI.
 */

import SEO from "$lib/components/SEO.svelte";

let { data } = $props();

// Filter state - these control what's shown in the table
let statusFilter = $state("all");
let searchQuery = $state("");
let yearFilter = $state("all");
let periodFilter = $state("all"); // all, today, week, month

// Modal state - for the order details popup
let selectedOrder = $state<any>(null);
let notesValue = $state("");
let notesSaving = $state(false);

// Get unique statuses for filter dropdown
const statuses = [
	"all",
	"new",
	"printing",
	"ready",
	"shipped",
	"delivered",
	"refunded",
];

let availableYears = $derived(
	(
		[
			...new Set(
				data.orders.map((o: any) => new Date(o.createdAt).getFullYear()),
			),
		] as number[]
	).sort((a, b) => b - a),
);

function getDateRange(period: string): { start: Date; end: Date } | null {
	const now = new Date();
	const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

	switch (period) {
		case "today":
			return {
				start: today,
				end: new Date(today.getTime() + 24 * 60 * 60 * 1000),
			};
		case "week": {
			const weekStart = new Date(today);
			weekStart.setDate(today.getDate() - today.getDay());
			return {
				start: weekStart,
				end: new Date(today.getTime() + 24 * 60 * 60 * 1000),
			};
		}
		case "month": {
			const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
			return {
				start: monthStart,
				end: new Date(today.getTime() + 24 * 60 * 60 * 1000),
			};
		}
		default:
			return null;
	}
}

// Filter orders
let filteredOrders = $derived(
	data.orders.filter((order: any) => {
		const orderDate = new Date(order.createdAt);

		// Period filter (today/week/month)
		if (periodFilter !== "all") {
			const range = getDateRange(periodFilter);
			if (range && (orderDate < range.start || orderDate >= range.end)) {
				return false;
			}
		}

		// Year filter
		if (
			yearFilter !== "all" &&
			orderDate.getFullYear() !== parseInt(yearFilter)
		) {
			return false;
		}
		// Status filter
		if (statusFilter !== "all" && order.status !== statusFilter) {
			return false;
		}
		// Search filter
		if (searchQuery) {
			const query = searchQuery.toLowerCase();
			const matchEmail = order.customerEmail?.toLowerCase().includes(query);
			const matchNumber = order.orderNumber?.toLowerCase().includes(query);
			const matchName = order.customerName?.toLowerCase().includes(query);
			if (!matchEmail && !matchNumber && !matchName) {
				return false;
			}
		}
		return true;
	}),
);

let totalRevenue = $derived(
	filteredOrders.reduce(
		(sum: number, order: any) => sum + (order.total || 0),
		0,
	),
);

let allTimeRevenue = $derived(
	data.orders.reduce((sum: number, order: any) => sum + (order.total || 0), 0),
);

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

function getStatusColor(status: string): string {
	const colors: Record<string, string> = {
		new: "var(--status-slate)",
		printing: "var(--status-amber)",
		ready: "var(--status-lavender)",
		shipped: "var(--status-peach)",
		delivered: "var(--status-sage)",
		refunded: "var(--status-rose)",
	};
	return colors[status] || "var(--status-slate)";
}

async function updateStatus(orderId: string, newStatus: string) {
	try {
		const response = await fetch(`/api/admin/orders/${orderId}`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ status: newStatus }),
		});
		if (response.ok) {
			const order = data.orders.find((o: any) => o._id === orderId);
			if (order) {
				order.status = newStatus as any;
				data.orders = [...data.orders];
			}
			if (selectedOrder?._id === orderId) {
				selectedOrder.status = newStatus;
			}
		}
	} catch (err) {
		console.error("Failed to update status:", err);
	}
}

function openOrderDetails(order: any) {
	selectedOrder = order;
	notesValue = order.notes || "";
}

function closeModal() {
	selectedOrder = null;
}

async function saveNotes() {
	if (!selectedOrder) return;

	notesSaving = true;
	try {
		const response = await fetch(`/api/admin/orders/${selectedOrder._id}`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ notes: notesValue }),
		});
		if (response.ok) {
			const order = data.orders.find((o: any) => o._id === selectedOrder._id);
			if (order) {
				order.notes = notesValue;
				data.orders = [...data.orders];
			}
			selectedOrder.notes = notesValue;
		}
	} catch (err) {
		console.error("Failed to save notes:", err);
	} finally {
		notesSaving = false;
	}
}

function exportCSV() {
	const headers = [
		"Order Number",
		"Date",
		"Customer Name",
		"Customer Email",
		"Items",
		"Gross Revenue",
		"Stripe Fees",
		"Net Revenue",
		"Status",
		"Notes",
	];

	const rows = filteredOrders.map((order: any) => {
		const gross = (order.total || 0) / 100;
		const fees = (order.stripeFees || 0) / 100;
		const net = gross - fees;

		return [
			order.orderNumber || "",
			new Date(order.createdAt).toLocaleDateString("en-US"),
			order.customerName || "",
			order.customerEmail || "",
			(order.items || [])
				.map((i: any) => `${i.productName} x${i.quantity}`)
				.join("; "),
			gross.toFixed(2),
			fees.toFixed(2),
			net.toFixed(2),
			order.status || "",
			order.notes || "",
		];
	});

	const csvContent = [
		headers.join(","),
		...rows.map((row: any[]) =>
			row.map((cell: any) => `"${String(cell).replace(/"/g, '""')}"`).join(","),
		),
	].join("\n");

	const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
	const url = URL.createObjectURL(blob);
	const link = document.createElement("a");
	link.href = url;
	link.download = `orders-${yearFilter === "all" ? "all" : yearFilter}.csv`;
	link.click();
	URL.revokeObjectURL(url);
}
</script>

<SEO title="Orders | Admin" description="Manage orders" />

<div class="orders-page">
	<header class="page-header">
		<h1>orders</h1>
	</header>

	<!-- Revenue as inline text -->
	<div class="stats-line">
		<span class="stat-item">
			<span class="stat-label">filtered</span>
			<span class="stat-value">{formatCurrency(totalRevenue)}</span>
			<span class="stat-sub">{filteredOrders.length} orders</span>
		</span>
		<span class="stat-sep">&middot;</span>
		<span class="stat-item">
			<span class="stat-label">all time</span>
			<span class="stat-value">{formatCurrency(allTimeRevenue)}</span>
			<span class="stat-sub">{data.orders.length} orders</span>
		</span>
		<span class="stat-sep">&middot;</span>
		<span class="stat-item">
			<span class="stat-label">avg</span>
			<span class="stat-value">{formatCurrency(data.orders.length > 0 ? allTimeRevenue / data.orders.length : 0)}</span>
		</span>
	</div>

	<!-- Filters -->
	<div class="filter-bar">
		<input
			type="text"
			bind:value={searchQuery}
			placeholder="search by email, order #, or name..."
			class="filter-search"
		/>
		<select bind:value={periodFilter} class="filter-select">
			<option value="all">all time</option>
			<option value="today">today</option>
			<option value="week">this week</option>
			<option value="month">this month</option>
		</select>
		<select bind:value={yearFilter} class="filter-select">
			<option value="all">all years</option>
			{#each availableYears as year}
				<option value={year}>{year}</option>
			{/each}
		</select>
		<select bind:value={statusFilter} class="filter-select">
			{#each statuses as status}
				<option value={status}>
					{status === 'all' ? 'all statuses' : status}
				</option>
			{/each}
		</select>
		<button class="btn-export" onclick={exportCSV}>
			export csv
		</button>
	</div>

	<!-- Orders table -->
	{#if filteredOrders.length === 0}
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
					{#each filteredOrders as order (order._id)}
						<tr
							class="order-row"
							role="button"
							tabindex="0"
							onclick={() => openOrderDetails(order)}
							onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openOrderDetails(order); }}}
						>
							<td class="td-order">{order.orderNumber}</td>
							<td class="td-date">{formatDate(order.createdAt)}</td>
							<td>
								<div class="customer-cell">
									<span class="customer-name">{order.customerName || '\u2014'}</span>
									<span class="customer-email">{order.customerEmail || '\u2014'}</span>
								</div>
							</td>
							<td class="td-items">
								{order.items?.length || 0} item{(order.items?.length || 0) !== 1 ? 's' : ''}
							</td>
							<td class="td-total">{formatCurrency(order.total, order.currency)}</td>
							<!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
							<td onclick={(e) => e.stopPropagation()}>
								<select
									value={order.status}
									onchange={(e) => updateStatus(order._id, e.currentTarget.value)}
									class="status-select"
								>
									{#each statuses.filter(s => s !== 'all') as status}
										<option value={status}>{status}</option>
									{/each}
								</select>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>

{#if selectedOrder}
	<div
		class="modal-overlay"
		role="dialog"
		tabindex="-1"
		aria-modal="true"
		aria-label="Order details"
		onclick={closeModal}
		onkeydown={(e) => { if (e.key === 'Escape') closeModal(); }}
	>
		<div
			class="modal-content"
			role="presentation"
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => e.stopPropagation()}
		>
			<div class="modal-header">
				<div>
					<h2 class="modal-title">{selectedOrder.orderNumber}</h2>
					<p class="modal-meta">{formatDate(selectedOrder.createdAt)}</p>
				</div>
				<button class="modal-close" onclick={closeModal}>&#10005;</button>
			</div>

			<div class="modal-body">
				<div class="modal-field">
					<label class="field-label" for="modal-status">status</label>
					<select
						id="modal-status"
						value={selectedOrder.status}
						onchange={(e) => updateStatus(selectedOrder._id, e.currentTarget.value)}
						class="form-input"
					>
						{#each statuses.filter(s => s !== 'all') as status}
							<option value={status}>{status}</option>
						{/each}
					</select>
				</div>

				<div class="modal-section">
					<h3 class="section-label">customer</h3>
					<p class="section-text">{selectedOrder.customerName || '\u2014'}</p>
					<p class="section-text-muted">{selectedOrder.customerEmail || '\u2014'}</p>
				</div>

				{#if selectedOrder.shippingAddress}
					<div class="modal-section">
						<h3 class="section-label">shipping address</h3>
						<p class="section-text">{selectedOrder.shippingAddress.line1}</p>
						{#if selectedOrder.shippingAddress.line2}<p class="section-text">{selectedOrder.shippingAddress.line2}</p>{/if}
						<p class="section-text">{selectedOrder.shippingAddress.city}, {selectedOrder.shippingAddress.state} {selectedOrder.shippingAddress.postalCode}</p>
						<p class="section-text">{selectedOrder.shippingAddress.country}</p>
					</div>
				{/if}

				<div class="modal-section">
					<h3 class="section-label">items</h3>
					<ul class="items-list">
						{#each selectedOrder.items || [] as item}
							<li>
								{item.productName} x {item.quantity} — {formatCurrency(item.price, selectedOrder.currency)}
							</li>
						{/each}
					</ul>
					<p class="items-total">total: {formatCurrency(selectedOrder.total, selectedOrder.currency)}</p>
				</div>

				<div class="modal-field">
					<label class="field-label" for="modal-notes">notes</label>
					<textarea
						id="modal-notes"
						bind:value={notesValue}
						class="form-input form-textarea"
						rows="3"
						placeholder="add fulfillment notes"
					></textarea>
					<button
						class="btn-save"
						disabled={notesSaving}
						onclick={saveNotes}
					>
						{notesSaving ? 'saving...' : 'save notes'}
					</button>
				</div>
			</div>
		</div>
	</div>
{/if}

<style>
	.orders-page {
		padding: 48px 40px;
		max-width: 1200px;
	}

	.page-header {
		margin-bottom: 32px;
	}

	.page-header h1 {
		font-family: "Chillax", sans-serif;
		font-size: 1.8rem;
		font-weight: 500;
		color: var(--admin-heading);
		margin: 0;
		letter-spacing: -0.01em;
	}

	/* Stats line */
	.stats-line {
		display: flex;
		align-items: baseline;
		gap: 12px;
		flex-wrap: wrap;
		margin-bottom: 32px;
		padding-bottom: 24px;
		border-bottom: 1px solid var(--admin-border);
	}

	.stat-item {
		display: inline-flex;
		align-items: baseline;
		gap: 6px;
	}

	.stat-label {
		font-size: 0.82rem;
		color: var(--admin-text-muted);
	}

	.stat-value {
		font-size: 1.1rem;
		font-weight: 500;
		color: var(--admin-heading);
	}

	.stat-sub {
		font-size: 0.78rem;
		color: var(--admin-text-subtle);
	}

	.stat-sep {
		color: var(--admin-text-subtle);
	}

	/* Filters */
	.filter-bar {
		display: flex;
		gap: 10px;
		margin-bottom: 24px;
		flex-wrap: wrap;
	}

	.filter-search {
		flex: 1;
		min-width: 200px;
		padding: 7px 12px;
		background: transparent;
		border: 1px solid var(--admin-border-strong);
		border-radius: 6px;
		color: var(--admin-text);
		font-size: 0.83rem;
		font-family: "Synonym", system-ui, sans-serif;
		outline: none;
		transition: border-color 0.15s;
	}

	.filter-search:focus {
		border-color: var(--admin-accent);
	}

	.filter-search::placeholder {
		color: var(--admin-text-subtle);
	}

	.filter-select {
		padding: 7px 12px;
		background: transparent;
		border: 1px solid var(--admin-border-strong);
		border-radius: 6px;
		color: var(--admin-text);
		font-size: 0.83rem;
		font-family: "Synonym", system-ui, sans-serif;
		outline: none;
	}

	.btn-export {
		padding: 7px 14px;
		background: transparent;
		border: 1px solid var(--admin-border-strong);
		border-radius: 6px;
		color: var(--admin-text);
		font-size: 0.82rem;
		font-family: "Synonym", system-ui, sans-serif;
		cursor: pointer;
		transition: color 0.15s, border-color 0.15s;
		white-space: nowrap;
	}

	.btn-export:hover {
		color: var(--admin-heading);
		border-color: var(--admin-text-muted);
	}

	/* Table */
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

	/* Modal */
	.modal-overlay {
		position: fixed;
		inset: 0;
		z-index: 100;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(0, 0, 0, 0.4);
		backdrop-filter: blur(8px);
		padding: 16px;
	}

	.modal-content {
		background: var(--admin-bg, #1e293b);
		border: 1px solid var(--admin-border);
		border-radius: 12px;
		width: 100%;
		max-width: 600px;
		max-height: 90vh;
		overflow-y: auto;
		box-shadow: 0 24px 80px rgba(0, 0, 0, 0.5);
	}

	.modal-header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		padding: 28px 28px 0;
	}

	.modal-title {
		font-family: "Chillax", sans-serif;
		font-size: 1.2rem;
		font-weight: 500;
		color: var(--admin-heading);
		margin: 0;
	}

	.modal-meta {
		font-size: 0.82rem;
		color: var(--admin-text-muted);
		margin: 4px 0 0;
	}

	.modal-close {
		background: none;
		border: none;
		color: var(--admin-text-subtle);
		font-size: 1rem;
		cursor: pointer;
		padding: 4px;
		transition: color 0.15s;
	}

	.modal-close:hover {
		color: var(--admin-heading);
	}

	.modal-body {
		padding: 24px 28px 28px;
		display: flex;
		flex-direction: column;
		gap: 20px;
	}

	.modal-field {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.field-label {
		font-size: 0.76rem;
		color: var(--admin-text-subtle);
		letter-spacing: 0.04em;
	}

	.modal-section {
		padding-top: 4px;
	}

	.section-label {
		font-family: "Synonym", system-ui, sans-serif;
		font-size: 0.76rem;
		font-weight: 400;
		color: var(--admin-text-subtle);
		letter-spacing: 0.04em;
		margin: 0 0 8px;
	}

	.section-text {
		font-size: 0.88rem;
		color: var(--admin-heading);
		margin: 0 0 2px;
	}

	.section-text-muted {
		font-size: 0.82rem;
		color: var(--admin-text-muted);
		margin: 0;
	}

	.items-list {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 0.86rem;
		color: var(--admin-text);
	}

	.items-total {
		margin: 10px 0 0;
		font-weight: 500;
		font-size: 0.9rem;
		color: var(--admin-heading);
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

	.form-textarea {
		resize: vertical;
		min-height: 60px;
	}

	.btn-save {
		align-self: flex-start;
		margin-top: 4px;
		padding: 7px 16px;
		background: rgba(129, 140, 248, 0.15);
		border: 1px solid rgba(129, 140, 248, 0.25);
		border-radius: 6px;
		color: var(--admin-accent-hover);
		font-size: 0.82rem;
		font-family: "Synonym", system-ui, sans-serif;
		font-weight: 500;
		cursor: pointer;
		transition: background 0.15s;
	}

	.btn-save:hover {
		background: rgba(129, 140, 248, 0.22);
	}

	.btn-save:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	@media (max-width: 768px) {
		.orders-page {
			padding: 20px 16px;
		}

		.filter-bar {
			flex-direction: column;
		}

		.filter-search {
			min-width: unset;
		}

		.stats-line {
			gap: 8px;
		}

		.stat-sep {
			display: none;
		}

		.stat-item {
			flex-basis: 100%;
			gap: 6px;
			margin-bottom: 4px;
		}

		.modal-content {
			max-width: 100%;
			margin: 0;
			border-radius: 12px 12px 0 0;
			max-height: 90vh;
		}

		.modal-overlay {
			align-items: flex-end;
			padding: 0;
		}

		.modal-header {
			padding: 20px 20px 0;
		}

		.modal-body {
			padding: 20px;
		}
	}
</style>
