<script lang="ts">
	import SEO from '$lib/components/SEO.svelte';

	let { data } = $props();

	// Filter state
	let statusFilter = $state('all');
	let searchQuery = $state('');

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
		new: 'badge-info',
		printing: 'badge-warning',
		ready: 'badge-warning',
		shipped: 'badge-primary',
		delivered: 'badge-success',
		refunded: 'badge-error'
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
			}
		} catch (err) {
			console.error('Failed to update status:', err);
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
					<tr class="hover">
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
							<span class="badge variant-soft">
								{order.items?.length || 0} item{(order.items?.length || 0) !== 1 ? 's' : ''}
							</span>
						</td>
						<td>
							<span class="font-semibold">{formatCurrency(order.total, order.currency)}</span>
						</td>
						<td>
							<select
								value={order.status}
								onchange={(e) => updateStatus(order._id, e.currentTarget.value)}
								class="select text-sm {statusColors[order.status] || 'badge'} capitalize"
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
