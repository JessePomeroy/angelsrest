import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const create = mutation({
	args: {
		siteUrl: v.string(),
		clientId: v.id("photographyClients"),
		name: v.string(),
		slug: v.string(),
		downloadEnabled: v.boolean(),
		favoritesEnabled: v.boolean(),
		password: v.optional(v.string()),
		expiresAt: v.optional(v.number()),
	},
	handler: async (ctx, args) => {
		const existing = await ctx.db
			.query("galleries")
			.withIndex("by_siteUrl_and_slug", (q) =>
				q.eq("siteUrl", args.siteUrl).eq("slug", args.slug),
			)
			.unique();
		if (existing) throw new Error(`Gallery slug "${args.slug}" already exists`);

		return await ctx.db.insert("galleries", {
			...args,
			status: "draft",
			imageCount: 0,
			totalSizeBytes: 0,
		});
	},
});

export const update = mutation({
	args: {
		id: v.id("galleries"),
		name: v.optional(v.string()),
		slug: v.optional(v.string()),
		status: v.optional(
			v.union(
				v.literal("draft"),
				v.literal("uploading"),
				v.literal("published"),
				v.literal("archived"),
			),
		),
		coverImageKey: v.optional(v.string()),
		password: v.optional(v.string()),
		expiresAt: v.optional(v.number()),
		downloadEnabled: v.optional(v.boolean()),
		favoritesEnabled: v.optional(v.boolean()),
	},
	handler: async (ctx, { id, ...fields }) => {
		const gallery = await ctx.db.get(id);
		if (!gallery) throw new Error("Gallery not found");

		const updates: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(fields)) {
			if (value !== undefined) updates[key] = value;
		}
		if (Object.keys(updates).length > 0) {
			await ctx.db.patch(id, updates);
		}
	},
});

export const remove = mutation({
	args: { id: v.id("galleries") },
	handler: async (ctx, { id }) => {
		const gallery = await ctx.db.get(id);
		if (!gallery) throw new Error("Gallery not found");

		// Delete all images in the gallery
		const images = await ctx.db
			.query("galleryImages")
			.withIndex("by_gallery", (q) => q.eq("galleryId", id))
			.take(2000);
		for (const image of images) {
			await ctx.db.delete(image._id);
		}

		// Delete all download records
		const downloads = await ctx.db
			.query("galleryDownloads")
			.withIndex("by_gallery", (q) => q.eq("galleryId", id))
			.take(2000);
		for (const dl of downloads) {
			await ctx.db.delete(dl._id);
		}

		// Delete the gallery itself
		await ctx.db.delete(id);
	},
});

export const get = query({
	args: { id: v.id("galleries") },
	handler: async (ctx, { id }) => {
		return await ctx.db.get(id);
	},
});

export const getBySlug = query({
	args: {
		siteUrl: v.string(),
		slug: v.string(),
	},
	handler: async (ctx, { siteUrl, slug }) => {
		return await ctx.db
			.query("galleries")
			.withIndex("by_siteUrl_and_slug", (q) =>
				q.eq("siteUrl", siteUrl).eq("slug", slug),
			)
			.unique();
	},
});

export const listBySite = query({
	args: { siteUrl: v.string() },
	handler: async (ctx, { siteUrl }) => {
		const galleries = await ctx.db
			.query("galleries")
			.withIndex("by_siteUrl", (q) => q.eq("siteUrl", siteUrl))
			.order("desc")
			.take(100);

		const withClients = await Promise.all(
			galleries.map(async (gallery) => {
				const client = await ctx.db.get(gallery.clientId);
				return { ...gallery, clientName: client?.name ?? "Unknown" };
			}),
		);
		return withClients;
	},
});

export const listByClient = query({
	args: { clientId: v.id("photographyClients") },
	handler: async (ctx, { clientId }) => {
		return await ctx.db
			.query("galleries")
			.withIndex("by_client", (q) => q.eq("clientId", clientId))
			.order("desc")
			.take(50);
	},
});

// Image mutations

export const addImage = mutation({
	args: {
		siteUrl: v.string(),
		galleryId: v.id("galleries"),
		r2Key: v.string(),
		filename: v.string(),
		sizeBytes: v.number(),
		width: v.number(),
		height: v.number(),
	},
	handler: async (ctx, args) => {
		const gallery = await ctx.db.get(args.galleryId);
		if (!gallery) throw new Error("Gallery not found");

		const imageId = await ctx.db.insert("galleryImages", {
			siteUrl: args.siteUrl,
			galleryId: args.galleryId,
			r2Key: args.r2Key,
			filename: args.filename,
			sizeBytes: args.sizeBytes,
			width: args.width,
			height: args.height,
			order: gallery.imageCount,
			isFavorite: false,
			downloadCount: 0,
		});

		await ctx.db.patch(args.galleryId, {
			imageCount: gallery.imageCount + 1,
			totalSizeBytes: gallery.totalSizeBytes + args.sizeBytes,
		});

		return imageId;
	},
});

export const removeImage = mutation({
	args: { id: v.id("galleryImages") },
	handler: async (ctx, { id }) => {
		const image = await ctx.db.get(id);
		if (!image) throw new Error("Image not found");

		const gallery = await ctx.db.get(image.galleryId);
		if (gallery) {
			await ctx.db.patch(gallery._id, {
				imageCount: Math.max(0, gallery.imageCount - 1),
				totalSizeBytes: Math.max(0, gallery.totalSizeBytes - image.sizeBytes),
			});
		}

		await ctx.db.delete(id);
		return image.r2Key;
	},
});

export const reorderImages = mutation({
	args: {
		updates: v.array(
			v.object({
				id: v.id("galleryImages"),
				order: v.number(),
			}),
		),
	},
	handler: async (ctx, { updates }) => {
		for (const { id, order } of updates) {
			await ctx.db.patch(id, { order });
		}
	},
});

export const updateImage = mutation({
	args: {
		id: v.id("galleryImages"),
		isFavorite: v.optional(v.boolean()),
	},
	handler: async (ctx, { id, ...fields }) => {
		const updates: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(fields)) {
			if (value !== undefined) updates[key] = value;
		}
		if (Object.keys(updates).length > 0) {
			await ctx.db.patch(id, updates);
		}
	},
});

// Image queries

export const getImages = query({
	args: { galleryId: v.id("galleries") },
	handler: async (ctx, { galleryId }) => {
		const images = await ctx.db
			.query("galleryImages")
			.withIndex("by_gallery", (q) => q.eq("galleryId", galleryId))
			.take(2000);
		return images.sort((a, b) => a.order - b.order);
	},
});

// Download tracking

export const logDownload = mutation({
	args: {
		siteUrl: v.string(),
		galleryId: v.id("galleries"),
		imageId: v.optional(v.id("galleryImages")),
		ipHash: v.string(),
		type: v.union(
			v.literal("single"),
			v.literal("zip"),
			v.literal("favorites"),
		),
	},
	handler: async (ctx, args) => {
		await ctx.db.insert("galleryDownloads", {
			...args,
			downloadedAt: Date.now(),
		});

		if (args.imageId) {
			const image = await ctx.db.get(args.imageId);
			if (image) {
				await ctx.db.patch(args.imageId, {
					downloadCount: image.downloadCount + 1,
				});
			}
		}
	},
});

export const getDownloadStats = query({
	args: { galleryId: v.id("galleries") },
	handler: async (ctx, { galleryId }) => {
		const downloads = await ctx.db
			.query("galleryDownloads")
			.withIndex("by_gallery", (q) => q.eq("galleryId", galleryId))
			.take(1000);

		return {
			total: downloads.length,
			single: downloads.filter((d) => d.type === "single").length,
			zip: downloads.filter((d) => d.type === "zip").length,
			favorites: downloads.filter((d) => d.type === "favorites").length,
		};
	},
});
