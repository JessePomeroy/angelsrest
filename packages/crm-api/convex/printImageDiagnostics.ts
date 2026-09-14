import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireSiteAdmin } from "./authHelpers";
import { printJobDescriptor, printJobProduct } from "./helpers/printFulfillmentJobs";

/** Read only the completed artwork for the bounded, unresolved single-print investigation. */
export const source = query({
	args: { orderId: v.id("orders") },
	returns: v.union(v.null(), v.object({
		descriptor: printJobDescriptor,
		product: printJobProduct,
		printWidth: v.number(),
		printHeight: v.number(),
	})),
	handler: async (ctx, { orderId }) => {
		await requireSiteAdmin(ctx, "angelsrest.online");
		const order = await ctx.db.get(orderId);
		if (!order || order.siteUrl !== "angelsrest.online" || order.status !== "new"
			|| order.fulfillmentType !== "lumaprints" || order.printInput?.version !== 1
			|| order.printFulfillmentPhase !== "submitting"
			|| order.printFulfillmentResolution !== "reconciliation_blocked"
			|| !order.lumaprintsSubmissionOrderNumber || order.lumaprintsOrderNumber
			|| order.stripeRefundId || !order.printJobId) return null;
		const job = await ctx.db.get(order.printJobId);
		if (!job || job.orderId !== orderId || job.stage !== "done" || job.sourceCount !== 1) return null;
		const prepared = await ctx.db.query("printFulfillmentSources")
			.withIndex("by_jobId_and_index", (q) => q.eq("jobId", job._id).eq("index", 0)).unique();
		if (!prepared?.artifact || prepared.artifact.recipeVersion !== 1 || !prepared.item.product) return null;
		const descriptor = prepared.artifact.descriptor;
		if (descriptor.mime !== "image/jpeg" || descriptor.bytes <= 0 || descriptor.bytes > 10_000_000
			|| !descriptor.key.startsWith("sites/angelsrest.online/catalog/print-sources/")) return null;
		return {
			descriptor,
			product: prepared.item.product,
			printWidth: prepared.item.width,
			printHeight: prepared.item.height,
		};
	},
});
