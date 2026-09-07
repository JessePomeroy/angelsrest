import { v } from "convex/values";
import type { WithoutSystemFields } from "convex/server";
import type { Doc } from "./_generated/dataModel";
import { query, type MutationCtx } from "./_generated/server";
import { requireDocumentSiteAdmin } from "./authHelpers";

export const getClientActivity = query({
	args: {
		clientId: v.id("photographyClients"),
		limit: v.optional(v.number()),
	},
	handler: async (ctx, { clientId, limit }) => {
		await requireDocumentSiteAdmin(ctx, "photographyClients", clientId);
		const take = limit ?? 20;
		return await ctx.db
			.query("activityLog")
			.withIndex("by_clientId", (q) => q.eq("clientId", clientId))
			.order("desc")
			.take(take);
	},
});

export async function logActivity(ctx: MutationCtx, entry: WithoutSystemFields<Doc<"activityLog">>) {
	return await ctx.db.insert("activityLog", entry);
}
