import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

/**
 * Tables that have both a `siteUrl` field and a `by_siteUrl` index.
 *
 * Explicit literal union — when you add a new siteUrl-scoped table to
 * schema.ts, add it here too. TypeScript will flag any caller that passes
 * a missing table. The list is short enough to eyeball and the alternative
 * (a mapped type derived from Doc<K>) confuses Convex's query-builder type
 * machinery and forces escape-hatch casts on every `withIndex` call.
 */
type TableWithSiteUrl =
	| "activityLog"
	| "boardConfigs"
	| "clientTagAssignments"
	| "clientTags"
	| "contractTemplates"
	| "contracts"
	| "emailLog"
	| "emailTemplates"
	| "galleries"
	| "galleryDownloads"
	| "galleryImages"
	| "inquiries"
	| "invoices"
	| "orders"
	| "photographyClients"
	| "platformClients"
	| "platformMessages"
	| "portalTokens"
	| "quotePresets"
	| "quotes";

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
	// Two `as never` casts inside the index range: Convex types .eq() with a
	// concrete field path per-table, and with a generic `T extends union` the
	// compiler can't resolve the shared "siteUrl" path or its value type.
	// TableWithSiteUrl enumerates only tables where this call is valid at
	// runtime (string `siteUrl` + `by_siteUrl` index), so the casts are
	// honest escape hatches rather than load-bearing lies.
	const all = await ctx.db
		.query(table)
		.withIndex("by_siteUrl", (q) => q.eq("siteUrl" as never, siteUrl as never))
		.order("desc")
		.take(limit);
	const status = options?.status;
	if (status === undefined) return all;
	return all.filter((doc) => (doc as { status?: string }).status === status);
}
