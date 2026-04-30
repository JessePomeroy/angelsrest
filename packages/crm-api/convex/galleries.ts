import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, mutation, query } from "./_generated/server";
import { requireAuth } from "./authHelpers";
import {
	COMPACT_LIST_LIMIT,
	DEFAULT_LIST_LIMIT,
	GALLERY_IMAGE_LIMIT,
	LARGE_SCAN_LIMIT,
} from "./helpers/limits";
import { patchDocument } from "./helpers/patching";

// Audit H14: cap per-batch DB deletes so the mutation transaction never
// runs into Convex's operation-count ceiling. Galleries with >2000 photos
// + downloads fan out across multiple scheduled batches instead of trying
// to delete everything in one shot.
const REMOVE_BATCH_SIZE = 500;

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
		await requireAuth(ctx);
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
		siteUrl: v.string(),
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
	handler: async (ctx, { id, siteUrl, ...fields }) => {
		await patchDocument(ctx, id, siteUrl, fields);
	},
});

/**
 * Start the deletion of a gallery. Deletes one batch of images + downloads
 * inline and, if more rows remain, schedules `_removeBatch` to continue.
 * Audit H14 — the old mutation deleted up to 2000 docs in a single
 * transaction, which hits Convex's operation-count ceiling for large
 * galleries and silently drops anything beyond 2000.
 *
 * Marks the gallery `archived` up front so callers see the deletion is
 * in progress, then the final batch deletes the gallery document itself.
 *
 * R2 file deletion is still TODO — the gallery worker owns the R2
 * namespace and wants an authenticated HTTP call per r2Key. That needs
 * an `"use node"` action + GALLERY_WORKER_URL + GALLERY_ADMIN_SECRET on
 * the Convex deployment to work. For now the r2Keys leak; admin can
 * bulk-delete them via the worker's own admin tool until we wire the
 * action up.
 */
export const remove = mutation({
	args: { id: v.id("galleries") },
	handler: async (ctx, { id }) => {
		await requireAuth(ctx);
		const gallery = await ctx.db.get(id);
		if (!gallery) throw new Error("Gallery not found");

		// Flag the gallery so any in-flight reads see it's being removed.
		if (gallery.status !== "archived") {
			await ctx.db.patch(id, { status: "archived" });
		}

		await ctx.runMutation(internal.galleries._removeBatch, { id });
	},
});

/**
 * Delete one batch of gallery rows. Reschedules itself until both
 * `galleryImages` and `galleryDownloads` are empty for this gallery,
 * then deletes the gallery document and stops.
 */
export const _removeBatch = internalMutation({
	args: { id: v.id("galleries") },
	handler: async (ctx, { id }) => {
		// Look up the gallery once so we have the siteUrl for the
		// tenant-scoped galleryDownloads index (audit M23).
		const gallery = await ctx.db.get(id);
		const siteUrl = gallery?.siteUrl;

		const images = await ctx.db
			.query("galleryImages")
			.withIndex("by_gallery", (q) => q.eq("galleryId", id))
			.take(REMOVE_BATCH_SIZE);
		for (const image of images) {
			await ctx.db.delete(image._id);
		}

		const remainingBudget = REMOVE_BATCH_SIZE - images.length;
		if (remainingBudget > 0 && siteUrl) {
			const downloads = await ctx.db
				.query("galleryDownloads")
				.withIndex("by_siteUrl_and_galleryId", (q) =>
					q.eq("siteUrl", siteUrl).eq("galleryId", id),
				)
				.take(remainingBudget);
			for (const dl of downloads) {
				await ctx.db.delete(dl._id);
			}

			// If we had budget left AND everything's clean, drop the gallery.
			if (downloads.length < remainingBudget) {
				const stillHasImages = await ctx.db
					.query("galleryImages")
					.withIndex("by_gallery", (q) => q.eq("galleryId", id))
					.first();
				const stillHasDownloads = await ctx.db
					.query("galleryDownloads")
					.withIndex("by_siteUrl_and_galleryId", (q) =>
						q.eq("siteUrl", siteUrl).eq("galleryId", id),
					)
					.first();
				if (!stillHasImages && !stillHasDownloads) {
					await ctx.db.delete(id);
					return;
				}
			}
		} else if (remainingBudget > 0 && !siteUrl) {
			// Gallery document already deleted on a prior batch — nothing
			// more to sweep (we only scope downloads by (siteUrl, galleryId)).
			return;
		}

		// More rows to go — schedule the next batch.
		await ctx.scheduler.runAfter(0, internal.galleries._removeBatch, { id });
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
			.take(DEFAULT_LIST_LIMIT);

		// Collect unique client IDs and fan out the reads in parallel
		// (audit M24). Mirrors the Promise.all pattern in tags.getClientTags.
		const clientIds = [...new Set(galleries.map((g) => g.clientId))];
		const clients = await Promise.all(clientIds.map((id) => ctx.db.get(id)));
		const clientMap = new Map();
		for (const client of clients) {
			if (client) clientMap.set(client._id, client);
		}
		const withClients = galleries.map((gallery) => ({
			...gallery,
			clientName: clientMap.get(gallery.clientId)?.name ?? "Unknown",
		}));
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
			.take(COMPACT_LIST_LIMIT);
	},
});

// Image mutations

/**
 * Insert a new gallery image. `order` is computed from the gallery's
 * current `imageCount`; if two concurrent `addImage` mutations both read
 * the same `imageCount`, Convex's OCC aborts and retries the second —
 * so the race the audit H13 flagged is covered transaction-level. As a
 * belt-and-suspenders tiebreak, `getImages` sorts by `order` then by
 * `_creationTime`, so even if two rows ever did end up with the same
 * `order` value, render order would be stable.
 */
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
		await requireAuth(ctx);
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
		await requireAuth(ctx);
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
		await requireAuth(ctx);
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
			.take(GALLERY_IMAGE_LIMIT);
		// Audit H13 belt-and-suspenders: break ties on `order` with
		// `_creationTime` so render order is stable even in the theoretical
		// case that two rows share an `order` value.
		return images.sort((a, b) => a.order - b.order || a._creationTime - b._creationTime);
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
		// Audit M23: scope via `by_siteUrl_and_galleryId` (single source of
		// truth for tenant-filtered reads) rather than the dropped `by_gallery`.
		const gallery = await ctx.db.get(galleryId);
		if (!gallery) return { total: 0, single: 0, zip: 0, favorites: 0 };

		const downloads = await ctx.db
			.query("galleryDownloads")
			.withIndex("by_siteUrl_and_galleryId", (q) =>
				q.eq("siteUrl", gallery.siteUrl).eq("galleryId", galleryId),
			)
			.take(LARGE_SCAN_LIMIT);

		return {
			total: downloads.length,
			single: downloads.filter((d) => d.type === "single").length,
			zip: downloads.filter((d) => d.type === "zip").length,
			favorites: downloads.filter((d) => d.type === "favorites").length,
		};
	},
});
