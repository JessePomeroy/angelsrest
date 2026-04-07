<script lang="ts">
/**
 * Admin Orders Dashboard 💰
 *
 * A comprehensive order management system with filtering, sorting, and export capabilities.
 * Demonstrates Svelte 5 runes ($state, $derived) for reactive UI.
 */

import SEO from "$lib/components/SEO.svelte";

let { data } = $props();

/**
 * 💡 Svelte 5 Runes:
 * - $state() - Makes a variable reactive (like this.filter = 'x' triggers UI update)
 * - $derived() - Auto-recalculates when dependencies change
 */

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

/**
 * $derived - Automatically recalculates when data.orders changes
 *
 * This extracts unique years from all orders, so the year dropdown
 * automatically updates when new orders come in.
 *
 * [...new Set(...)] - Creates unique values (removes duplicates)
 * .sort((a, b) => b - a) - Sorts newest first
 */
let availableYears = $derived(
	(
		[
			...new Set(
				data.orders.map((o: any) => new Date(o.createdAt).getFullYear()),
			),
		] as number[]
	).sort((a, b) => b - a),
);

/**
 * Date range helper for period filters
 *
 * Returns start and end dates for: today, this week, this month
 * Used to filter orders within a specific time period.
 */
function getDateRange(period: string): { start: Date; end: Date } | null {
	const now = new Date();
	const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

	switch (period) {
		case "today":
			// Start of today to start of tomorrow
			return {
				start: today,
				end: new Date(today.getTime() + 24 * 60 * 60 * 1000),
			};
		case "week": {
			// Sunday of this week to tomorrow
			const weekStart = new Date(today);
			weekStart.setDate(today.getDate() - today.getDay());
			return {
				start: weekStart,
				end: new Date(today.getTime() + 24 * 60 * 60 * 1000),
			};
		}
		case "month": {
			// First day of month to tomorrow
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

/**
 * $derived for revenue calculations
 *
 * These automatically update whenever filteredOrders changes.
 * So when you filter by year/month, the revenue updates instantly!
 *
 * .reduce() adds up all the order totals
 * Order amounts are in cents, so we don't divide by 100 until display
 */
// Calculate totals for filtered orders
let totalRevenue = $derived(
	filteredOrders.reduce(
		(sum: number, order: any) => sum + (order.total || 0),
		0,
	),
);

// Calculate totals for ALL orders (regardless of filter)
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

function getStatusClass(status: string): string {
	const colors: Record<string, string> = {
		new: "bg-blue-600 text-white px-2 py-1 rounded text-xs",
		printing: "bg-yellow-500 text-black px-2 py-1 rounded text-xs",
		ready: "bg-yellow-500 text-black px-2 py-1 rounded text-xs",
		shipped: "bg-purple-600 text-white px-2 py-1 rounded text-xs",
		delivered: "bg-green-600 text-white px-2 py-1 rounded text-xs",
		refunded: "bg-red-600 text-white px-2 py-1 rounded text-xs",
	};
	return colors[status] || "bg-gray-500 text-white px-2 py-1 rounded text-xs";
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
				order.status = newStatus;
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

/**
 * Export to CSV 📊
 *
 * CSV (Comma-Separated Values) is a simple format that Excel/Google Sheets can open.
 * Perfect for taxes, accounting, or sharing with a bookkeeper.
 *
 * How it works:
 * 1. Create array of headers
 * 2. Map each order to an array of values (amounts converted from cents to dollars)
 * 3. Join with commas, wrap in quotes to handle special characters
 * 4. Create a Blob (file-like object) and trigger browser download
 *
 * 💡 Revenue Columns:
 * - "Gross Revenue" = what customer paid (order total)
 * - "Stripe Fees" = actual transaction fees from Stripe's balance_transaction
 * - "Net Revenue" = Gross - Fees = your actual income
 *
 * Stripe fees are captured automatically via the webhook handler.
 * After checkout completes, we wait 3s then fetch the balance_transaction
 * from Stripe which contains the real fee amount.
 */
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
		// Actual Stripe fees captured from balance_transaction via webhook
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

<div class="container mx-auto px-4 py-8 max-w-6xl">
	<header class="mb-8">
		<h1 class="text-3xl font-bold">Orders</h1>
		<p class="text-gray-400">Manage and fulfill orders</p>
	</header>

	<!-- Revenue Summary -->
	<div class="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
		<div class="bg-gray-800 p-4 rounded-lg">
			<p class="text-gray-400 text-sm">Filtered Revenue</p>
			<p class="text-2xl font-bold text-green-400">{formatCurrency(totalRevenue)}</p>
			<p class="text-gray-500 text-sm">{filteredOrders.length} orders</p>
		</div>
		<div class="bg-gray-800 p-4 rounded-lg">
			<p class="text-gray-400 text-sm">All-Time Revenue</p>
			<p class="text-2xl font-bold">{formatCurrency(allTimeRevenue)}</p>
			<p class="text-gray-500 text-sm">{data.orders.length} orders</p>
		</div>
		<div class="bg-gray-800 p-4 rounded-lg">
			<p class="text-gray-400 text-sm">Average Order</p>
			<p class="text-2xl font-bold">{formatCurrency(data.orders.length > 0 ? allTimeRevenue / data.orders.length : 0)}</p>
			<p class="text-gray-500 text-sm">per order</p>
		</div>
	</div>

	<div class="flex flex-col sm:flex-row gap-4 mb-6">
		<div class="flex-1">
			<input
				type="text"
				bind:value={searchQuery}
				placeholder="Search by email, order #, or name..."
				class="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded text-white"
			/>
		</div>
		<div class="sm:w-32">
			<select bind:value={periodFilter} class="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded text-white">
				<option value="all">All Time</option>
				<option value="today">Today</option>
				<option value="week">This Week</option>
				<option value="month">This Month</option>
			</select>
		</div>
		<div class="sm:w-40">
			<select bind:value={yearFilter} class="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded text-white">
				<option value="all">All Years</option>
				{#each availableYears as year}
					<option value={year}>{year}</option>
				{/each}
			</select>
		</div>
		<div class="sm:w-48">
			<select bind:value={statusFilter} class="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded text-white">
				{#each statuses as status}
					<option value={status}>
						{status === 'all' ? 'All Statuses' : status.charAt(0).toUpperCase() + status.slice(1)}
					</option>
				{/each}
			</select>
		</div>
		<button
			onclick={exportCSV}
			class="px-4 py-2 bg-green-600 hover:bg-green-700 rounded text-white whitespace-nowrap"
		>
			Export CSV
		</button>
	</div>

	<div class="overflow-x-auto">
		<table class="w-full text-left">
			<thead>
				<tr class="border-b border-gray-700">
					<th class="py-3 px-4">Order</th>
					<th class="py-3 px-4">Date</th>
					<th class="py-3 px-4">Customer</th>
					<th class="py-3 px-4">Items</th>
					<th class="py-3 px-4">Total</th>
					<th class="py-3 px-4">Status</th>
				</tr>
			</thead>
			<tbody>
				{#each filteredOrders as order (order._id)}
					<tr 
						class="border-b border-gray-800 hover:bg-gray-800 cursor-pointer"
						role="button"
						tabindex="0"
						onclick={() => openOrderDetails(order)}
						onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openOrderDetails(order); }}}
					>
						<td class="py-3 px-4 font-mono text-sm">{order.orderNumber}</td>
						<td class="py-3 px-4 text-sm">{formatDate(order.createdAt)}</td>
						<td class="py-3 px-4">
							<div class="flex flex-col">
								<span>{order.customerName || '—'}</span>
								<span class="text-gray-400 text-sm">{order.customerEmail || '—'}</span>
							</div>
						</td>
						<td class="py-3 px-4">
							<span class="bg-gray-700 px-2 py-1 rounded text-xs">
								{order.items?.length || 0} item{(order.items?.length || 0) !== 1 ? 's' : ''}
							</span>
						</td>
						<td class="py-3 px-4 font-semibold">{formatCurrency(order.total, order.currency)}</td>
						<!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
						<td class="py-3 px-4" onclick={(e) => e.stopPropagation()}>
							<select
								value={order.status}
								onchange={(e) => updateStatus(order._id, e.currentTarget.value)}
								class="px-3 py-1 bg-gray-800 border border-gray-700 rounded text-white text-sm capitalize"
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

	{#if filteredOrders.length === 0}
		<div class="text-center py-12 text-gray-400">
			No orders found
		</div>
	{/if}
</div>

{#if selectedOrder}
	<!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
	<div 
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
		role="dialog"
		aria-modal="true"
		aria-label="Order details"
		onclick={closeModal}
		onkeydown={(e) => { if (e.key === 'Escape') closeModal(); }}
	>
		<!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
		<div 
			class="bg-gray-800 p-6 rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto"
			onclick={(e) => e.stopPropagation()}
		>
			<div class="flex justify-between items-start mb-4">
				<div>
					<h2 class="text-2xl font-bold">{selectedOrder.orderNumber}</h2>
					<p class="text-gray-400">{formatDate(selectedOrder.createdAt)}</p>
				</div>
				<button 
					class="text-gray-400 hover:text-white text-xl"
					onclick={closeModal}
				>✕</button>
			</div>

			<div class="mb-4">
				<label class="block mb-2 text-sm text-gray-400">Status</label>
				<select
					value={selectedOrder.status}
					onchange={(e) => updateStatus(selectedOrder._id, e.currentTarget.value)}
					class="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded text-white capitalize"
				>
					{#each statuses.filter(s => s !== 'all') as status}
						<option value={status}>{status}</option>
					{/each}
				</select>
			</div>

			<div class="mb-4">
				<h3 class="text-lg font-semibold mb-2">Customer</h3>
				<p><strong>Name:</strong> {selectedOrder.customerName || '—'}</p>
				<p><strong>Email:</strong> {selectedOrder.customerEmail || '—'}</p>
			</div>

			{#if selectedOrder.shippingAddress}
				<div class="mb-4">
					<h3 class="text-lg font-semibold mb-2">Shipping Address</h3>
					<p>{selectedOrder.shippingAddress.line1}</p>
					{#if selectedOrder.shippingAddress.line2}<p>{selectedOrder.shippingAddress.line2}</p>{/if}
					<p>{selectedOrder.shippingAddress.city}, {selectedOrder.shippingAddress.state} {selectedOrder.shippingAddress.postalCode}</p>
					<p>{selectedOrder.shippingAddress.country}</p>
				</div>
			{/if}

			<div class="mb-4">
				<h3 class="text-lg font-semibold mb-2">Items</h3>
				<ul class="list-disc pl-4">
					{#each selectedOrder.items || [] as item}
						<li>
							{item.productName} × {item.quantity} — {formatCurrency(item.price, selectedOrder.currency)}
						</li>
					{/each}
				</ul>
				<p class="mt-2 font-semibold">Total: {formatCurrency(selectedOrder.total, selectedOrder.currency)}</p>
			</div>

			<div class="mb-4">
				<label class="block mb-2 text-sm text-gray-400">Notes</label>
				<textarea
					bind:value={notesValue}
					class="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded text-white"
					rows="3"
					placeholder="Add fulfillment notes"
				></textarea>
				<button
					class="mt-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded text-white"
					disabled={notesSaving}
					onclick={saveNotes}
				>
					{notesSaving ? 'Saving...' : 'Save Notes'}
				</button>
			</div>
		</div>
	</div>
{/if}
