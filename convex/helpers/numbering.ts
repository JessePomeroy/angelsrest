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
