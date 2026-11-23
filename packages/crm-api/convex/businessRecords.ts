import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireSiteAdmin } from "./authHelpers";

const kind = v.union(
	v.literal("orders"),
	v.literal("invoices"),
	v.literal("quotes"),
	v.literal("contracts"),
);
const status = v.union(
	...(
		[
			"new",
			"printing",
			"ready",
			"shipped",
			"delivered",
			"refunded",
			"draft",
			"sent",
			"paid",
			"partial",
			"overdue",
			"canceled",
			"accepted",
			"declined",
			"expired",
			"signed",
		] as const
	).map((value) => v.literal(value)),
);
const feature = {
	orders: "orders",
	invoices: "invoicing",
	quotes: "quotes",
	contracts: "contracts",
} as const;

export const list = query({
	args: {
		siteUrl: v.string(),
		kind,
		status: v.optional(status),
		search: v.optional(v.string()),
		from: v.optional(v.number()),
		to: v.optional(v.number()),
		paginationOpts: paginationOptsValidator,
	},
	handler: async (ctx, args) => {
		await requireSiteAdmin(ctx, args.siteUrl, feature[args.kind]);
		const search = args.search?.trim() ?? "";
		if (
			search.length > 200 ||
			[args.from, args.to].some((value) => value !== undefined && !Number.isFinite(value))
		)
			throw new Error("Invalid record filter");
		if (!Number.isInteger(args.paginationOpts.numItems) || args.paginationOpts.numItems < 1)
			throw new Error("Invalid page or date range");
		if (args.from !== undefined && args.to !== undefined && args.from >= args.to)
			return { page: [], continueCursor: "", isDone: true };
		const opts = {
			...args.paginationOpts,
			numItems: Math.min(50, Math.max(1, args.paginationOpts.numItems)),
			maximumRowsRead: 100,
			maximumBytesRead: 1_000_000,
		};
		const records = ctx.db.query(args.kind);
		if (search) {
			const result = await records
				.withSearchIndex("search_records", (q) => {
					const scoped = q.search("searchText", search).eq("siteUrl", args.siteUrl);
					return args.status ? scoped.eq("status", args.status) : scoped;
				})
				.paginate(opts);
			return {
				...result,
				page: result.page.filter(
					(row) =>
						(args.from === undefined || row._creationTime >= args.from) &&
						(args.to === undefined || row._creationTime < args.to),
				),
			};
		}
		const matching = args.status
			? records.withIndex("by_siteUrl_status", (q) => {
					const scoped = q.eq("siteUrl", args.siteUrl).eq("status", args.status!);
					if (args.from !== undefined && args.to !== undefined)
						return scoped.gte("_creationTime", args.from).lt("_creationTime", args.to);
					if (args.from !== undefined) return scoped.gte("_creationTime", args.from);
					return args.to === undefined ? scoped : scoped.lt("_creationTime", args.to);
				})
			: records.withIndex("by_siteUrl", (q) => {
					const scoped = q.eq("siteUrl", args.siteUrl);
					if (args.from !== undefined && args.to !== undefined)
						return scoped.gte("_creationTime", args.from).lt("_creationTime", args.to);
					if (args.from !== undefined) return scoped.gte("_creationTime", args.from);
					return args.to === undefined ? scoped : scoped.lt("_creationTime", args.to);
				});
		return await matching.order("desc").paginate(opts);
	},
});

export const get = query({
	args: { siteUrl: v.string(), kind, id: v.string() },
	handler: async (ctx, args) => {
		await requireSiteAdmin(ctx, args.siteUrl, feature[args.kind]);
		const id = ctx.db.normalizeId(args.kind, args.id);
		if (!id) return null;
		const row = await ctx.db.get(id);
		return row?.siteUrl === args.siteUrl ? row : null;
	},
});
