import type { Doc, TableNames } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

/**
 * Tables in the schema that have both a `siteUrl` field and a `by_siteUrl`
 * index. Derived structurally from the generated Doc types, so adding a
 * new siteUrl-indexed table extends this automatically — no enumeration
 * to maintain.
 */
type TableWithSiteUrl = {
	[K in TableNames]: Doc<K> extends { siteUrl: string } ? K : never;
}[TableNames];

/**
 * List documents for a given siteUrl in descending creation order, with
 * optional post-fetch status filtering.
 *
 * Mirrors the pattern previously duplicated in quotes.list, contracts.list,
 * and invoices.list: `by_siteUrl` index → `.order("desc")` → `.take(limit)`
 * → optional post-filter by status.
 *
 * Note: this helper uses the `by_siteUrl` index and post-filters for status
 * so behavior is identical to the original implementations. Callers that
 * have a compound `by_siteUrl_status` index and want the more efficient
 * path (like orders.list) should query directly rather than use this helper.
 */
export async function queryBySiteUrl<T extends TableWithSiteUrl>(
	ctx: QueryCtx,
	table: T,
	siteUrl: string,
	options?: { status?: string; limit?: number },
): Promise<Doc<T>[]> {
	const limit = options?.limit ?? 200;
	const all = (await ctx.db
		.query(table)
		.withIndex("by_siteUrl" as never, (q) =>
			(q as unknown as { eq: (f: string, v: string) => typeof q }).eq(
				"siteUrl",
				siteUrl,
			),
		)
		.order("desc")
		.take(limit)) as Doc<T>[];
	const status = options?.status;
	if (status === undefined) return all;
	return all.filter((doc) => (doc as { status?: string }).status === status);
}
