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
			month: 'long',
			day: 'numeric',
			year: 'numeric'
		});
	}

	const statusLabels: Record<string, string> = {
		new: 'New',
		printing: 'Printing',
		ready: 'Ready to Ship',
		shipped: 'Shipped',
		delivered: 'Delivered',
		refunded: 'Refunded'
	};
</script>

<svelte:head>
	<title>Track Order | Angel's Rest</title>
</svelte:head>

<div class="min-h-screen bg-gray-900 text-white">
	<div class="container mx-auto px-4 py-16 max-w-xl">
		<a href="/" class="text-2xl font-bold hover:text-gray-300">← Angel's Rest</a>
		
		<h1 class="text-3xl font-bold mt-8 mb-2">Track Your Order</h1>
		<p class="text-gray-400 mb-8">Enter your order details to check the status</p>

		<div class="bg-gray-800 rounded-lg p-6">
			<div class="space-y-4">
				<div>
					<label for="email" class="block text-sm text-gray-400 mb-1">Email</label>
					<input
						id="email"
						type="email"
						bind:value={email}
						placeholder="you@example.com"
						class="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded text-white"
					/>
				</div>

				<div>
					<label for="order" class="block text-sm text-gray-400 mb-1">Order Number</label>
					<input
						id="order"
						type="text"
						bind:value={orderNumber}
						placeholder="ORD-001"
						class="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded text-white"
					/>
				</div>

				<button
					onclick={lookupOrder}
					disabled={loading}
					class="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 rounded font-semibold"
				>
					{loading ? 'Looking up...' : 'Track Order'}
				</button>
			</div>

			{#if error}
				<p class="mt-4 text-red-400 text-center">{error}</p>
			{/if}
		</div>

		{#if order}
			<div class="mt-8 bg-gray-800 rounded-lg p-6">
				<div class="flex justify-between items-start mb-4">
					<div>
						<h2 class="text-2xl font-bold">{order.orderNumber}</h2>
						<p class="text-gray-400">{formatDate(order.createdAt)}</p>
					</div>
					<span class="px-3 py-1 rounded text-sm font-medium bg-blue-600 text-white">
						{statusLabels[order.status] || order.status}
					</span>
				</div>

				<div class="border-t border-gray-700 pt-4 mt-4">
					<h3 class="font-semibold mb-2">Items</h3>
					<ul class="space-y-2">
						{#each order.items || [] as item}
							<li class="flex justify-between">
								<span>{item.productName} × {item.quantity}</span>
								<span class="text-gray-400">{formatCurrency(item.price, order.currency)}</span>
							</li>
						{/each}
					</ul>
					<p class="font-semibold mt-4 text-right">
						Total: {formatCurrency(order.total, order.currency)}
					</p>
				</div>

				{#if order.shippingAddress}
					<div class="border-t border-gray-700 pt-4 mt-4">
						<h3 class="font-semibold mb-2">Shipping Address</h3>
						<p class="text-gray-300">
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
