// Currency formatting
export function formatCents(amount: number): string {
	return new Intl.NumberFormat("en-US", {
		style: "currency",
		currency: "USD",
	}).format(amount / 100);
}

export function dollarsToCents(dollars: number): number {
	return Math.round(dollars * 100);
}

// Date formatting
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

export function formatTimestamp(ts: number): string {
	return formatDateTime(new Date(ts).toISOString());
}

export function formatStatus(status: string): string {
	return status.replace(/_/g, " ").replace(/-/g, " ");
}

export function relativeTime(ts: number): string {
	const diff = Date.now() - ts;
	const minutes = Math.floor(diff / 60000);
	if (minutes < 1) return "just now";
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.floor(hours / 24);
	if (days < 30) return `${days}d ago`;
	return formatDate(new Date(ts).toISOString());
}

// Status colors
export type StatusColorMap = Record<string, string>;

export function getStatusColor(
	map: StatusColorMap,
	status: string,
	fallback = "var(--status-slate)",
): string {
	return map[status] || fallback;
}

export const CLIENT_STATUS_COLORS: StatusColorMap = {
	lead: "var(--status-slate)",
	booked: "var(--status-amber)",
	"in-progress": "var(--status-lavender)",
	completed: "var(--status-sage)",
	archived: "var(--admin-text-subtle)",
};

export const INVOICE_STATUS_COLORS: StatusColorMap = {
	draft: "var(--status-slate)",
	sent: "var(--status-amber)",
	paid: "var(--status-sage)",
	partial: "var(--status-lavender)",
	overdue: "var(--status-rose)",
	canceled: "var(--admin-text-subtle)",
};

export const QUOTE_STATUS_COLORS: StatusColorMap = {
	draft: "var(--status-slate)",
	sent: "var(--status-amber)",
	accepted: "var(--status-sage)",
	declined: "var(--status-rose)",
	expired: "var(--admin-text-subtle)",
};

export const CONTRACT_STATUS_COLORS: StatusColorMap = {
	draft: "var(--status-slate)",
	sent: "var(--status-amber)",
	signed: "var(--status-sage)",
	expired: "var(--admin-text-subtle)",
};

export const ORDER_STATUS_COLORS: StatusColorMap = {
	new: "var(--status-slate)",
	printing: "var(--status-amber)",
	ready: "var(--status-lavender)",
	shipped: "var(--status-peach)",
	delivered: "var(--status-sage)",
	refunded: "var(--status-rose)",
};

export const INQUIRY_STATUS_COLORS: StatusColorMap = {
	new: "var(--status-amber)",
	read: "var(--status-lavender)",
	replied: "var(--status-sage)",
};

export const CATEGORY_COLORS: StatusColorMap = {
	photography: "var(--status-peach)",
	web: "var(--status-lavender)",
};

export const SUBSCRIPTION_STATUS_COLORS: StatusColorMap = {
	active: "var(--status-sage)",
	canceled: "var(--status-rose)",
	past_due: "var(--status-amber)",
	none: "var(--status-slate)",
};
