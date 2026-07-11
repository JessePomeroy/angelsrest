import type { QueryCtx } from "../_generated/server";

/**
 * Generate the next order number.
 *
 * Queries the table for the latest document by siteUrl, extracts the
 * numeric suffix from the existing number field, and increments it.
 *
 * @param ctx - Convex query context
 * @param siteUrl - Site URL filter
 * @returns Next number string (e.g. "ORD-042")
 *
 * Concurrency depends on the caller. `orders.create` invokes this helper inside
 * the mutation that persists the number, so Convex OCC retries conflicting
 * reads. Invoice and quote creation use per-site counters in
 * documentNumbering.ts. This helper does not itself provide uniqueness.
 */
export async function getNextOrderNumber(
	ctx: QueryCtx,
	siteUrl: string,
): Promise<string> {
	const [latest] = await ctx.db
		.query("orders")
		.withIndex("by_siteUrl", (q) => q.eq("siteUrl", siteUrl))
		.order("desc")
		.take(1);

	if (!latest) return "ORD-001";

	const num = Number.parseInt(latest.orderNumber.replace("ORD-", ""), 10);
	return `ORD-${String(num + 1).padStart(3, "0")}`;
}
