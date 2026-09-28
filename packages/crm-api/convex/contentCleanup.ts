import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { mutation, query, type MutationCtx } from "./_generated/server";
import { requireDocumentSiteAdmin, requireSiteAdmin } from "./authHelpers";

const MAX_ROWS = 1500;
const kind = v.union(v.literal("post"), v.literal("author"), v.literal("category"));

async function revisionRows(ctx: MutationCtx, revision: Doc<"contentRevisions">) {
	const groups = await Promise.all([
		ctx.db
			.query("contentBlocks")
			.withIndex("by_revisionId_and_order", (q) => q.eq("revisionId", revision._id))
			.take(MAX_ROWS + 1),
		ctx.db
			.query("contentMediaPlacements")
			.withIndex("by_revisionId_and_role_and_order", (q) => q.eq("revisionId", revision._id))
			.take(MAX_ROWS + 1),
		ctx.db
			.query("contentPostTechnicalItems")
			.withIndex("by_revisionId_and_field_and_order", (q) => q.eq("revisionId", revision._id))
			.take(MAX_ROWS + 1),
		ctx.db
			.query("contentReferences")
			.withIndex("by_fromRevisionId_and_field_and_order", (q) =>
				q.eq("fromRevisionId", revision._id),
			)
			.take(MAX_ROWS + 1),
	]);
	const rows = groups.flat();
	if (rows.length > MAX_ROWS) throw new Error("Content cleanup exceeds the safe transaction limit");
	for (const row of rows) {
		const documentId = "documentId" in row ? row.documentId : row.fromDocumentId;
		if (row.siteUrl !== revision.siteUrl || documentId !== revision.documentId)
			throw new Error("Content graph ownership mismatch");
	}
	return rows;
}

export const list = query({
	args: { siteUrl: v.string(), kind, paginationOpts: paginationOptsValidator },
	handler: async (ctx, args) => {
		await requireSiteAdmin(ctx, args.siteUrl);
		if (
			!Number.isSafeInteger(args.paginationOpts.numItems) ||
			args.paginationOpts.numItems < 1 ||
			args.paginationOpts.numItems > 50
		)
			throw new Error("Invalid page size");
		const result = await ctx.db
			.query("contentDocuments")
			.withIndex("by_siteUrl_and_kind", (q) => q.eq("siteUrl", args.siteUrl).eq("kind", args.kind))
			.paginate(args.paginationOpts);
		return {
			...result,
			page: result.page
				.filter((doc) => doc.purgedAt === undefined)
				.map((doc) => ({
					documentId: doc._id,
					kind: doc.kind,
					slug: doc.slug ?? doc.documentKey ?? doc._id,
					archivedAt: doc.archivedAt ?? null,
					updatedAt: doc.updatedAt,
				})),
		};
	},
});

export const listRevisions = query({
	args: { documentId: v.id("contentDocuments"), paginationOpts: paginationOptsValidator },
	handler: async (ctx, args) => {
		const doc = await requireDocumentSiteAdmin(ctx, "contentDocuments", args.documentId);
		if (
			!Number.isSafeInteger(args.paginationOpts.numItems) ||
			args.paginationOpts.numItems < 1 ||
			args.paginationOpts.numItems > 50
		)
			throw new Error("Invalid page size");
		const result = await ctx.db
			.query("contentRevisions")
			.withIndex("by_documentId_and_createdAt", (q) => q.eq("documentId", doc._id))
			.order("desc")
			.paginate(args.paginationOpts);
		return {
			...result,
			page: result.page.map((row) => ({
				revisionId: row._id,
				createdAt: row.createdAt,
				active: row._id === doc.draftRevisionId || row._id === doc.publishedRevisionId,
			})),
		};
	},
});

export const pruneRevision = mutation({
	args: {
		documentId: v.id("contentDocuments"),
		revisionId: v.id("contentRevisions"),
		expectedUpdatedAt: v.number(),
	},
	handler: async (ctx, args) => {
		const doc = await requireDocumentSiteAdmin(ctx, "contentDocuments", args.documentId);
		if (doc.updatedAt !== args.expectedUpdatedAt)
			throw new Error("Content changed; refresh before cleanup");
		if (doc.draftRevisionId === args.revisionId || doc.publishedRevisionId === args.revisionId)
			throw new Error("Active revisions must be retained");
		const revision = await ctx.db.get(args.revisionId);
		if (!revision) return { deleted: true };
		if (revision.documentId !== doc._id || revision.siteUrl !== doc.siteUrl)
			throw new Error("Revision not found");
		const restored = await ctx.db
			.query("contentRevisions")
			.withIndex("by_restoredFromRevisionId", (q) => q.eq("restoredFromRevisionId", revision._id))
			.first();
		if (restored) throw new Error("Revision is retained as restore provenance");
		for (const row of await revisionRows(ctx, revision)) await ctx.db.delete(row._id);
		await ctx.db.delete(revision._id);
		return { deleted: true };
	},
});

export const purgeArchived = mutation({
	args: { documentId: v.id("contentDocuments"), expectedUpdatedAt: v.number() },
	handler: async (ctx, args) => {
		const doc = await requireDocumentSiteAdmin(ctx, "contentDocuments", args.documentId);
		if (!["post", "author", "category"].includes(doc.kind))
			throw new Error("Fixed site pages cannot be purged");
		if (doc.purgedAt !== undefined) return { deleted: true };
		if (doc.updatedAt !== args.expectedUpdatedAt)
			throw new Error("Content changed; refresh before cleanup");
		if (doc.archivedAt === undefined) throw new Error("Archive content before permanent deletion");
		const incoming = await ctx.db
			.query("contentReferences")
			.withIndex("by_siteUrl_and_toDocumentId", (q) =>
				q.eq("siteUrl", doc.siteUrl).eq("toDocumentId", doc._id),
			)
			.first();
		if (incoming)
			throw new Error("Content is retained by another revision; remove that reference first");
		const revisions = await ctx.db
			.query("contentRevisions")
			.withIndex("by_documentId_and_createdAt", (q) => q.eq("documentId", doc._id))
			.take(MAX_ROWS + 1);
		if (revisions.length > MAX_ROWS)
			throw new Error("Content cleanup exceeds the safe transaction limit");
		const rows = [];
		for (const revision of revisions) {
			if (revision.siteUrl !== doc.siteUrl || revision.kind !== doc.kind)
				throw new Error("Content graph ownership mismatch");
			const restored = await ctx.db
				.query("contentRevisions")
				.withIndex("by_restoredFromRevisionId", (q) => q.eq("restoredFromRevisionId", revision._id))
				.take(MAX_ROWS + 1);
			if (restored.length > MAX_ROWS || restored.some((row) => row.documentId !== doc._id))
				throw new Error("Content is retained as restore provenance");
			rows.push(...(await revisionRows(ctx, revision)), revision);
			if (rows.length > MAX_ROWS)
				throw new Error("Content cleanup exceeds the safe transaction limit");
		}
		for (const row of rows) await ctx.db.delete(row._id);
		// Retain only the identity/header so old URLs and import keys cannot be recycled.
		await ctx.db.patch(doc._id, {
			purgedAt: Date.now(),
			draftRevisionId: undefined,
			publishedRevisionId: undefined,
			publishedAt: undefined,
			publishedBy: undefined,
		});
		return { deleted: true };
	},
});
