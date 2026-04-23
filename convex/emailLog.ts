import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { requireAuth } from "./authHelpers";
import { DEFAULT_LIST_LIMIT } from "./helpers/limits";

const emailTypeValidator = v.union(
	v.literal("invoice"),
	v.literal("quote"),
	v.literal("contract"),
	v.literal("reminder"),
	v.literal("custom"),
);

/**
 * Type-level contract between `emailLog.type` and `emailLog.relatedId`
 * (audit M11). `relatedId` is stored as `v.string()` in the schema so
 * existing rows don't require a migration, but when present it should be
 * the Convex Id of the document denoted by `type`.
 *
 * Use this map when reading a row back to cast `relatedId` to a typed
 * `Id<...>`:
 *
 *     const id = row.relatedId as RelatedIdFor<typeof row.type>;
 *
 * `reminder` and `custom` do not reference a specific document; their
 * `relatedId` should be omitted.
 */
export type RelatedIdFor<T extends "invoice" | "quote" | "contract" | "reminder" | "custom"> =
	T extends "invoice"
		? Id<"invoices">
		: T extends "quote"
			? Id<"quotes">
			: T extends "contract"
				? Id<"contracts">
				: undefined;

export const list = query({
	args: {
		siteUrl: v.string(),
		type: v.optional(emailTypeValidator),
	},
	handler: async (ctx, { siteUrl, type }) => {
		await requireAuth(ctx);
		if (type) {
			return await ctx.db
				.query("emailLog")
				.withIndex("by_siteUrl_and_type", (q) =>
					q.eq("siteUrl", siteUrl).eq("type", type),
				)
				.order("desc")
				.take(DEFAULT_LIST_LIMIT);
		}
		return await ctx.db
			.query("emailLog")
			.withIndex("by_siteUrl", (q) => q.eq("siteUrl", siteUrl))
			.order("desc")
			.take(DEFAULT_LIST_LIMIT);
	},
});

export const create = mutation({
	args: {
		siteUrl: v.string(),
		to: v.string(),
		subject: v.string(),
		type: emailTypeValidator,
		relatedId: v.optional(v.string()),
		status: v.union(v.literal("sent"), v.literal("failed")),
		error: v.optional(v.string()),
		resendId: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		// Gated: email logging happens as a side effect of admin actions.
		// Previously this was public, which let any caller pollute the log.
		// Audit C6.
		await requireAuth(ctx);
		return await ctx.db.insert("emailLog", args);
	},
});
