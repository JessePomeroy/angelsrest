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
const chartHeight = 60;
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
		<h1>dashboard</h1>
	</header>

	<!-- Stats as inline text -->
	<div class="stats-line">
		<span class="stat-item">
			<span class="stat-label">today</span>
			<span class="stat-value">{formatCurrency(stats.todayRevenue)}</span>
		</span>
		<span class="stat-sep">&middot;</span>
		<span class="stat-item">
			<span class="stat-label">this week</span>
			<span class="stat-value">{formatCurrency(stats.weekRevenue)}</span>
		</span>
		<span class="stat-sep">&middot;</span>
		<span class="stat-item">
			<span class="stat-label">this month</span>
			<span class="stat-value">{formatCurrency(stats.monthRevenue)}</span>
		</span>
		<span class="stat-sep">&middot;</span>
		<span class="stat-item">
			<span class="stat-label">all time</span>
			<span class="stat-value">{formatCurrency(stats.allTimeRevenue)}</span>
			<span class="stat-sub">{stats.totalOrders} orders</span>
		</span>
	</div>

	<!-- Sparkline chart -->
	<div class="chart-section">
		<h2 class="section-label">revenue — last 30 days</h2>
		<div class="chart-container">
			<svg viewBox="0 0 {chartWidth} {chartHeight}" preserveAspectRatio="none" class="chart-svg">
				<path d={sparklineArea()} fill="rgba(129, 140, 248, 0.06)" />
				<path d={sparklinePath()} fill="none" stroke="rgba(129, 140, 248, 0.35)" stroke-width="1.5" />
			</svg>
		</div>
	</div>

	<!-- Recent orders -->
	<div class="orders-section">
		<h2 class="section-label">recent orders</h2>
		{#if recentOrders.length === 0}
			<p class="empty-state">no orders yet</p>
		{:else}
			<div class="table-wrap">
				<table class="orders-table">
					<thead>
						<tr>
							<th>order</th>
							<th>date</th>
							<th>customer</th>
							<th>total</th>
							<th>status</th>
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
									<span class="status-indicator">
										<span class="status-dot" style="background: {getStatusColor(order.status)}"></span>
										{formatStatus(order.status)}
									</span>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			<div class="view-all">
				<a href="/admin/orders">view all orders &rarr;</a>
			</div>
		{/if}
	</div>
</div>

<style>
	.dashboard {
		padding: 48px 40px;
		max-width: 1000px;
	}

	.page-header {
		margin-bottom: 40px;
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
		margin-bottom: 48px;
		padding-bottom: 32px;
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
		font-size: 0.9rem;
	}

	/* Chart */
	.chart-section {
		margin-bottom: 48px;
	}

	.section-label {
		font-family: "Synonym", system-ui, sans-serif;
		font-size: 0.78rem;
		font-weight: 400;
		color: var(--admin-text-muted);
		letter-spacing: 0.04em;
		margin: 0 0 16px;
	}

	.chart-container {
		width: 100%;
		height: 60px;
	}

	.chart-svg {
		width: 100%;
		height: 100%;
	}

	/* Orders */
	.orders-section {
		margin-bottom: 32px;
	}

	.table-wrap {
		overflow-x: auto;
	}

	.orders-table {
		width: 100%;
		border-collapse: collapse;
		text-align: left;
		font-size: 0.86rem;
	}

	.orders-table th {
		color: var(--admin-text-subtle);
		font-weight: 400;
		font-size: 0.75rem;
		letter-spacing: 0.04em;
		padding: 0 16px 12px 0;
		border-bottom: 1px solid var(--admin-border);
	}

	.orders-table td {
		padding: 14px 16px 14px 0;
		border-bottom: 1px solid var(--admin-border);
		color: var(--admin-text);
	}

	.orders-table tbody tr:hover {
		background: var(--admin-active);
	}

	.mono {
		font-family: monospace;
		font-size: 0.8rem;
		color: var(--admin-text-muted);
	}

	.bold {
		font-weight: 500;
		color: var(--admin-heading);
	}

	.customer-cell {
		display: flex;
		flex-direction: column;
	}

	.email {
		font-size: 0.76rem;
		color: var(--admin-text-subtle);
	}

	.status-indicator {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 0.8rem;
		color: var(--admin-text-muted);
	}

	.status-dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		flex-shrink: 0;
	}

	.view-all {
		padding-top: 20px;
	}

	.view-all a {
		color: var(--admin-text-muted);
		text-decoration: none;
		font-size: 0.82rem;
		transition: color 0.15s;
	}

	.view-all a:hover {
		color: var(--admin-accent-hover);
	}

	.empty-state {
		padding: 40px 0;
		color: var(--admin-text-subtle);
		font-size: 0.88rem;
	}

	@media (max-width: 768px) {
		.dashboard {
			padding: 28px 20px;
		}

		.stats-line {
			gap: 8px;
		}

		.stat-sep {
			display: none;
		}

		.stat-item {
			flex-basis: 45%;
			flex-direction: column;
			gap: 2px;
			margin-bottom: 8px;
		}
	}
</style>
