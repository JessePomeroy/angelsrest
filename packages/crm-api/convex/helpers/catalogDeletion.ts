import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { requireAuth, requireSiteAdmin, requireDocumentSiteAdminWithClient } from "../authHelpers";

export type PrivateAssetKind = "print_source" | "paid_digital_file";
export type PrivateAssetId = Id<"catalogPrintSourceAssets"> | Id<"catalogDigitalFileAssets">;

export async function privateAssetDeletion(
	ctx: Pick<QueryCtx, "db">,
	siteUrl: string,
	kind: PrivateAssetKind,
	assetKey: string,
) {
	return await ctx.db.query("catalogPrivateAssetDeletions")
		.withIndex("by_siteUrl_and_kind_and_assetKey", (q) =>
			q.eq("siteUrl", siteUrl).eq("kind", kind).eq("assetKey", assetKey))
		.unique();
}

export async function requirePrivateAssetAvailable(
	ctx: Pick<QueryCtx, "db">,
	siteUrl: string,
	kind: PrivateAssetKind,
	assetKey: string,
) {
	if (await privateAssetDeletion(ctx, siteUrl, kind, assetKey)) {
		throw new Error("Private catalog file has been marked for permanent deletion");
	}
}

export async function requirePrivateAssetUnused(
	ctx: Pick<QueryCtx, "db">,
	siteUrl: string,
	kind: PrivateAssetKind,
	assetId: PrivateAssetId,
) {
	const references = kind === "print_source"
		? await ctx.db.query("catalogProductPrintSources")
			.withIndex("by_siteUrl_and_assetId", (q) => q.eq("siteUrl", siteUrl).eq("assetId", assetId as Id<"catalogPrintSourceAssets">)).take(1)
		: await ctx.db.query("catalogProductDigitalFiles")
			.withIndex("by_siteUrl_and_assetId", (q) => q.eq("siteUrl", siteUrl).eq("assetId", assetId as Id<"catalogDigitalFileAssets">)).take(1);
	// Historical revisions are still used by paid downloads and fulfillment.
	// Remove an unused product first; discarding its draft is not sufficient.
	if (references.length) throw new Error("File is retained by a catalog product revision. Delete the unused product first.");
}

export async function requirePrivateObjectUnused(ctx: Pick<QueryCtx, "db">, siteUrl: string, key: string) {
	const { orders, reservations } = await retentionRows(ctx, siteUrl);
	for (const row of [...orders, ...reservations]) {
		if (row.printInput?.lines.some((line) => line.sources.some((source) => source.descriptor.key === key))) {
			throw new Error("Private file is retained by order or checkout production data");
		}
	}
}

async function retentionRows(ctx: Pick<QueryCtx, "db">, siteUrl: string) {
	const orders = await ctx.db.query("orders").withIndex("by_siteUrl", (q) => q.eq("siteUrl", siteUrl)).take(RETENTION_SCAN_LIMIT + 1);
	const reservations = await ctx.db.query("checkoutSnapshotReservations")
		.withIndex("by_siteUrl_and_state", (q) => q.eq("siteUrl", siteUrl)).take(RETENTION_SCAN_LIMIT + 1);
	if (orders.length > RETENTION_SCAN_LIMIT || reservations.length > RETENTION_SCAN_LIMIT) {
		throw new Error("Catalog retention history exceeds the safe cleanup limit. No records were deleted.");
	}
	return { orders, reservations };
}

const RETENTION_SCAN_LIMIT = 500;
const GRAPH_ROW_LIMIT = 1500;
const GRAPH_TABLES = [
	"catalogProductVariants", "catalogProductMediaPlacements", "catalogProductPrintSources",
	"catalogProductSetMembers", "catalogProductDigitalFiles", "catalogProductShopPlacements",
] as const;

/** Atomic cleanup only after proving that neither sales nor pending checkout need this graph. */
export async function removeUnusedCatalogProduct(
	ctx: MutationCtx,
	args: { productId: Id<"catalogProducts">; expectedUpdatedAt: number },
) {
	await requireAuth(ctx);
	if (!(await ctx.db.get(args.productId))) {
		const tombstone = await ctx.db.query("catalogProductDeletions")
			.withIndex("by_productId", (q) => q.eq("productId", args.productId)).unique();
		if (!tombstone) throw new Error("Product not found");
		await requireSiteAdmin(ctx, tombstone.siteUrl);
		return { deleted: true, productId: args.productId };
	}
	const { doc: product, identity } = await requireDocumentSiteAdminWithClient(ctx, "catalogProducts", args.productId);
	if (product.updatedAt !== args.expectedUpdatedAt) throw new Error("Product changed. Reload before deleting.");
	if (product.publishedRevisionId) throw new Error("Unpublish the product before deleting it.");
	const { orders, reservations } = await retentionRows(ctx, product.siteUrl);
	const referencesProduct = (items: readonly { productKey: string }[]) =>
		items.some((item) => item.productKey === product._id || item.productKey === product.productKey);
	if (orders.some((order) => referencesProduct(order.checkoutSnapshot?.items ?? []))
		|| reservations.some((reservation) => referencesProduct(reservation.snapshot.items))) {
		throw new Error("Product is retained by an order or checkout. Its history and files cannot be deleted.");
	}
	const revisions = await ctx.db.query("catalogProductRevisions")
		.withIndex("by_siteUrl_and_productId", (q) => q.eq("siteUrl", product.siteUrl).eq("productId", product._id)).take(GRAPH_ROW_LIMIT + 1);
	const ids: (Id<typeof GRAPH_TABLES[number]> | Id<"catalogProductRevisions">)[] = revisions.map((row) => row._id);
	for (const table of GRAPH_TABLES) {
		const rows = await ctx.db.query(table).withIndex("by_productId_and_revisionId", (q) => q.eq("productId", product._id)).take(GRAPH_ROW_LIMIT + 1);
		if (rows.some((row) => row.siteUrl !== product.siteUrl)) throw new Error("Catalog graph ownership mismatch");
		ids.push(...rows.map((row) => row._id));
		if (ids.length > GRAPH_ROW_LIMIT) throw new Error("Catalog history exceeds the safe cleanup limit. No records were deleted.");
	}
	for (const id of ids) await ctx.db.delete(id);
	await ctx.db.insert("catalogProductDeletions", { siteUrl: product.siteUrl, productId: product._id, productKey: product.productKey, deletedAt: Date.now(), deletedBy: identity.tokenIdentifier });
	await ctx.db.delete(product._id);
	return { deleted: true, productId: product._id };
}

/** Fence delayed checkout/order requests after graph removal, including legacy transports. */
export async function requireSnapshotProductsNotDeleted(
	ctx: Pick<QueryCtx, "db">, siteUrl: string, items: readonly { productKey: string }[],
) {
	for (const item of items) {
		const productId = ctx.db.normalizeId("catalogProducts", item.productKey);
		if (productId && await ctx.db.query("catalogProductDeletions")
			.withIndex("by_siteUrl_and_productId", (q) => q.eq("siteUrl", siteUrl).eq("productId", productId)).unique()) {
			throw new Error("Checkout product was permanently deleted");
		}
	}
}
