import type { QueryCtx } from "../_generated/server";

/** Tables with a `by_siteUrl` index and a numbered-document field. */
type NumberedTable = "orders" | "invoices" | "quotes";

/** Per-table name of the number field, mirrored from the schema. */
type NumberField = {
	orders: "orderNumber";
	invoices: "invoiceNumber";
	quotes: "quoteNumber";
};

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
 * Concurrency depends on the caller. `orders.create` invokes this helper inside
 * the mutation that persists the number, so Convex OCC retries conflicting
 * reads. Invoice and quote flows currently expose separate `getNextNumber`
 * queries and accept caller-supplied numbers in their create mutations; those
 * callers can race because preview and persistence are different transactions.
 * This helper does not itself provide uniqueness. A flow that requires an
 * authoritative number must generate/persist it in one mutation or atomically
 * update a per-site/type counter.
 */
export async function getNextSequentialNumber<T extends NumberedTable>(
	ctx: QueryCtx,
	table: T,
	siteUrl: string,
	numberField: NumberField[T],
	prefix: string,
): Promise<string> {
	let latest: Record<string, unknown> | null;
	if (table === "orders") {
		const [row] = await ctx.db
			.query("orders")
			.withIndex("by_siteUrl", (q) => q.eq("siteUrl", siteUrl))
			.order("desc")
			.take(1);
		latest = row ?? null;
	} else if (table === "invoices") {
		const [row] = await ctx.db
			.query("invoices")
			.withIndex("by_siteUrl", (q) => q.eq("siteUrl", siteUrl))
			.order("desc")
			.take(1);
		latest = row ?? null;
	} else {
		const [row] = await ctx.db
			.query("quotes")
			.withIndex("by_siteUrl", (q) => q.eq("siteUrl", siteUrl))
			.order("desc")
			.take(1);
		latest = row ?? null;
	}

	if (!latest) return `${prefix}001`;

	const existing = latest[numberField] as string;
	const num = Number.parseInt(existing.replace(prefix, ""), 10);
	return `${prefix}${String(num + 1).padStart(3, "0")}`;
}
