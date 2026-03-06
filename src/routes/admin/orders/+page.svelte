<script lang="ts">
	import SEO from '$lib/components/SEO.svelte';

	let { data } = $props();

	// Filter state
	let statusFilter = $state('all');
	let searchQuery = $state('');
	let yearFilter = $state('all');

	// Modal state
	let selectedOrder = $state<any>(null);
	let notesValue = $state('');
	let notesSaving = $state(false);

	// Get unique statuses for filter dropdown
	const statuses = ['all', 'new', 'printing', 'ready', 'shipped', 'delivered', 'refunded'];

	// Get unique years from orders for the filter
	let availableYears = $derived(
		[...new Set(data.orders.map((o: any) => new Date(o.createdAt).getFullYear()))].sort((a, b) => b - a)
	);

	// Filter orders
	let filteredOrders = $derived(
		data.orders.filter((order: any) => {
			// Status filter
			if (statusFilter !== 'all' && order.status !== statusFilter) {
				return false;
			}
			// Year filter
			if (yearFilter !== 'all' && new Date(order.createdAt).getFullYear() !== parseInt(yearFilter)) {
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

	// Calculate totals for filtered orders
	let totalRevenue = $derived(
		filteredOrders.reduce((sum: number, order: any) => sum + (order.total || 0), 0)
	);

	// Calculate totals for ALL orders (regardless of filter)
	let allTimeRevenue = $derived(
		data.orders.reduce((sum: number, order: any) => sum + (order.total || 0), 0)
	);

	function formatCurrency(amount: number, currency = 'usd') {
		return new Intl.NumberFormat('en-US', {
			style: 'currency',
			currency: currency.toUpperCase()
		}).format(amount / 100);
	}

	function formatDate(dateStr: string) {
		return new Date(dateStr).toLocaleDateString('en-US', {
			month: 'short',
			day: 'numeric',
			year: 'numeric',
			hour: 'numeric',
			minute: '2-digit'
		});
	}

	function getStatusClass(status: string): string {
		const colors: Record<string, string> = {
			new: 'bg-blue-600 text-white px-2 py-1 rounded text-xs',
			printing: 'bg-yellow-500 text-black px-2 py-1 rounded text-xs',
			ready: 'bg-yellow-500 text-black px-2 py-1 rounded text-xs',
			shipped: 'bg-purple-600 text-white px-2 py-1 rounded text-xs',
			delivered: 'bg-green-600 text-white px-2 py-1 rounded text-xs',
			refunded: 'bg-red-600 text-white px-2 py-1 rounded text-xs'
		};
		return colors[status] || 'bg-gray-500 text-white px-2 py-1 rounded text-xs';
	}

	async function updateStatus(orderId: string, newStatus: string) {
		try {
			const response = await fetch(`/api/admin/orders/${orderId}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ status: newStatus })
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
			console.error('Failed to update status:', err);
		}
	}

	function openOrderDetails(order: any) {
		selectedOrder = order;
		notesValue = order.notes || '';
	}

	function closeModal() {
		selectedOrder = null;
	}

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

	// Export filtered orders to CSV
	function exportCSV() {
		const headers = ['Order Number', 'Date', 'Customer Name', 'Customer Email', 'Items', 'Total', 'Status', 'Notes'];
		
		const rows = filteredOrders.map((order: any) => [
			order.orderNumber || '',
			new Date(order.createdAt).toLocaleDateString('en-US'),
			order.customerName || '',
			order.customerEmail || '',
			(order.items || []).map((i: any) => `${i.productName} x${i.quantity}`).join('; '),
			(order.total / 100).toFixed(2),
			order.status || '',
			order.notes || ''
		]);

		const csvContent = [
			headers.join(','),
			...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
		].join('\n');

		const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
		const url = URL.createObjectURL(blob);
		const link = document.createElement('a');
		link.href = url;
		link.download = `orders-${yearFilter === 'all' ? 'all' : yearFilter}.csv`;
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
						onclick={() => openOrderDetails(order)}
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
	<div 
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
		onclick={closeModal}
	>
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
