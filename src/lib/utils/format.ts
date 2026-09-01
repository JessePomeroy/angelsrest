/** Shared formatting utilities for the public site. */

export function formatCents(amount: number, currency = "USD"): string {
	return new Intl.NumberFormat("en-US", {
		style: "currency",
		currency: currency.toUpperCase(),
	}).format(amount / 100);
}

export function formatDate(dateStr: string): string {
	return new Date(dateStr).toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
		year: "numeric",
	});
}

/** Format a YYYY-MM-DD calendar value without applying the viewer's timezone. */
export function formatDateOnly(dateStr: string): string {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
	if (!match) return dateStr;
	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	const date = new Date(Date.UTC(year, month - 1, day));
	if (
		date.getUTCFullYear() !== year ||
		date.getUTCMonth() !== month - 1 ||
		date.getUTCDate() !== day
	) {
		return dateStr;
	}
	return new Intl.DateTimeFormat("en-US", {
		month: "short",
		day: "numeric",
		year: "numeric",
		timeZone: "UTC",
	}).format(date);
}

export function formatTimestamp(ts: number): string {
	return new Date(ts).toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
		year: "numeric",
		hour: "numeric",
		minute: "2-digit",
	});
}
