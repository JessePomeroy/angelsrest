import type { Id, TableNames } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { requireSiteAdmin } from "../authHelpers";

/**
 * Delete a document with tenant-admin auth and siteUrl ownership check.
 *
 * - Verifies the caller is an authenticated admin of `siteUrl` (audit C8).
 * - Loads the document and throws "Not found" if missing or its siteUrl
 *   doesn't match the supplied siteUrl.
 * - Deletes the document.
 */
export async function deleteDocument<T extends TableNames>(
	ctx: MutationCtx,
	id: Id<T>,
	siteUrl: string,
): Promise<void> {
	await requireSiteAdmin(ctx, siteUrl);
	const doc = await ctx.db.get(id);
	if (!doc || (doc as { siteUrl?: string }).siteUrl !== siteUrl) {
		throw new Error("Not found");
	}
	await ctx.db.delete(id);
}
