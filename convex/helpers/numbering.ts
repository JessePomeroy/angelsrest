import type { QueryCtx } from "../_generated/server";

/**
 * Generate the next sequential number for a document type.
 *
 * Queries the table for the latest document by siteUrl, extracts the
 * numeric suffix from the existing number field, and increments it.
 *
 * @param ctx - Convex query context
 * @param table - Table name to query
 * @param siteUrl - Site URL filter
 * @param numberField - Field name containing the number (e.g. "orderNumber")
 * @param prefix - Prefix for the number (e.g. "ORD-")
 * @returns Next number string (e.g. "ORD-042")
 *
 * Audit H15 note on concurrency: this helper is called from inside Convex
 * mutations (orders.create, invoices.create, quotes.create). Convex runs
 * mutations as serializable transactions via OCC — if two concurrent
 * mutations both read "latest = ORD-005" and both try to write ORD-006,
 * the second commit detects its read set has been invalidated by the
 * first and retries automatically with a fresh snapshot. So the theoretical
 * double-issue race doesn't actually fire as long as the caller lives in
 * a Convex mutation context. Direct `ctx.runQuery` calls from outside a
 * mutation (e.g. a UI preview of the next number) can read stale values,
 * but those are display-only and not persisted — so they can't create the
 * duplicate.
 *
 * A stricter defense would require a `counters` table with a single row
 * per (siteUrl, docType) that each creating mutation atomically patches;
 * deferred because the current OCC behavior is correct. See audit H15.
 */
export async function getNextSequentialNumber(
	ctx: QueryCtx,
	table: string,
	siteUrl: string,
	numberField: string,
	prefix: string,
): Promise<string> {
	const latest = await (ctx.db as any)
		.query(table)
		.withIndex("by_siteUrl", (q: any) => q.eq("siteUrl", siteUrl))
		.order("desc")
		.take(1);

	if (!latest[0]) return `${prefix}001`;

	const num = Number.parseInt(
		(latest[0][numberField] as string).replace(prefix, ""),
		10,
	);
	return `${prefix}${String(num + 1).padStart(3, "0")}`;
}
