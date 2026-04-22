import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireAuth } from "./authHelpers";

// Contact form — intentionally public; the public contact page posts here.
// Abuse mitigation is layered in SvelteKit (`/api/contact` rate-limits + CAPTCHA
// in practice). Do NOT add requireAuth here.
export const create = mutation({
	args: {
		siteUrl: v.string(),
		name: v.string(),
		email: v.string(),
		phone: v.optional(v.string()),
		subject: v.optional(v.string()),
		message: v.string(),
	},
	handler: async (ctx, args) => {
		return await ctx.db.insert("inquiries", {
			...args,
			status: "new",
		});
	},
});

export const list = query({
	args: {
		siteUrl: v.string(),
		status: v.optional(v.union(v.literal("new"), v.literal("read"), v.literal("replied"))),
		limit: v.optional(v.number()),
	},
	handler: async (ctx, { siteUrl, status, limit }) => {
		await requireAuth(ctx);
		// Bounded by default — spam writes to inquiries are public, so an
		// unbounded `.collect()` was a DoS vector. See audit H11.
		const take = Math.min(limit ?? 200, 500);
		if (status) {
			return await ctx.db
				.query("inquiries")
				.withIndex("by_siteUrl_status", (q) =>
					q.eq("siteUrl", siteUrl).eq("status", status),
				)
				.order("desc")
				.take(take);
		}
		return await ctx.db
			.query("inquiries")
			.withIndex("by_siteUrl", (q) => q.eq("siteUrl", siteUrl))
			.order("desc")
			.take(take);
	},
});

// Count new inquiries. Previously `.collect().length` — which is both a
// DoS vector on a public-writable table and a Convex anti-pattern. Bounded
// to 99 (a typical admin-badge ceiling — UI can render "99+" if returned).
// Returns a plain number to preserve the existing caller contract. See
// audit H11.
export const countNew = query({
	args: { siteUrl: v.string() },
	handler: async (ctx, { siteUrl }) => {
		await requireAuth(ctx);
		const CAP = 99;
		const rows = await ctx.db
			.query("inquiries")
			.withIndex("by_siteUrl_status", (q) =>
				q.eq("siteUrl", siteUrl).eq("status", "new"),
			)
			.take(CAP);
		return rows.length;
	},
});

// Admin-only: update an inquiry's triage status (new → read → replied).
// Replaces the old Sanity-backed PATCH /api/admin/inquiries/[id] endpoint,
// which silently no-op'd because the id passed in was a Convex id, not a
// Sanity doc id. See audit #50.
export const updateStatus = mutation({
	args: {
		id: v.id("inquiries"),
		status: v.union(v.literal("new"), v.literal("read"), v.literal("replied")),
	},
	handler: async (ctx, { id, status }) => {
		await requireAuth(ctx);
		await ctx.db.patch(id, { status });
	},
});
