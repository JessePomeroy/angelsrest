import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { query, type QueryCtx } from "./_generated/server";
import { requireCreator, requireSiteAdmin } from "./authHelpers";
import { resolveTenantContext } from "./helpers/tenantContext";

// An export is a read-only projection, never a shared-database backup.
function pick<T extends object, K extends keyof T>(value: T, keys: readonly K[]) {
	const result: Partial<Pick<T, K>> = {};
	for (const key of keys) if (value[key] !== undefined) result[key] = value[key];
	return result;
}
const GRAPH_LIMIT = 1000;
async function rows<T extends { siteUrl: string }>(promise: Promise<T[]>, siteUrl: string) {
	const result = await promise;
	if (result.length > GRAPH_LIMIT)
		throw new Error("Export graph exceeds safe read limit; no complete export is possible");
	if (result.some((row) => row.siteUrl !== siteUrl))
		throw new Error("Export graph tenant mismatch");
	return result;
}
function current<T>(document: { draftRevisionId?: T; publishedRevisionId?: T }) {
	return [
		...new Set(
			[document.draftRevisionId, document.publishedRevisionId].filter(
				(id): id is T => id !== undefined,
			),
		),
	];
}
function states<T>(document: { draftRevisionId?: T; publishedRevisionId?: T }, id: T) {
	return [
		document.draftRevisionId === id ? "draft" : null,
		document.publishedRevisionId === id ? "published" : null,
	].filter((state) => state !== null);
}
async function content(ctx: QueryCtx, doc: Doc<"contentDocuments">) {
	const revisions = [];
	for (const id of current(doc)) {
		const revision = await ctx.db.get(id);
		if (
			!revision ||
			revision.siteUrl !== doc.siteUrl ||
			revision.documentId !== doc._id ||
			revision.kind !== doc.kind
		)
			throw new Error("Export content revision is missing or mismatched");
		const [blocks, media, technical, references] = await Promise.all([
			rows(
				ctx.db
					.query("contentBlocks")
					.withIndex("by_documentId_and_revisionId", (q) =>
						q.eq("documentId", doc._id).eq("revisionId", id),
					)
					.take(GRAPH_LIMIT + 1),
				doc.siteUrl,
			),
			rows(
				ctx.db
					.query("contentMediaPlacements")
					.withIndex("by_documentId_and_revisionId", (q) =>
						q.eq("documentId", doc._id).eq("revisionId", id),
					)
					.take(GRAPH_LIMIT + 1),
				doc.siteUrl,
			),
			rows(
				ctx.db
					.query("contentPostTechnicalItems")
					.withIndex("by_documentId_and_revisionId", (q) =>
						q.eq("documentId", doc._id).eq("revisionId", id),
					)
					.take(GRAPH_LIMIT + 1),
				doc.siteUrl,
			),
			rows(
				ctx.db
					.query("contentReferences")
					.withIndex("by_fromDocumentId_and_fromRevisionId", (q) =>
						q.eq("fromDocumentId", doc._id).eq("fromRevisionId", id),
					)
					.take(GRAPH_LIMIT + 1),
				doc.siteUrl,
			),
		]);
		const payload = revision.payload;
		if (
			"kind" in payload &&
			payload.kind === "post" &&
			(blocks.length !== payload.bodyBlockCount ||
				media.length !== payload.mediaPlacementCount ||
				references.length !== payload.referenceCount ||
				technical.filter((row) => row.field === "equipment").length !== payload.equipmentCount ||
				technical.filter((row) => row.field === "material").length !== payload.materialCount)
		)
			throw new Error("Export post graph is incomplete");
		revisions.push({
			id,
			states: states(doc, id),
			...pick(revision, ["schemaVersion", "payload", "checksum", "createdAt"]),
			blocks: blocks.map((row) => pick(row, ["blockKey", "order", "block"])),
			media: media.map((row) =>
				pick(row, ["placementKey", "assetId", "role", "order", "altText", "caption"]),
			),
			technical: technical.map((row) =>
				pick(row, ["field", "itemKey", "order", "label", "details"]),
			),
			references: references.map((row) =>
				pick(row, ["toDocumentId", "field", "referenceKey", "order"]),
			),
		});
	}
	return {
		id: doc._id,
		...pick(doc, ["kind", "documentKey", "slug", "rank", "archivedAt", "purgedAt", "updatedAt"]),
		revisions,
	};
}
async function portfolio(ctx: QueryCtx, doc: Doc<"portfolioGalleries">) {
	const revisions = [];
	for (const id of current(doc)) {
		const revision = await ctx.db.get(id);
		if (!revision || revision.siteUrl !== doc.siteUrl || revision.galleryId !== doc._id)
			throw new Error("Export portfolio revision is missing or mismatched");
		const placements = await rows(
			ctx.db
				.query("portfolioPlacements")
				.withIndex("by_galleryId_and_revisionId", (q) =>
					q.eq("galleryId", doc._id).eq("revisionId", id),
				)
				.take(GRAPH_LIMIT + 1),
			doc.siteUrl,
		);
		if (placements.length !== revision.placementCount)
			throw new Error("Export portfolio placements are incomplete");
		revisions.push({
			id,
			states: states(doc, id),
			...pick(revision, [
				"title",
				"description",
				"slug",
				"seoDescription",
				"seoOgImageAssetId",
				"checksum",
				"createdAt",
			]),
			placements: placements.map((row) =>
				pick(row, ["placementKey", "assetId", "order", "altText", "caption", "focalPoint"]),
			),
		});
	}
	return {
		id: doc._id,
		...pick(doc, [
			"slug",
			"portfolioOrder",
			"isPublished",
			"isVisible",
			"updatedAt",
			"deletionRequestedAt",
		]),
		revisions,
	};
}
async function product(ctx: QueryCtx, doc: Doc<"catalogProducts">) {
	const revisions = [];
	for (const id of current(doc)) {
		const revision = await ctx.db.get(id);
		if (!revision || revision.siteUrl !== doc.siteUrl || revision.productId !== doc._id)
			throw new Error("Export product revision is missing or mismatched");
		const [variants, media, printSources, digitalFiles, setMembers, shopPlacements] =
			await Promise.all([
				rows(
					ctx.db
						.query("catalogProductVariants")
						.withIndex("by_productId_and_revisionId", (q) =>
							q.eq("productId", doc._id).eq("revisionId", id),
						)
						.take(GRAPH_LIMIT + 1),
					doc.siteUrl,
				),
				rows(
					ctx.db
						.query("catalogProductMediaPlacements")
						.withIndex("by_productId_and_revisionId", (q) =>
							q.eq("productId", doc._id).eq("revisionId", id),
						)
						.take(GRAPH_LIMIT + 1),
					doc.siteUrl,
				),
				rows(
					ctx.db
						.query("catalogProductPrintSources")
						.withIndex("by_productId_and_revisionId", (q) =>
							q.eq("productId", doc._id).eq("revisionId", id),
						)
						.take(GRAPH_LIMIT + 1),
					doc.siteUrl,
				),
				rows(
					ctx.db
						.query("catalogProductDigitalFiles")
						.withIndex("by_productId_and_revisionId", (q) =>
							q.eq("productId", doc._id).eq("revisionId", id),
						)
						.take(GRAPH_LIMIT + 1),
					doc.siteUrl,
				),
				rows(
					ctx.db
						.query("catalogProductSetMembers")
						.withIndex("by_productId_and_revisionId", (q) =>
							q.eq("productId", doc._id).eq("revisionId", id),
						)
						.take(GRAPH_LIMIT + 1),
					doc.siteUrl,
				),
				rows(
					ctx.db
						.query("catalogProductShopPlacements")
						.withIndex("by_productId_and_revisionId", (q) =>
							q.eq("productId", doc._id).eq("revisionId", id),
						)
						.take(GRAPH_LIMIT + 1),
					doc.siteUrl,
				),
			]);
		if (
			variants.length !== revision.variantCount ||
			(revision.schemaVersion === 2 &&
				(media.length !== revision.webMediaCount ||
					printSources.length !== revision.printSourceCount ||
					digitalFiles.length !== revision.digitalFileCount ||
					setMembers.length !== revision.setMemberCount ||
					shopPlacements.length !== revision.shopPlacementCount))
		)
			throw new Error("Export product graph is incomplete");
		revisions.push({
			id,
			states: states(doc, id),
			...pick(revision, [
				"schemaVersion",
				"title",
				"slug",
				"description",
				"productKind",
				"currency",
				"fulfillmentMode",
				"saleAvailability",
				"checksum",
				"createdAt",
			]),
			...(revision.schemaVersion === 1
				? pick(revision, [
						"borderOptionsEnabled",
						"frameOptionsEnabled",
						"framePriceMultiplierBasisPoints",
					])
				: {
						seoDescription: revision.seoDescription,
						...("printOptions" in revision ? { printOptions: revision.printOptions } : {}),
					}),
			variants: variants.map((row) =>
				pick(row, [
					"variantKey",
					"order",
					"materialOptionKey",
					"sizeOptionKey",
					"retailPriceCents",
					"status",
				]),
			),
			media: media.map((row) => pick(row, ["placementKey", "assetId", "role", "order", "altText"])),
			printSources: printSources.map((row) => pick(row, ["relationKey", "assetId", "order"])),
			digitalFiles: digitalFiles.map((row) => pick(row, ["relationKey", "assetId", "version"])),
			setMembers: setMembers.map((row) =>
				pick(row, ["memberKey", "order", "mediaPlacementKey", "printSourceKey"]),
			),
			shopPlacements: shopPlacements.map((row) => pick(row, ["featured", "orderRank"])),
		});
	}
	return {
		id: doc._id,
		...pick(doc, ["productKey", "productKind", "slug", "graphVersion", "updatedAt"]),
		revisions,
	};
}
async function privateAsset(
	ctx: QueryCtx,
	asset: Doc<"catalogPrintSourceAssets"> | Doc<"catalogDigitalFileAssets">,
	kind: "print_source" | "paid_digital_file",
) {
	const deletion = await ctx.db
		.query("catalogPrivateAssetDeletions")
		.withIndex("by_siteUrl_and_kind_and_assetKey", (q) =>
			q.eq("siteUrl", asset.siteUrl).eq("kind", kind).eq("assetKey", asset.assetKey),
		)
		.unique();
	const boundary = kind === "print_source" ? "print-sources" : "paid-digital-files";
	if (
		asset.privateObjectKey !==
		`sites/${asset.siteUrl}/catalog/${boundary}/${asset.assetKey}/original`
	)
		throw new Error("Export private asset key mismatch");
	return {
		id: asset._id,
		kind,
		...pick(asset, ["assetKey", "originalFilename", "mimeType", "sizeBytes", "sha256"]),
		status: deletion?.status ?? "ready",
		...("widthPixels" in asset
			? pick(asset, ["widthPixels", "heightPixels"])
			: pick(asset, ["version"])),
	};
}

export const page = query({
	args: {
		siteUrl: v.string(),
		family: v.union(
			v.literal("content"),
			v.literal("portfolio"),
			v.literal("products"),
			v.literal("web"),
			v.literal("print"),
			v.literal("digital"),
			v.literal("uploads"),
		),
		paginationOpts: paginationOptsValidator,
	},
	handler: async (ctx, args) => {
		const tenant = await resolveTenantContext(ctx, { siteUrl: args.siteUrl });
		if (!tenant) throw new Error("Export tenant not found");
		try {
			await requireSiteAdmin(ctx, tenant.siteUrl);
		} catch {
			await requireCreator(ctx);
		}
		const { siteUrl } = tenant;
		// One parent per transaction bounds even large revision graphs. Root lists are fully paginated.
		const options = { ...args.paginationOpts, numItems: 1 };
		const identity = { siteUrl, tenantId: tenant.tenantId };
		switch (args.family) {
			case "content": {
				const result = await ctx.db
					.query("contentDocuments")
					.withIndex("by_siteUrl_and_kind", (q) => q.eq("siteUrl", siteUrl))
					.paginate(options);
				return {
					...identity,
					...result,
					page: await Promise.all(result.page.map((doc) => content(ctx, doc))),
				};
			}
			case "portfolio": {
				const result = await ctx.db
					.query("portfolioGalleries")
					.withIndex("by_siteUrl_and_portfolioOrder", (q) => q.eq("siteUrl", siteUrl))
					.paginate(options);
				return {
					...identity,
					...result,
					page: await Promise.all(result.page.map((doc) => portfolio(ctx, doc))),
				};
			}
			case "products": {
				const result = await ctx.db
					.query("catalogProducts")
					.withIndex("by_siteUrl_and_productKey", (q) => q.eq("siteUrl", siteUrl))
					.paginate(options);
				return {
					...identity,
					...result,
					page: await Promise.all(result.page.map((doc) => product(ctx, doc))),
				};
			}
			case "web": {
				const result = await ctx.db
					.query("mediaAssets")
					.withIndex("by_siteUrl_and_assetId", (q) => q.eq("siteUrl", siteUrl))
					.paginate(options);
				return {
					...identity,
					...result,
					page: result.page.map((asset) => {
						if (asset.master.key !== `sites/${siteUrl}/web/${asset.assetId}/master.webp`)
							throw new Error("Export web master key mismatch");
						return {
							id: asset._id,
							kind: "web",
							assetKey: asset.assetId,
							status: asset.status,
							originalFilename: asset.originalFilename,
							mimeType: asset.master.contentType,
							sizeBytes: asset.master.sizeBytes,
							width: asset.master.width,
							height: asset.master.height,
							retainedVersion: "normalized_web_master",
						};
					}),
				};
			}
			case "print": {
				const result = await ctx.db
					.query("catalogPrintSourceAssets")
					.withIndex("by_siteUrl_and_assetKey", (q) => q.eq("siteUrl", siteUrl))
					.paginate(options);
				return {
					...identity,
					...result,
					page: await Promise.all(
						result.page.map((asset) => privateAsset(ctx, asset, "print_source")),
					),
				};
			}
			case "digital": {
				const result = await ctx.db
					.query("catalogDigitalFileAssets")
					.withIndex("by_siteUrl_and_assetKey", (q) => q.eq("siteUrl", siteUrl))
					.paginate(options);
				return {
					...identity,
					...result,
					page: await Promise.all(
						result.page.map((asset) => privateAsset(ctx, asset, "paid_digital_file")),
					),
				};
			}
			case "uploads": {
				const result = await ctx.db
					.query("catalogPrivateAssetEditorOperations")
					.withIndex("by_siteUrl_and_operationId", (q) => q.eq("siteUrl", siteUrl))
					.paginate(options);
				return {
					...identity,
					...result,
					page: result.page.map((row) => ({
						id: row._id,
						...pick(row, ["kind", "assetKey", "lifecycle"]),
					})),
				};
			}
		}
	},
});
