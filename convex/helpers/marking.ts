import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { patchDocument } from "./patching";

/**
 * Tables that support the markSent flow — they all have a `clientId` field
 * linking to a photographyClient and a `sentAt` timestamp.
 */
type SendableTable = "quotes" | "contracts" | "invoices";

/**
 * Mark a quote/contract/invoice as sent and log the corresponding activity.
 *
 * Uses patchDocument under the hood (auth + siteUrl ownership check), patches
 * `status: "sent"` + `sentAt: Date.now()`, then logs an activity entry for the
 * linked client. The `describe` callback receives the pre-patch document so it
 * can use stable fields like quoteNumber, title, or invoiceNumber.
 */
export async function markDocumentSent<T extends SendableTable>(
	ctx: MutationCtx,
	id: Id<T>,
	siteUrl: string,
	action: string,
	describe: (doc: Doc<T>) => string,
): Promise<void> {
	const doc = await patchDocument(ctx, id, siteUrl, {
		status: "sent",
		sentAt: Date.now(),
	});
	await ctx.runMutation(internal.activityLog.logActivity, {
		siteUrl,
		clientId: doc.clientId,
		action,
		description: describe(doc),
	});
}
