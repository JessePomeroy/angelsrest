<script lang="ts">
	import { page } from '$app/stores';

	let email = $state($page.url.searchParams.get('email') || '');
	let orderNumber = $state($page.url.searchParams.get('order') || '');
	let loading = $state(false);
	let error = $state('');
	let order: any = $state(null);

	async function lookupOrder() {
		if (!email || !orderNumber) {
			error = 'Please enter both email and order number';
			return;
		}

		loading = true;
		error = '';
		order = null;

		try {
			const response = await fetch(`/api/orders/lookup?email=${encodeURIComponent(email)}&order=${encodeURIComponent(orderNumber)}`);
			const data = await response.json();
			
			if (response.ok && data.order) {
				order = data.order;
			} else {
				error = data.error || 'Order not found';
			}
		} catch (err) {
			error = 'Failed to look up order';
		} finally {
			loading = false;
		}
	}

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
			year: 'numeric'
		});
	}

	const statusLabels: Record<string, string> = {
		new: 'New',
		printing: 'Printing',
		ready: 'Ready',
		shipped: 'Shipped',
		delivered: 'Delivered',
		refunded: 'Refunded'
	};

	const statusColors: Record<string, string> = {
		new: 'bg-blue-600',
		printing: 'bg-yellow-500 text-black',
		ready: 'bg-yellow-500 text-black',
		shipped: 'bg-purple-600',
		delivered: 'bg-green-600',
		refunded: 'bg-red-600'
	};
</script>

<svelte:head>
	<title>Track Order | Angel's Rest</title>
</svelte:head>

<div class="min-h-screen bg-gray-950 text-white p-4">
	<div class="max-w-md mx-auto">
		<a href="/" class="text-lg font-bold hover:text-gray-300">← Angel's Rest</a>
		
		<h1 class="text-xl font-bold mt-4 mb-1">Track Your Order</h1>
		<p class="text-gray-400 text-sm mb-4">Enter your order details to check the status</p>

		<div class="rounded-lg border border-gray-800 p-4 space-y-3">
			<div>
				<label for="email" class="block text-xs text-gray-400 mb-1">Email</label>
				<input
					id="email"
					type="email"
					bind:value={email}
					placeholder="you@example.com"
					class="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded text-sm"
				/>
			</div>

			<div>
				<label for="order" class="block text-xs text-gray-400 mb-1">Order Number</label>
				<input
					id="order"
					type="text"
					bind:value={orderNumber}
					placeholder="ORD-001"
					class="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded text-sm"
				/>
			</div>

			<button
				onclick={lookupOrder}
				disabled={loading}
				class="w-full py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 rounded text-sm font-medium"
			>
				{loading ? 'Looking up...' : 'Track Order'}
			</button>

			{#if error}
				<p class="text-red-400 text-sm text-center">{error}</p>
			{/if}
		</div>

		{#if order}
			<div class="mt-4 rounded-lg border border-gray-800 p-4">
				<div class="flex justify-between items-start mb-3">
					<div>
						<h2 class="text-lg font-bold">{order.orderNumber}</h2>
						<p class="text-gray-400 text-xs">{formatDate(order.createdAt)}</p>
					</div>
					<span class="px-2 py-1 rounded text-xs font-medium {statusColors[order.status] || 'bg-gray-600'}">
						{statusLabels[order.status] || order.status}
					</span>
				</div>

				<div class="text-sm">
					<h3 class="font-medium text-gray-400 text-xs mb-1">Items</h3>
					<ul class="space-y-1">
						{#each order.items || [] as item}
							<li class="flex justify-between text-sm">
								<span>{item.productName} × {item.quantity}</span>
								<span class="text-gray-400">{formatCurrency(item.price, order.currency)}</span>
							</li>
						{/each}
					</ul>
					<p class="font-medium mt-2 text-right">
						Total: {formatCurrency(order.total, order.currency)}
					</p>
				</div>

				{#if order.shippingAddress}
					<div class="mt-3 pt-3 border-t border-gray-700">
						<h3 class="font-medium text-gray-400 text-xs mb-1">Ship to</h3>
						<p class="text-sm text-gray-300">
							{order.customerName}<br/>
							{order.shippingAddress.line1}<br/>
							{#if order.shippingAddress.line2}{order.shippingAddress.line2}<br/>{/if}
							{order.shippingAddress.city}, {order.shippingAddress.state} {order.shippingAddress.postalCode}
						</p>
					</div>
				{/if}
			</div>
		{/if}
	</div>
</div>
