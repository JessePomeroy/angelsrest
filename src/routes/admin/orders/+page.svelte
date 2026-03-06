<script lang="ts">
	import SEO from '$lib/components/SEO.svelte';
	import { Modal } from '@skeletonlabs/skeleton';

	let { data } = $props();

	// Filter state
	let statusFilter = $state('all');
	let searchQuery = $state('');

	// Modal state
	let selectedOrder = $state<any>(null);
	let notesValue = $state('');
	let notesSaving = $state(false);

	// Get unique statuses for filter dropdown
	const statuses = ['all', 'new', 'printing', 'ready', 'shipped', 'delivered', 'refunded'];

	// Filter orders
	let filteredOrders = $derived(
		data.orders.filter((order: any) => {
			// Status filter
			if (statusFilter !== 'all' && order.status !== statusFilter) {
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
		})
	);

	// Format currency
	function formatCurrency(amount: number, currency = 'usd') {
		return new Intl.NumberFormat('en-US', {
			style: 'currency',
			currency: currency.toUpperCase()
		}).format(amount / 100);
	}

	// Format date
	function formatDate(dateStr: string) {
		return new Date(dateStr).toLocaleDateString('en-US', {
			month: 'short',
			day: 'numeric',
			year: 'numeric',
			hour: 'numeric',
			minute: '2-digit'
		});
	}

	// Status colors
	const statusColors: Record<string, string> = {
		new: 'bg-blue-500 text-white',
		printing: 'bg-yellow-500 text-black',
		ready: 'bg-yellow-500 text-black',
		shipped: 'bg-purple-500 text-white',
		delivered: 'bg-green-500 text-white',
		refunded: 'bg-red-500 text-white'
	};

	// Update status
	async function updateStatus(orderId: string, newStatus: string) {
		try {
			const response = await fetch(`/api/admin/orders/${orderId}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ status: newStatus })
			});
			if (response.ok) {
				// Update local data
				const order = data.orders.find((o: any) => o._id === orderId);
				if (order) {
					order.status = newStatus;
					data.orders = [...data.orders];
				}
				// Also update selected order if it's the one being viewed
				if (selectedOrder?._id === orderId) {
					selectedOrder.status = newStatus;
				}
			}
		} catch (err) {
			console.error('Failed to update status:', err);
		}
	}

	// Open order details modal
	function openOrderDetails(order: any) {
		selectedOrder = order;
		notesValue = order.notes || '';
	}

	// Close modal
	function closeModal() {
		selectedOrder = null;
	}

	// Save notes
	async function saveNotes() {
		if (!selectedOrder) return;

		notesSaving = true;
		try {
			const response = await fetch(`/api/admin/orders/${selectedOrder._id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ notes: notesValue })
			});
			if (response.ok) {
				// Update local data
				const order = data.orders.find((o: any) => o._id === selectedOrder._id);
				if (order) {
					order.notes = notesValue;
					data.orders = [...data.orders];
				}
				selectedOrder.notes = notesValue;
			}
		} catch (err) {
			console.error('Failed to save notes:', err);
		} finally {
			notesSaving = false;
		}
	}
</script>

<SEO title="Orders | Admin" description="Manage orders" />

<div class="container mx-auto px-4 py-8 max-w-6xl">
	<header class="mb-8">
		<h1 class="h1">Orders</h1>
		<p class="text-surface-400">Manage and fulfill orders</p>
	</header>

	<!-- Filters -->
	<div class="flex flex-col sm:flex-row gap-4 mb-6">
		<!-- Search -->
		<div class="flex-1">
			<input
				type="text"
				bind:value={searchQuery}
				placeholder="Search by email, order #, or name..."
				class="input w-full"
			/>
		</div>
		<!-- Status filter -->
		<div class="sm:w-48">
			<select bind:value={statusFilter} class="select w-full">
				{#each statuses as status}
					<option value={status}>
						{status === 'all' ? 'All Statuses' : status.charAt(0).toUpperCase() + status.slice(1)}
					</option>
				{/each}
			</select>
		</div>
	</div>

	<!-- Orders table -->
	<div class="table-wrapper overflow-x-auto">
		<table class="table table-hover">
			<thead>
				<tr>
					<th>Order</th>
					<th>Date</th>
					<th>Customer</th>
					<th>Items</th>
					<th>Total</th>
					<th>Status</th>
				</tr>
			</thead>
			<tbody>
				{#each filteredOrders as order (order._id)}
					<tr class="hover cursor-pointer" onclick={() => openOrderDetails(order)}>
						<td>
							<span class="font-mono text-sm">{order.orderNumber}</span>
						</td>
						<td>
							<span class="text-sm">{formatDate(order.createdAt)}</span>
						</td>
						<td>
							<div class="flex flex-col">
								<span>{order.customerName || '—'}</span>
								<span class="text-sm text-surface-400">{order.customerEmail || '—'}</span>
							</div>
						</td>
						<td>
							<span class="bg-surface-500/20 text-surface-100-700-token">
								{order.items?.length || 0} item{(order.items?.length || 0) !== 1 ? 's' : ''}
							</span>
						</td>
						<td>
							<span class="font-semibold">{formatCurrency(order.total, order.currency)}</span>
						</td>
						<td onclick={(e) => e.stopPropagation()}>
							<select
								value={order.status}
								onchange={(e) => updateStatus(order._id, e.currentTarget.value)}
								class="select text-sm {statusColors[order.status] || 'bg-surface-500/20' } capitalize"
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
		<div class="text-center py-12 text-surface-400">
			No orders found
		</div>
	{/if}
</div>

<!-- Order Details Modal -->
{#if selectedOrder}
	<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onclick={closeModal}>
		<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
		<div class="bg-surface-100-800-token p-6 rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto" onclick={(e) => e.stopPropagation()}>
			<div class="flex justify-between items-start mb-4">
				<div>
					<h2 class="h2">{selectedOrder.orderNumber}</h2>
					<p class="text-surface-400">{formatDate(selectedOrder.createdAt)}</p>
				</div>
				<button class="btn-icon btn-icon-sm variant-filled" onclick={closeModal}>✕</button>
			</div>

			<!-- Status -->
			<div class="mb-4">
				<label class="label mb-2">Status</label>
				<select
					value={selectedOrder.status}
					onchange={(e) => updateStatus(selectedOrder._id, e.currentTarget.value)}
					class="select {statusColors[selectedOrder.status] || 'bg-surface-500/20' } capitalize w-full"
				>
					{#each statuses.filter(s => s !== 'all') as status}
						<option value={status}>{status}</option>
					{/each}
				</select>
			</div>

			<!-- Customer Info -->
			<div class="mb-4">
				<h3 class="h3 mb-2">Customer</h3>
				<p><strong>Name:</strong> {selectedOrder.customerName || '—'}</p>
				<p><strong>Email:</strong> {selectedOrder.customerEmail || '—'}</p>
			</div>

			<!-- Shipping Address -->
			{#if selectedOrder.shippingAddress}
				<div class="mb-4">
					<h3 class="h3 mb-2">Shipping Address</h3>
					<p>{selectedOrder.shippingAddress.line1}</p>
					{#if selectedOrder.shippingAddress.line2}<p>{selectedOrder.shippingAddress.line2}</p>{/if}
					<p>{selectedOrder.shippingAddress.city}, {selectedOrder.shippingAddress.state} {selectedOrder.shippingAddress.postalCode}</p>
					<p>{selectedOrder.shippingAddress.country}</p>
				</div>
			{/if}

			<!-- Items -->
			<div class="mb-4">
				<h3 class="h3 mb-2">Items</h3>
				<ul class="list-disc pl-4">
					{#each selectedOrder.items || [] as item}
						<li>
							{item.productName} × {item.quantity} — {formatCurrency(item.price, selectedOrder.currency)}
						</li>
					{/each}
				</ul>
				<p class="mt-2 font-semibold">Total: {formatCurrency(selectedOrder.total, selectedOrder.currency)}</p>
			</div>

			<!-- Notes -->
			<div class="mb-4">
				<label class="label mb-2">Notes</label>
				<textarea
					bind:value={notesValue}
					class="textarea"
					rows="3"
					placeholder="Add fulfillment notes (e.g., printed on matte paper, shipped to PO box)"
				></textarea>
				<button
					class="btn variant-filled mt-2"
					disabled={notesSaving}
					onclick={saveNotes}
				>
					{notesSaving ? 'Saving...' : 'Save Notes'}
				</button>
			</div>
		</div>
	</div>
{/if}
