import type { Doc, Id, TableNames } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { requireAuth } from "../authHelpers";

/**
 * Patch a document with auth, siteUrl ownership check, and undefined-filtering.
 *
 * - Verifies the caller is authenticated.
 * - Loads the document and throws "Not found" if missing or its siteUrl
 *   doesn't match the supplied siteUrl.
 * - Filters undefined values from `updates` (so optional args left off the
 *   call don't clobber existing fields).
 * - Patches only if there's anything left to write.
 *
 * Returns the pre-patch document so callers can compare values for things
 * like activity logging on status changes.
 */
export async function patchDocument<T extends TableNames>(
	ctx: MutationCtx,
	id: Id<T>,
	siteUrl: string,
	updates: Record<string, unknown>,
): Promise<Doc<T>> {
	await requireAuth(ctx);
	const doc = await ctx.db.get(id);
	if (!doc || (doc as { siteUrl?: string }).siteUrl !== siteUrl) {
		throw new Error("Not found");
	}
	const patch: Record<string, unknown> = {};
	for (const [key, val] of Object.entries(updates)) {
		if (val !== undefined) patch[key] = val;
	}
	if (Object.keys(patch).length > 0) {
		await ctx.db.patch(id, patch as Partial<Doc<T>>);
	}
	return doc;
}
