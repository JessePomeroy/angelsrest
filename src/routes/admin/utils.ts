/**
 * Admin utility functions for formatting and status management
 */

export function formatCurrency(amount: number): string {
	return new Intl.NumberFormat("en-US", {
		style: "currency",
		currency: "USD",
	}).format(amount / 100);
}

export function formatDate(dateStr: string): string {
	return new Date(dateStr).toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
		year: "numeric",
	});
}

export function formatDateTime(dateStr: string): string {
	return new Date(dateStr).toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
		year: "numeric",
		hour: "numeric",
		minute: "2-digit",
	});
}

export function formatStatus(status: string): string {
	return status.replace(/_/g, " ");
}

export const ORDER_STATUSES = [
	"new",
	"printing",
	"ready",
	"shipped",
	"delivered",
	"refunded",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

export function getStatusColor(status: string): string {
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
