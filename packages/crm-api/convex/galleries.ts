import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
	internalMutation,
	type MutationCtx,
	mutation,
	type QueryCtx,
	query,
} from "./_generated/server";
import { requireDocumentSiteAdmin, requireDocumentSiteAdminWithClient, requireSiteAdmin } from "./authHelpers";
import {
	COMPACT_LIST_LIMIT,
	DEFAULT_LIST_LIMIT,
	GALLERY_IMAGE_LIMIT,
	LARGE_SCAN_LIMIT,
} from "./helpers/limits";
import { patchDocument } from "./helpers/patching";
import { requireGalleryAccessGrant } from "./galleryAccess";
import { logActivity } from "./activityLog";

// Audit H14: cap per-batch DB deletes so the mutation transaction never
// runs into Convex's operation-count ceiling. Galleries with >2000 photos
// + downloads fan out across multiple scheduled batches instead of trying
// to delete everything in one shot.
const REMOVE_BATCH_SIZE = 500;

/** UI and host presign handlers share this stored membership decision. */
export const getUploadPolicy = query({
	args: { siteUrl: v.string() },
	returns: v.union(v.literal("media"), v.literal("all-files")),
	handler: async (ctx, { siteUrl }) => {
		const { client } = await requireSiteAdmin(ctx, siteUrl, "galleryDelivery");
		return client.siteUrl === "angelsrest.online" && client.role === "creator"
			? "all-files" as const
			: "media" as const;
	},
});

function previewIdentity(image: { r2Key: string; filename: string }) {
	const path = image.r2Key || image.filename;
	const slash = path.lastIndexOf("/");
	const filename = path.slice(slash + 1);
	const dot = filename.lastIndexOf(".");
	return { pairKey: `${path.slice(0, slash + 1)}${dot >= 0 ? filename.slice(0, dot) : filename}`.trim().toLowerCase(),
		previewable: /\.(jpg|jpeg|png|webp)$/i.test(image.filename.trim()) };
}

async function requireGalleryPortalToken(
	ctx: QueryCtx | MutationCtx,
	token: string,
	galleryId: Id<"galleries">,
	accessGrant?: string,
) {
	const tokenDoc = await ctx.db
		.query("portalTokens")
		.withIndex("by_token", (q) => q.eq("token", token))
		.unique();
	if (!tokenDoc || tokenDoc.type !== "gallery" || tokenDoc.documentId !== galleryId) {
		throw new Error("Invalid gallery token");
	}
	if (tokenDoc.revokedAt !== undefined) throw new Error("Gallery token has been revoked");
	if (tokenDoc.used) throw new Error("Gallery token has already been used");
	if (tokenDoc.expiresAt && Date.now() > tokenDoc.expiresAt) {
		throw new Error("Gallery token has expired");
	}

	const gallery = await ctx.db.get(galleryId);
	if (!gallery || gallery.siteUrl !== tokenDoc.siteUrl || gallery.status !== "published") {
		throw new Error("Gallery not found");
	}
	if (gallery.expiresAt !== undefined && gallery.expiresAt <= Date.now()) throw new Error("Gallery has expired");
	await requireGalleryAccessGrant(ctx, tokenDoc, gallery, accessGrant);
	return gallery;
}

async function withPasswordProtection<T extends { _id: Id<"galleries"> }>(
	ctx: QueryCtx,
	gallery: T,
) {
	const verifier = await ctx.db
		.query("galleryPasswordVerifiers")
		.withIndex("by_gallery", (q) => q.eq("galleryId", gallery._id))
		.unique();
	return { ...gallery, passwordProtected: verifier !== null };
}

export const create = mutation({
	args: {
		siteUrl: v.string(),
		clientId: v.id("photographyClients"),
		name: v.string(),
		slug: v.string(),
		downloadEnabled: v.boolean(),
		favoritesEnabled: v.boolean(),
		// Rollout bridge for admin versions before 2.3.16. Never persisted.
		password: v.optional(v.string()),
		expiresAt: v.optional(v.number()),
	},
	handler: async (ctx, { password, ...args }) => {
		if (password) {
			throw new Error("Update the admin app to enable hashed gallery passwords");
		}
		await requireSiteAdmin(ctx, args.siteUrl, "galleryDelivery");
		const client = await ctx.db.get(args.clientId);
		if (!client || client.siteUrl !== args.siteUrl) {
			throw new Error("Client not found");
		}
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
			previewIndexVersion: 1,
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
		// Rollout bridge for admin versions before 2.3.16. Never persisted.
		password: v.optional(v.string()),
		expiresAt: v.optional(v.number()),
		downloadEnabled: v.optional(v.boolean()),
		favoritesEnabled: v.optional(v.boolean()),
	},
	handler: async (ctx, { id, siteUrl, password, ...fields }) => {
		if (password) {
			throw new Error("Update the admin app to enable hashed gallery passwords");
		}
		await patchDocument(ctx, id, siteUrl, fields, "galleryDelivery");
	},
});

/**
 * Start the deletion of a gallery. Deletes one batch of images, downloads,
 * and password-access records
 * inline and, if more rows remain, schedules `_removeBatch` to continue.
 * Audit H14 — the old mutation deleted up to 2000 docs in a single
 * transaction, which hits Convex's operation-count ceiling for large
 * galleries and silently drops anything beyond 2000.
 *
 * Marks the gallery `archived` up front so callers see the deletion is
 * in progress, then the final batch deletes the gallery document itself.
 *
 * This mutation is metadata-only. Admin callers that own R2 files must
 * first load this gallery's keys through the tenant-scoped
 * `listImageStorageKeys` query and delete the corresponding Worker objects.
 * The shared admin gallery modal does that before calling `remove`; the
 * Worker cleanup route is an authenticated transport to R2, not the tenant
 * ownership boundary.
 */
export const remove = mutation({
	args: { id: v.id("galleries") },
	handler: async (ctx, { id }) => {
		const gallery = await requireDocumentSiteAdmin(ctx, "galleries", id, "galleryDelivery");

  const unfinished=await ctx.db.query("deliveryUploads").withIndex("by_gallery_open",q=>q.eq("galleryId",id).eq("open",true)).first();
  if(unfinished) throw new Error("Resume or remove interrupted uploads before deleting this gallery");

		// Flag the gallery so any in-flight reads see it's being removed.
		if (gallery.status !== "archived") {
			await ctx.db.patch(id, { status: "archived" });
		}

		await ctx.runMutation(internal.galleries._removeBatch, { id });
	},
});

/**
 * Delete one batch of gallery rows. Reschedules itself until images,
 * downloads, and access grants are empty for this gallery,
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

  const checkpoints=await ctx.db.query("deliveryUploads").withIndex("by_gallery",q=>q.eq("galleryId",id)).take(REMOVE_BATCH_SIZE-images.length);
  for(const checkpoint of checkpoints) await ctx.db.delete(checkpoint._id);

		let remainingBudget = REMOVE_BATCH_SIZE - images.length - checkpoints.length;
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
			remainingBudget -= downloads.length;

			const grants = remainingBudget > 0
				? await ctx.db
					.query("galleryAccessGrants")
					.withIndex("by_gallery", (q) => q.eq("galleryId", id))
					.take(remainingBudget)
				: [];
			for (const grant of grants) {
				await ctx.db.delete(grant._id);
			}
			remainingBudget -= grants.length;
			for (const table of ["galleryProofImages", "galleryProofSubmissions"] as const) {
				if (remainingBudget === 0) break;
				const rows = await ctx.db.query(table).withIndex("by_galleryId", (q) => q.eq("galleryId", id)).take(remainingBudget);
				for (const row of rows) await ctx.db.delete(row._id);
				remainingBudget -= rows.length;
			}

			// If we had budget left AND everything's clean, drop the gallery.
			if (remainingBudget > 0) {
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
				const stillHasGrants = await ctx.db
					.query("galleryAccessGrants")
					.withIndex("by_gallery", (q) => q.eq("galleryId", id))
					.first();
				const stillHasProofImages = await ctx.db.query("galleryProofImages").withIndex("by_galleryId", (q) => q.eq("galleryId", id)).first();
				const stillHasProofs = await ctx.db.query("galleryProofSubmissions").withIndex("by_galleryId", (q) => q.eq("galleryId", id)).first();
				if (!stillHasImages && !stillHasDownloads && !stillHasGrants && !stillHasProofImages && !stillHasProofs) {
					const verifier = await ctx.db
						.query("galleryPasswordVerifiers")
						.withIndex("by_gallery", (q) => q.eq("galleryId", id))
						.unique();
					if (verifier) await ctx.db.delete(verifier._id);
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
		const gallery = await requireDocumentSiteAdmin(ctx, "galleries", id, "galleryDelivery");
		return await withPasswordProtection(ctx, gallery);
	},
});

export const getBySlug = query({
	args: {
		siteUrl: v.string(),
		slug: v.string(),
	},
	handler: async (ctx, { siteUrl, slug }) => {
		await requireSiteAdmin(ctx, siteUrl, "galleryDelivery");
		const gallery = await ctx.db
			.query("galleries")
			.withIndex("by_siteUrl_and_slug", (q) =>
				q.eq("siteUrl", siteUrl).eq("slug", slug),
			)
			.unique();
		return gallery ? await withPasswordProtection(ctx, gallery) : null;
	},
});

export const listBySite = query({
	args: { siteUrl: v.string() },
	handler: async (ctx, { siteUrl }) => {
		await requireSiteAdmin(ctx, siteUrl, "galleryDelivery");
		const galleries = await ctx.db
			.query("galleries")
			.withIndex("by_siteUrl", (q) => q.eq("siteUrl", siteUrl))
			.order("desc")
			.take(DEFAULT_LIST_LIMIT);

		return await galleryListDetails(ctx, galleries);
	},
});

async function galleryListDetails(ctx: QueryCtx, galleries: Doc<"galleries">[]) {
	const clientIds = [...new Set(galleries.map((gallery) => gallery.clientId))];
	const clients = await Promise.all(clientIds.map((id) => ctx.db.get(id)));
	const clientNames = new Map(clients.filter((client) => client !== null).map((client) => [client._id, client.name]));
	return await Promise.all(galleries.map(async (gallery) => ({
		...await withPasswordProtection(ctx, gallery),
		clientName: clientNames.get(gallery.clientId) ?? "Unknown",
	})));
}

export const listSubmittedProofs = query({
	args: { siteUrl: v.string(), paginationOpts: paginationOptsValidator },
	handler: async (ctx, { siteUrl, paginationOpts }) => {
		const { client } = await requireSiteAdmin(ctx, siteUrl, "galleryDelivery");
		if (client.tier !== "full") throw new Error("Full gallery access is required");
		const result = await ctx.db.query("galleries")
			.withIndex("by_siteUrl_and_proofSubmittedAt", (q) => q.eq("siteUrl", siteUrl).gt("proofSubmittedAt", 0))
			.order("desc").paginate({ ...paginationOpts, numItems: Math.min(paginationOpts.numItems, 25), maximumRowsRead: 25 });
		return { ...result, page: await galleryListDetails(ctx, result.page) };
	},
});

/** Filtering precedes the bounded read, so older published galleries remain reachable. */
export const listBySitePaginated = query({
	args: {
		siteUrl: v.string(),
		status: v.optional(v.union(v.literal("draft"), v.literal("uploading"), v.literal("published"), v.literal("archived"))),
		paginationOpts: paginationOptsValidator,
	},
	handler: async (ctx, { siteUrl, status, paginationOpts }) => {
		await requireSiteAdmin(ctx, siteUrl, "galleryDelivery");
		const matching = status
			? ctx.db.query("galleries").withIndex("by_siteUrl_status", (q) => q.eq("siteUrl", siteUrl).eq("status", status))
			: ctx.db.query("galleries").withIndex("by_siteUrl", (q) => q.eq("siteUrl", siteUrl));
		const result = await matching.order("desc").paginate({ ...paginationOpts,
			numItems: Math.min(paginationOpts.numItems, 50), maximumRowsRead: 50,
		});
		return { ...result, page: await galleryListDetails(ctx, result.page) };
	},
});

export const listByClient = query({
	args: { clientId: v.id("photographyClients") },
	handler: async (ctx, { clientId }) => {
		await requireDocumentSiteAdmin(ctx, "photographyClients", clientId, "galleryDelivery");
		const galleries = await ctx.db
			.query("galleries")
			.withIndex("by_client", (q) => q.eq("clientId", clientId))
			.order("desc")
			.take(COMPACT_LIST_LIMIT);
		return await Promise.all(galleries.map((gallery) => withPasswordProtection(ctx, gallery)));
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
		await requireSiteAdmin(ctx, args.siteUrl, "galleryDelivery");
		const gallery = await ctx.db.get(args.galleryId);
		if (!gallery || gallery.siteUrl !== args.siteUrl) {
			throw new Error("Gallery not found");
		}
  const checkpoint = await ctx.db.query("deliveryUploads").withIndex("by_key", q=>q.eq("r2Key",args.r2Key)).unique();
  if (gallery.status === "archived" || checkpoint && (checkpoint.state === "deleting" || checkpoint.state === "deleted" || checkpoint.galleryId !== args.galleryId || checkpoint.siteUrl !== args.siteUrl || checkpoint.filename !== args.filename || checkpoint.sizeBytes !== args.sizeBytes || checkpoint.width !== args.width || checkpoint.height !== args.height)) throw new Error("Upload checkpoint is unavailable or conflicts with registration");
		// A lost mutation response must be replayable without counting the same
		// stored original twice. Different facts cannot adopt an existing identity.
		const matches = await ctx.db.query("galleryImages").withIndex("by_r2Key", (q) => q.eq("r2Key", args.r2Key)).take(2);
		if (matches.length > 1) throw new Error("Gallery file registration is ambiguous");
		const existing = matches[0];
		if (existing) {
			if (existing.siteUrl !== args.siteUrl || existing.galleryId !== args.galleryId
				|| existing.filename !== args.filename || existing.sizeBytes !== args.sizeBytes
				|| existing.width !== args.width || existing.height !== args.height) {
				throw new Error("Gallery file registration conflicts with existing metadata");
			}
			if (checkpoint) await ctx.db.patch(checkpoint._id, {state:"registered",open:false});
			return existing._id;
		}
		if (checkpoint?.state === "registered") {
			throw new Error("Registered upload metadata is unavailable");
		}

		const imageId = await ctx.db.insert("galleryImages", {
			...previewIdentity(args),
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

		if (checkpoint) await ctx.db.patch(checkpoint._id, {state:"registered",open:false});
		return imageId;
	},
});

export const removeImage = mutation({
	args: { id: v.id("galleryImages"), siteUrl: v.optional(v.string()) },
	handler: async (ctx, { id, siteUrl }) => {
		if (siteUrl !== undefined) await requireSiteAdmin(ctx, siteUrl, "galleryDelivery");
		const image = await ctx.db.get(id);
		if (!image) {
			if (siteUrl !== undefined) return null;
			throw new Error("Image not found");
		}
		if (siteUrl !== undefined && image.siteUrl !== siteUrl) throw new Error("Image not found");
		if (siteUrl === undefined) await requireSiteAdmin(ctx, image.siteUrl, "galleryDelivery");

		// Ordinary image deletion must also revoke registration in another tab.
		const checkpoint = await ctx.db.query("deliveryUploads")
			.withIndex("by_key", (q) => q.eq("r2Key", image.r2Key)).unique();
		if (checkpoint) {
			if (checkpoint.siteUrl !== image.siteUrl || checkpoint.galleryId !== image.galleryId)
				throw new Error("Upload identity conflict");
			await ctx.db.patch(checkpoint._id, { state: "deleted", open: false });
		}

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
		if (updates.length > 0) {
			const firstImage = await requireDocumentSiteAdmin(
				ctx,
				"galleryImages",
				updates[0].id, "galleryDelivery",
			);
			for (const { id } of updates.slice(1)) {
				const image = await ctx.db.get(id);
				if (!image || image.siteUrl !== firstImage.siteUrl) {
					throw new Error("Not found");
				}
			}
		}
		for (const { id, order } of updates) {
			await ctx.db.patch(id, { order });
		}
	},
});

export const updateImage = mutation({
	args: {
		id: v.id("galleryImages"),
		token: v.string(),
		accessGrant: v.optional(v.string()),
		isFavorite: v.optional(v.boolean()),
		editingNotes: v.optional(v.string()),
	},
	handler: async (ctx, { id, token, accessGrant, ...fields }) => {
		const image = await ctx.db.get(id);
		if (!image) throw new Error("Image not found");
		const gallery = await requireGalleryPortalToken(ctx, token, image.galleryId, accessGrant);
		if (image.siteUrl !== gallery.siteUrl) throw new Error("Image not found");
		if (!gallery.favoritesEnabled) throw new Error("Proofing is disabled");
		if (gallery.proofSubmissionId) throw new Error("Selection has been submitted. Ask the photographer to reopen it.");
		if ((fields.editingNotes?.length ?? 0) > 1000) throw new Error("Editing notes must be at most 1000 characters");

		const updates: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(fields)) {
			if (value !== undefined) updates[key] = value;
		}
		if (Object.keys(updates).length > 0) {
			await ctx.db.patch(id, updates);
		}
	},
});

/** A submitted proof is immutable, even when an owner later reopens the gallery. */
export const submitProof = mutation({
	args: { galleryId: v.id("galleries"), token: v.string(), accessGrant: v.optional(v.string()), notes: v.string(), expectedRound: v.number() },
	handler: async (ctx, { galleryId, token, accessGrant, notes, expectedRound }) => {
		const gallery = await requireGalleryPortalToken(ctx, token, galleryId, accessGrant);
		if (!gallery.favoritesEnabled) throw new Error("Proofing is disabled");
		if ((gallery.proofRound ?? 0) !== expectedRound) throw new Error("Selection was reopened. Reload the gallery before submitting.");
		if (gallery.proofSubmissionId) return gallery.proofSubmissionId;
		if (notes.length > 5000) throw new Error("Submission notes must be at most 5000 characters");
		const selected = await ctx.db.query("galleryImages")
			.withIndex("by_galleryId_and_siteUrl_and_isFavorite", (q) => q.eq("galleryId", galleryId).eq("siteUrl", gallery.siteUrl).eq("isFavorite", true))
			.take(GALLERY_IMAGE_LIMIT + 1);
		if (selected.length === 0) throw new Error("Choose at least one favorite before submitting");
		if (selected.length > GALLERY_IMAGE_LIMIT) throw new Error("Gallery image limit exceeded");
		const submittedAt = Date.now();
		const submissionId = await ctx.db.insert("galleryProofSubmissions", {
			siteUrl: gallery.siteUrl, galleryId, clientId: gallery.clientId,
			selectedCount: selected.length, notes: notes.trim(), submittedAt,
		});
		for (const [order, image] of selected.sort((a, b) => a.order - b.order).entries()) {
			await ctx.db.insert("galleryProofImages", { siteUrl: gallery.siteUrl, galleryId, submissionId,
				imageId: image._id, filename: image.filename, editingNotes: image.editingNotes ?? "", order });
		}
		await ctx.db.patch(galleryId, { proofSubmissionId: submissionId, proofSubmittedAt: submittedAt });
		await logActivity(ctx, { siteUrl: gallery.siteUrl, clientId: gallery.clientId, action: "gallery_proof_submitted",
			description: `${selected.length} selections submitted for ${gallery.name}` });
		return submissionId;
	},
});

async function requireProofingAdmin<T extends "galleries" | "galleryProofSubmissions">(ctx: QueryCtx | MutationCtx, table: T, id: Id<T>) {
	const { doc, client } = await requireDocumentSiteAdminWithClient(ctx, table, id, "galleryDelivery");
	if (client.tier !== "full") throw new Error("Full gallery access is required");
	return doc;
}

export const getProof = query({
	args: { galleryId: v.id("galleries"), token: v.optional(v.string()), accessGrant: v.optional(v.string()) },
	handler: async (ctx, { galleryId, token, accessGrant }) => {
		const gallery = token ? await requireGalleryPortalToken(ctx, token, galleryId, accessGrant)
			: await requireProofingAdmin(ctx, "galleries", galleryId);
		return gallery.proofSubmissionId ? await ctx.db.get(gallery.proofSubmissionId) : null;
	},
});

export const listProofs = query({
	args: { galleryId: v.id("galleries"), paginationOpts: paginationOptsValidator },
	handler: async (ctx, { galleryId, paginationOpts }) => {
		await requireProofingAdmin(ctx, "galleries", galleryId);
		return await ctx.db.query("galleryProofSubmissions").withIndex("by_galleryId", (q) => q.eq("galleryId", galleryId))
			.order("desc").paginate({ ...paginationOpts, numItems: Math.min(paginationOpts.numItems, 25), maximumRowsRead: 25 });
	},
});

export const getProofImages = query({
	args: { submissionId: v.id("galleryProofSubmissions"), paginationOpts: paginationOptsValidator },
	handler: async (ctx, { submissionId, paginationOpts }) => {
		const submission = await requireProofingAdmin(ctx, "galleryProofSubmissions", submissionId);
		return await ctx.db.query("galleryProofImages").withIndex("by_submissionId_and_order", (q) => q.eq("submissionId", submission._id))
			.paginate({ ...paginationOpts, numItems: Math.min(paginationOpts.numItems, 50), maximumRowsRead: 50 });
	},
});

export const reopenProof = mutation({
	args: { galleryId: v.id("galleries"), submissionId: v.id("galleryProofSubmissions") },
	handler: async (ctx, { galleryId, submissionId }) => {
		const gallery = await requireProofingAdmin(ctx, "galleries", galleryId);
		if (gallery.proofSubmissionId !== submissionId) throw new Error("This submission is no longer current");
		await ctx.db.patch(submissionId, { reopenedAt: Date.now() });
		await ctx.db.patch(galleryId, { proofSubmissionId: undefined, proofSubmittedAt: undefined, proofRound: (gallery.proofRound ?? 0) + 1 });
	},
});

// Image queries

export const backfillPreviewIndex = mutation({
	args: { galleryId: v.id("galleries"), cursor: v.union(v.string(), v.null()) },
	handler: async (ctx, { galleryId, cursor }) => {
		const gallery = await requireDocumentSiteAdmin(ctx, "galleries", galleryId, "galleryDelivery");
		if (gallery.previewIndexVersion === 1) return { isDone: true, cursor: null };
		if ((gallery.previewIndexCursor ?? null) !== cursor) return { isDone: false, cursor: gallery.previewIndexCursor ?? null };
		const batch = await ctx.db.query("galleryImages").withIndex("by_gallery", (q) => q.eq("galleryId", galleryId))
			.paginate({ numItems: 100, cursor, maximumBytesRead: 1_000_000 });
		for (const image of batch.page) {
			if (image.siteUrl !== gallery.siteUrl) throw new Error("Gallery image ownership mismatch");
			await ctx.db.patch(image._id, previewIdentity(image));
		}
		await ctx.db.patch(galleryId, { previewIndexCursor: batch.isDone ? null : batch.continueCursor,
			...(batch.isDone ? { previewIndexVersion: 1 as const } : {}) });
		return { isDone: batch.isDone, cursor: batch.isDone ? null : batch.continueCursor };
	},
});

export const getImagesPage = query({
	args: {
		galleryId: v.id("galleries"), token: v.string(), accessGrant: v.optional(v.string()),
		cursor: v.union(v.string(), v.null()),
		selection: v.optional(v.union(
			v.object({ kind: v.literal("all"), excludedIds: v.array(v.id("galleryImages")) }),
			v.object({ kind: v.literal("selected"), ids: v.array(v.id("galleryImages")) }),
			v.object({ kind: v.literal("favorites") }),
		)),
	},
	handler: async (ctx, { galleryId, token, accessGrant, cursor, selection }) => {
		const gallery = await requireGalleryPortalToken(ctx, token, galleryId, accessGrant);
		if (gallery.previewIndexVersion !== 1) throw new Error("Gallery preview index must be prepared before paginated access");
		if (selection && !gallery.downloadEnabled) throw new Error("Downloads are disabled");
		if (selection?.kind === "favorites" && !gallery.favoritesEnabled) throw new Error("Favorites are disabled");
		const ids = selection?.kind === "all" ? selection.excludedIds : selection?.kind === "selected" ? selection.ids : [];
		if (ids.length > GALLERY_IMAGE_LIMIT) throw new Error("Selection is too large");
		const selected = new Set(ids);
		const result = await ctx.db.query("galleryImages")
			.withIndex("by_galleryId_and_siteUrl_and_order", (q) => q.eq("galleryId", galleryId).eq("siteUrl", gallery.siteUrl))
			.paginate({ numItems: 48, cursor, maximumBytesRead: 1_000_000 });
		const previewSources = selection ? [] : await Promise.all(result.page.filter((image) => !image.previewable).map(async (image) => {
			const companion = await ctx.db.query("galleryImages")
				.withIndex("by_galleryId_and_siteUrl_and_pairKey_and_previewable_and_order", (q) => q.eq("galleryId", galleryId)
					.eq("siteUrl", gallery.siteUrl).eq("pairKey", image.pairKey).eq("previewable", true)).first();
			return companion ? { filename: companion.filename, r2Key: companion.r2Key } : null;
		}));
		return { ...result, totalCount: gallery.imageCount, previewSources: previewSources.filter((image) => image !== null),
			page: result.page.filter((image) => !selection || (selection.kind === "all" ? !selected.has(image._id)
				: selection.kind === "selected" ? selected.has(image._id) : image.isFavorite)),
		};
	},
});

/** Single recipient-authorized row for host actions, independent of collection size. */
export const getImage = query({
 args: { galleryId: v.id("galleries"), imageId: v.string(), token: v.string(), accessGrant: v.optional(v.string()) },
 handler: async (ctx, { galleryId, imageId, token, accessGrant }) => {
  const gallery = await requireGalleryPortalToken(ctx, token, galleryId, accessGrant);
  const id = ctx.db.normalizeId("galleryImages", imageId);
  const image = id ? await ctx.db.get(id) : null;
  return image?.galleryId === galleryId && image.siteUrl === gallery.siteUrl ? image : null;
 },
});

export const getImages = query({
	args: {
		galleryId: v.id("galleries"),
		token: v.optional(v.string()),
		accessGrant: v.optional(v.string()),
	},
	handler: async (ctx, { galleryId, token, accessGrant }) => {
		const gallery = token
			? await requireGalleryPortalToken(ctx, token, galleryId, accessGrant)
			: await requireDocumentSiteAdmin(ctx, "galleries", galleryId, "galleryDelivery");
		const images = await ctx.db
			.query("galleryImages")
			.withIndex("by_gallery", (q) => q.eq("galleryId", galleryId))
			.take(GALLERY_IMAGE_LIMIT);
		// Audit H13 belt-and-suspenders: break ties on `order` with
		// `_creationTime` so render order is stable even in the theoretical
		// case that two rows share an `order` value.
		return images
			.filter((image) => image.siteUrl === gallery.siteUrl)
			.sort((a, b) => a.order - b.order || a._creationTime - b._creationTime);
	},
});

export const listImageStorageKeys = query({
	args: {
		galleryId: v.id("galleries"),
		paginationOpts: paginationOptsValidator,
	},
	handler: async (ctx, { galleryId, paginationOpts }) => {
		const gallery = await requireDocumentSiteAdmin(ctx, "galleries", galleryId, "galleryDelivery");
		const page = await ctx.db
			.query("galleryImages")
			.withIndex("by_gallery", (q) => q.eq("galleryId", galleryId))
			.paginate(paginationOpts);

		return {
			keys: page.page
				.filter((image) => image.siteUrl === gallery.siteUrl)
				.map((image) => image.r2Key),
			isDone: page.isDone,
			continueCursor: page.continueCursor,
		};
	},
});

// Download tracking

export const logDownload = mutation({
	args: {
		siteUrl: v.string(),
		galleryId: v.id("galleries"),
		token: v.string(),
		accessGrant: v.optional(v.string()),
		imageId: v.optional(v.id("galleryImages")),
		ipHash: v.string(),
		type: v.union(
			v.literal("single"),
			v.literal("zip"),
			v.literal("favorites"),
		),
	},
	handler: async (ctx, { token, accessGrant, ...download }) => {
		const gallery = await requireGalleryPortalToken(ctx, token, download.galleryId, accessGrant);
		if (gallery.siteUrl !== download.siteUrl) throw new Error("Gallery not found");
		if (download.imageId) {
			const image = await ctx.db.get(download.imageId);
			if (
				!image ||
				image.galleryId !== download.galleryId ||
				image.siteUrl !== download.siteUrl
			) {
				throw new Error("Image not found");
			}
		}

		await ctx.db.insert("galleryDownloads", {
			...download,
			downloadedAt: Date.now(),
		});

		if (download.imageId) {
			const image = await ctx.db.get(download.imageId);
			if (image) {
				await ctx.db.patch(download.imageId, {
					downloadCount: image.downloadCount + 1,
				});
			}
		}
	},
});

export const getDownloadStats = query({
	args: { galleryId: v.id("galleries") },
	handler: async (ctx, { galleryId }) => {
		await requireDocumentSiteAdmin(ctx, "galleries", galleryId, "galleryDelivery");
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
