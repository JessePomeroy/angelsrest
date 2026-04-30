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
 * DocType label used in the activityLog metadata. Audit M28: callers pass
 * this explicitly — we previously inferred it by splitting `action` on the
 * first "_", which broke for multi-word actions (e.g. "invoice_partial_paid").
 */
type DocType = "quote" | "contract" | "invoice";

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
	docType: DocType,
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
		metadata: JSON.stringify({ docType, docId: id }),
	});
}
