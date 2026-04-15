import type { Id, TableNames } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { requireAuth } from "../authHelpers";

/**
 * Delete a document with auth and siteUrl ownership check.
 *
 * - Verifies the caller is authenticated.
 * - Loads the document and throws "Not found" if missing or its siteUrl
 *   doesn't match the supplied siteUrl.
 * - Deletes the document.
 */
export async function deleteDocument<T extends TableNames>(
	ctx: MutationCtx,
	id: Id<T>,
	siteUrl: string,
): Promise<void> {
	await requireAuth(ctx);
	const doc = await ctx.db.get(id);
	if (!doc || (doc as { siteUrl?: string }).siteUrl !== siteUrl) {
		throw new Error("Not found");
	}
	await ctx.db.delete(id);
}
