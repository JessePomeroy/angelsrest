import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireSiteAdmin } from "./authHelpers";
const identity = { siteUrl: v.string(), galleryId: v.id("galleries") };
export const begin = mutation({
	args: {
		...identity,
		r2Key: v.string(),
		filename: v.string(),
		sizeBytes: v.number(),
		width: v.number(),
		height: v.number(),
	},
	handler: async (ctx, args) => {
		await requireSiteAdmin(ctx, args.siteUrl, "galleryDelivery");
		const gallery = await ctx.db.get(args.galleryId);
		if (!gallery || gallery.siteUrl !== args.siteUrl || gallery.status === "archived")
			throw new Error("Gallery unavailable");
		const segments = args.r2Key.split("/");
		if (
			segments.length !== 4 ||
			segments[0] !== args.siteUrl ||
			segments[1] !== args.galleryId ||
			segments[2] !== "original" ||
			!segments[3] ||
			segments[3] === "." ||
			segments[3] === ".." ||
			/[\\\u0000-\u001f]/.test(args.r2Key) ||
			args.r2Key.length > 1024
		)
			throw new Error("Invalid original key");
		if (
			!args.filename ||
			args.filename.length > 255 ||
			!Number.isSafeInteger(args.sizeBytes) ||
			args.sizeBytes <= 0 ||
			[args.width, args.height].some((x) => !Number.isSafeInteger(x) || x < 0 || x > 1_000_000)
		)
			throw new Error("Invalid upload facts");
		const existing = await ctx.db
			.query("deliveryUploads")
			.withIndex("by_key", (q) => q.eq("r2Key", args.r2Key))
			.unique();
		if (existing) {
			if (
				existing.siteUrl !== args.siteUrl ||
				existing.galleryId !== args.galleryId ||
				existing.filename !== args.filename ||
				existing.sizeBytes !== args.sizeBytes ||
				existing.width !== args.width ||
				existing.height !== args.height ||
				existing.state !== "pending"
			)
				throw new Error("Upload checkpoint conflicts with existing identity");
			return existing._id;
		}
		return await ctx.db.insert("deliveryUploads", { ...args, state: "pending", open: true });
	},
});
export const list = query({
	args: { ...identity, paginationOpts: paginationOptsValidator },
	handler: async (ctx, { siteUrl, galleryId, paginationOpts }) => {
		await requireSiteAdmin(ctx, siteUrl, "galleryDelivery");
		const gallery = await ctx.db.get(galleryId);
		if (!gallery || gallery.siteUrl !== siteUrl) throw new Error("Gallery unavailable");
		return await ctx.db
			.query("deliveryUploads")
			.withIndex("by_gallery_open", (q) => q.eq("galleryId", galleryId).eq("open", true))
			.paginate({
				...paginationOpts,
				numItems: 25,
				maximumRowsRead: 50,
				maximumBytesRead: 100_000,
			});
	},
});
export const markDeleting = mutation({
	args: { siteUrl: v.string(), id: v.id("deliveryUploads") },
	handler: async (ctx, { siteUrl, id }) => {
		await requireSiteAdmin(ctx, siteUrl, "galleryDelivery");
		const row = await ctx.db.get(id);
		if (!row || row.siteUrl !== siteUrl) throw new Error("Upload checkpoint unavailable");
		// A durable tombstone blocks a late addImage after storage cleanup or reload.
		await ctx.db.patch(id, { state: "deleting", open: true });
		const image = await ctx.db
			.query("galleryImages")
			.withIndex("by_r2Key", (q) => q.eq("r2Key", row.r2Key))
			.unique();
		if (image && (image.siteUrl !== siteUrl || image.galleryId !== row.galleryId))
			throw new Error("Upload identity conflict");
		return image?._id ?? null;
	},
});
export const finishDelete = mutation({
	args: { siteUrl: v.string(), id: v.id("deliveryUploads") },
	handler: async (ctx, { siteUrl, id }) => {
		await requireSiteAdmin(ctx, siteUrl, "galleryDelivery");
		const row = await ctx.db.get(id);
		if (!row || row.siteUrl !== siteUrl || !["deleting", "deleted"].includes(row.state))
			throw new Error("Upload deletion unavailable");
		if (
			await ctx.db
				.query("galleryImages")
				.withIndex("by_r2Key", (q) => q.eq("r2Key", row.r2Key))
				.first()
		)
			throw new Error("Remove registered image metadata before completing cleanup");
		await ctx.db.patch(id, { state: "deleted", open: false });
	},
});
