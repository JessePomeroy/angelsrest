<script lang="ts">
import {
	formatCurrency,
	formatDate,
	formatStatus,
	getStatusColor,
} from "./utils";

let { data } = $props();

const stats = $derived(data.stats);
const dailyRevenue = $derived(data.dailyRevenue);
const recentOrders = $derived(data.recentOrders);

// Sparkline chart calculations
const chartHeight = 80;
const chartWidth = 600;
let maxRevenue = $derived(
	Math.max(...dailyRevenue.map((d: { amount: number }) => d.amount), 1),
);

let sparklinePath = $derived(() => {
	const points = dailyRevenue.map((d: { amount: number }, i: number) => {
		const x = (i / (dailyRevenue.length - 1)) * chartWidth;
		const y = chartHeight - (d.amount / maxRevenue) * (chartHeight - 8);
		return `${x},${y}`;
	});
	return `M${points.join(" L")}`;
});

let sparklineArea = $derived(() => {
	const points = dailyRevenue.map((d: { amount: number }, i: number) => {
		const x = (i / (dailyRevenue.length - 1)) * chartWidth;
		const y = chartHeight - (d.amount / maxRevenue) * (chartHeight - 8);
		return `${x},${y}`;
	});
	return `M0,${chartHeight} L${points.join(" L")} L${chartWidth},${chartHeight} Z`;
});
</script>

<div class="dashboard">
	<header class="page-header">
		<h1>Dashboard</h1>
		<p class="subtitle">Overview of your store</p>
	</header>

	<!-- Stat cards -->
	<div class="stat-grid">
		<div class="stat-card">
			<span class="stat-label">Today</span>
			<span class="stat-value">{formatCurrency(stats.todayRevenue)}</span>
		</div>
		<div class="stat-card">
			<span class="stat-label">This Week</span>
			<span class="stat-value">{formatCurrency(stats.weekRevenue)}</span>
		</div>
		<div class="stat-card">
			<span class="stat-label">This Month</span>
			<span class="stat-value">{formatCurrency(stats.monthRevenue)}</span>
		</div>
		<div class="stat-card">
			<span class="stat-label">All Time</span>
			<span class="stat-value">{formatCurrency(stats.allTimeRevenue)}</span>
			<span class="stat-sub">{stats.totalOrders} orders</span>
		</div>
	</div>

	<!-- Sparkline chart -->
	<div class="chart-card">
		<h2 class="chart-title">Revenue (Last 30 Days)</h2>
		<div class="chart-container">
			<svg viewBox="0 0 {chartWidth} {chartHeight}" preserveAspectRatio="none" class="chart-svg">
				<path d={sparklineArea()} fill="rgba(255,255,255,0.04)" />
				<path d={sparklinePath()} fill="none" stroke="rgba(255,255,255,0.4)" stroke-width="2" />
			</svg>
		</div>
	</div>

	<!-- Recent orders -->
	<div class="orders-card">
		<h2 class="section-title">Recent Orders</h2>
		{#if recentOrders.length === 0}
			<p class="empty-state">No orders yet</p>
		{:else}
			<div class="table-wrap">
				<table class="orders-table">
					<thead>
						<tr>
							<th>Order</th>
							<th>Date</th>
							<th>Customer</th>
							<th>Total</th>
							<th>Status</th>
						</tr>
					</thead>
					<tbody>
						{#each recentOrders as order (order._id)}
							<tr>
								<td class="mono">{order.orderNumber}</td>
								<td>{formatDate(order.createdAt)}</td>
								<td>
									<div class="customer-cell">
										<span>{order.customerName || "\u2014"}</span>
										<span class="email">{order.customerEmail || ""}</span>
									</div>
								</td>
								<td class="bold">{formatCurrency(order.total)}</td>
								<td>
									<span class="status-badge" style="background: {getStatusColor(order.status)}">
										{formatStatus(order.status)}
									</span>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			<div class="view-all">
				<a href="/admin/orders">View all orders</a>
			</div>
		{/if}
	</div>
</div>

<style>
	.dashboard {
		padding: 32px;
		max-width: 1100px;
	}

	.page-header {
		margin-bottom: 28px;
	}

	.page-header h1 {
		font-size: 1.6rem;
		font-weight: 600;
		color: var(--admin-heading);
		margin: 0 0 4px;
	}

	.subtitle {
		color: var(--admin-text-muted);
		font-size: 0.9rem;
		margin: 0;
	}

	.stat-grid {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 16px;
		margin-bottom: 24px;
	}

	.stat-card {
		background: var(--admin-surface);
		border: 1px solid var(--admin-border);
		border-radius: 8px;
		padding: 20px;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.stat-label {
		font-size: 0.8rem;
		color: var(--admin-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.stat-value {
		font-size: 1.4rem;
		font-weight: 600;
		color: var(--admin-heading);
	}

	.stat-sub {
		font-size: 0.8rem;
		color: var(--admin-text-subtle);
	}

	.chart-card {
		background: var(--admin-surface);
		border: 1px solid var(--admin-border);
		border-radius: 8px;
		padding: 20px;
		margin-bottom: 24px;
	}

	.chart-title {
		font-size: 0.95rem;
		font-weight: 500;
		color: var(--admin-text-muted);
		margin: 0 0 16px;
	}

	.chart-container {
		width: 100%;
		height: 80px;
	}

	.chart-svg {
		width: 100%;
		height: 100%;
	}

	.orders-card {
		background: var(--admin-surface);
		border: 1px solid var(--admin-border);
		border-radius: 8px;
		padding: 20px;
	}

	.section-title {
		font-size: 0.95rem;
		font-weight: 500;
		color: var(--admin-text-muted);
		margin: 0 0 16px;
	}

	.table-wrap {
		overflow-x: auto;
	}

	.orders-table {
		width: 100%;
		border-collapse: collapse;
		text-align: left;
		font-size: 0.88rem;
	}

	.orders-table th {
		color: var(--admin-text-subtle);
		font-weight: 500;
		font-size: 0.78rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		padding: 8px 12px;
		border-bottom: 1px solid var(--admin-border-strong);
	}

	.orders-table td {
		padding: 10px 12px;
		border-bottom: 1px solid var(--admin-border);
		color: var(--admin-text);
	}

	.orders-table tbody tr:hover {
		background: var(--admin-active);
	}

	.mono {
		font-family: monospace;
		font-size: 0.82rem;
	}

	.bold {
		font-weight: 600;
	}

	.customer-cell {
		display: flex;
		flex-direction: column;
	}

	.email {
		font-size: 0.78rem;
		color: var(--admin-text-subtle);
	}

	.status-badge {
		display: inline-block;
		padding: 3px 10px;
		border-radius: 12px;
		font-size: 0.75rem;
		font-weight: 500;
		color: #fff;
		text-transform: capitalize;
	}

	.view-all {
		padding-top: 16px;
		text-align: center;
	}

	.view-all a {
		color: var(--admin-text-muted);
		text-decoration: none;
		font-size: 0.85rem;
	}

	.view-all a:hover {
		color: var(--admin-accent-hover);
	}

	.empty-state {
		text-align: center;
		padding: 32px;
		color: var(--admin-text-subtle);
	}

	@media (max-width: 768px) {
		.dashboard {
			padding: 20px 16px;
		}

		.stat-grid {
			grid-template-columns: repeat(2, 1fr);
		}
	}

	@media (max-width: 480px) {
		.stat-grid {
			grid-template-columns: 1fr;
		}
	}
</style>
