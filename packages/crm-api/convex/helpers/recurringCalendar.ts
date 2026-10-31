export type RecurringInterval = "weekly" | "monthly" | "quarterly" | "yearly";
export function calendarDate(value: string): number {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Use a calendar date (YYYY-MM-DD)");
	const time = Date.parse(`${value}T00:00:00Z`);
	if (
		!Number.isFinite(time) ||
		new Date(time).toISOString().slice(0, 10) !== value ||
		value < "2000-01-01" ||
		value > "2099-12-31"
	)
		throw new Error("Date must be between 2000 and 2099");
	return time;
}
/** UTC calendar dates; short months clamp to their last day without drifting the anchor. */
export function recurringDate(anchor: string, interval: RecurringInterval, cycle: number): string {
	const start = new Date(calendarDate(anchor));
	if (!Number.isSafeInteger(cycle) || cycle < 0 || cycle > 40_000)
		throw new Error("Invalid recurring cycle");
	if (interval === "weekly") start.setUTCDate(start.getUTCDate() + cycle * 7);
	else {
		const day = start.getUTCDate();
		const months = cycle * (interval === "monthly" ? 1 : interval === "quarterly" ? 3 : 12);
		start.setUTCDate(1);
		start.setUTCMonth(start.getUTCMonth() + months);
		const last = new Date(
			Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0),
		).getUTCDate();
		start.setUTCDate(Math.min(day, last));
	}
	return start.toISOString().slice(0, 10);
}
