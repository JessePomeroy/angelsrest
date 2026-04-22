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
 * Tables that ALSO have a `by_siteUrl_status` compound index. Listed
 * explicitly because each table's `status` enum is different and the
 * Convex type system cannot generically prove a shared shape.
 */
const TABLES_WITH_STATUS_INDEX = new Set<TableWithSiteUrl>([
	"contracts",
	"invoices",
	"orders",
	"quotes",
	"inquiries",
]);

/**
 * List documents for a given siteUrl in descending creation order, with
 * optional status filtering.
 *
 * When `status` is provided AND the table has a `by_siteUrl_status`
 * compound index (see `TABLES_WITH_STATUS_INDEX`), the helper uses the
 * compound index for an efficient index-side filter. Otherwise it falls
 * back to fetching by `by_siteUrl` and post-filtering in memory.
 *
 * Previously this helper ALWAYS post-filtered, which meant any status-filtered
 * list could silently drop results once the total row count for the siteUrl
 * exceeded `limit` — see audit H12.
 */
export async function queryBySiteUrl<T extends TableWithSiteUrl>(
	ctx: QueryCtx,
	table: T,
	siteUrl: string,
	options?: { status?: string; limit?: number },
): Promise<Doc<T>[]> {
	const limit = options?.limit ?? 200;
	const status = options?.status;

	// Fast path: compound index covers `[siteUrl, status]`.
	if (status !== undefined && TABLES_WITH_STATUS_INDEX.has(table)) {
		// Two `as never` casts are required because Convex's query-builder
		// types the field paths per-table; with a generic `T extends union`
		// the compiler can't resolve the shared "siteUrl"/"status" paths.
		// The membership check above enforces the runtime invariant.
		return await ctx.db
			.query(table)
			.withIndex("by_siteUrl_status" as never, (q: any) =>
				q.eq("siteUrl", siteUrl).eq("status", status),
			)
			.order("desc")
			.take(limit);
	}

	// Generic path: by_siteUrl + post-filter.
	const all = await ctx.db
		.query(table)
		.withIndex("by_siteUrl", (q) => q.eq("siteUrl" as never, siteUrl as never))
		.order("desc")
		.take(limit);
	if (status === undefined) return all;
	return all.filter((doc) => (doc as { status?: string }).status === status);
}
