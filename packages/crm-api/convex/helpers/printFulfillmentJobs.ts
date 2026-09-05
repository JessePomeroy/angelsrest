import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

export const PRINT_JOB_MAX_SOURCES = 800;
export const PRINT_JOB_BATCH_SIZE = 20;
export const PRINT_JOB_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const printJobStage = v.union(
	v.literal("resolve"), v.literal("prepare"), v.literal("issue"),
	v.literal("finish"), v.literal("done"), v.literal("blocked"),
);
export const printJobDescriptor = v.object({
	key: v.string(), hash: v.string(), bytes: v.number(),
	mime: v.union(v.literal("image/jpeg"), v.literal("image/png")),
	dimensions: v.object({ width: v.number(), height: v.number() }),
});
export const printJobItem = v.object({
	paperSubcategoryId: v.number(), width: v.number(), height: v.number(), quantity: v.number(),
	borderWidth: v.optional(v.number()), frameSubcategoryId: v.optional(v.number()),
	canvasSubcategoryId: v.optional(v.number()), canvasWrapHex: v.optional(v.string()),
});
export const printJobSource = v.object({ descriptor: printJobDescriptor, item: printJobItem });

export async function enqueuePrintFulfillmentJob(
	ctx: MutationCtx,
	orderId: Id<"orders">,
	ordinalCount: number,
) {
	if (!Number.isSafeInteger(ordinalCount) || ordinalCount < 1 || ordinalCount > 40) {
		throw new Error("Print job snapshot size is invalid");
	}
	const now = Date.now();
	const nextAt = now + 10_000;
	const jobId = await ctx.db.insert("printFulfillmentJobs", {
		orderId, stage: "resolve", cursor: 0, sourceCount: 0, ordinalCount,
		attempts: 0, startedAt: now, nextAt,
	});
	await ctx.db.patch(orderId, { printJobId: jobId });
	await ctx.scheduler.runAt(nextAt, internal.printFulfillmentJobs.dispatch, { jobId, nextAt });
	return jobId;
}
