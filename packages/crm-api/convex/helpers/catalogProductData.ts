import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
	CATALOG_PRODUCT_LIMITS,
	type CatalogProductDraft,
	serializeCatalogProductDraft,
	validateCatalogProductDraft,
} from "./catalogProductValidators";

type CatalogContext = QueryCtx | MutationCtx;
type CatalogProduct = Doc<"catalogProducts">;
type CatalogRevision = Doc<"catalogProductRevisions">;

export async function checksumCatalogProductDraft(draft: CatalogProductDraft) {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(serializeCatalogProductDraft(draft)),
	);
	return Array.from(new Uint8Array(digest), (byte) =>
		byte.toString(16).padStart(2, "0"),
	).join("");
}

export function requireSinglePrintProduct(product: CatalogProduct) {
	if (product.productKind !== "print") {
		throw new Error("Catalog product is not a single print");
	}
	return product;
}

export function assertCatalogRevisionOwnership(
	revision: CatalogRevision,
	product: CatalogProduct,
) {
	if (
		revision.productId !== product._id
		|| revision.siteUrl !== product.siteUrl
		|| revision.productKind !== product.productKind
		|| revision.schemaVersion !== 1
	) {
		throw new Error("Catalog revision ownership mismatch");
	}
}

export function assertExpectedCatalogDraft(
	product: CatalogProduct,
	expectedDraftRevisionId: Id<"catalogProductRevisions"> | undefined,
) {
	if (product.draftRevisionId !== expectedDraftRevisionId) {
		throw new Error("Catalog draft conflict: reload before saving or discarding");
	}
}

export async function getCatalogRevision(
	ctx: CatalogContext,
	revisionId: Id<"catalogProductRevisions"> | undefined,
) {
	return revisionId ? await ctx.db.get(revisionId) : null;
}

async function getCatalogVariants(
	ctx: CatalogContext,
	revisionId: Id<"catalogProductRevisions">,
) {
	const variants = await ctx.db
		.query("catalogProductVariants")
		.withIndex("by_revisionId_and_order", (q) => q.eq("revisionId", revisionId))
		.take(CATALOG_PRODUCT_LIMITS.variantsPerRevision + 1);
	if (variants.length > CATALOG_PRODUCT_LIMITS.variantsPerRevision) {
		throw new Error("Catalog variant limit exceeded");
	}
	return variants;
}

function draftFromRevision(
	revision: CatalogRevision,
	variants: Doc<"catalogProductVariants">[],
): CatalogProductDraft {
	return {
		title: revision.title,
		slug: revision.slug,
		description: revision.description,
		fulfillmentMode: revision.fulfillmentMode,
		saleAvailability: revision.saleAvailability,
		borderOptionsEnabled: revision.borderOptionsEnabled,
		frameOptionsEnabled: revision.frameOptionsEnabled,
		framePriceMultiplierBasisPoints: revision.framePriceMultiplierBasisPoints,
		variants: variants.map((variant) => ({
			key: variant.variantKey,
			materialOptionKey: variant.materialOptionKey,
			sizeOptionKey: variant.sizeOptionKey,
			retailPriceCents: variant.retailPriceCents,
			status: variant.status,
		})),
	};
}

export async function loadCatalogRevisionGraph(
	ctx: CatalogContext,
	product: CatalogProduct,
	revisionId: Id<"catalogProductRevisions"> | undefined,
) {
	if (!revisionId) return null;
	const revision = await getCatalogRevision(ctx, revisionId);
	if (!revision) throw new Error("Catalog revision not found");
	assertCatalogRevisionOwnership(revision, product);
	const variants = await getCatalogVariants(ctx, revision._id);
	if (variants.length !== revision.variantCount) {
		throw new Error("Catalog variant count mismatch");
	}
	for (const [order, variant] of variants.entries()) {
		if (
			variant.siteUrl !== product.siteUrl
			|| variant.productId !== product._id
			|| variant.revisionId !== revision._id
		) {
			throw new Error("Catalog variant ownership mismatch");
		}
		if (variant.order !== order) {
			throw new Error("Catalog variant order must be contiguous");
		}
	}
	const draft = draftFromRevision(revision, variants);
	validateCatalogProductDraft(draft);
	if (await checksumCatalogProductDraft(draft) !== revision.checksum) {
		throw new Error("Catalog revision checksum mismatch");
	}
	return { revision, variants, draft };
}

export async function insertCatalogRevisionGraph(
	ctx: MutationCtx,
	args: {
		product: CatalogProduct;
		draft: CatalogProductDraft;
		checksum: string;
		source: "admin" | "sanityImport" | "restore";
		createdAt: number;
		createdBy: string;
	},
) {
	const revisionId = await ctx.db.insert("catalogProductRevisions", {
		siteUrl: args.product.siteUrl,
		productId: args.product._id,
		productKind: "print",
		schemaVersion: 1,
		title: args.draft.title,
		slug: args.draft.slug,
		description: args.draft.description,
		currency: "usd",
		fulfillmentMode: args.draft.fulfillmentMode,
		saleAvailability: args.draft.saleAvailability,
		borderOptionsEnabled: args.draft.borderOptionsEnabled,
		frameOptionsEnabled: args.draft.frameOptionsEnabled,
		framePriceMultiplierBasisPoints: args.draft.framePriceMultiplierBasisPoints,
		variantCount: args.draft.variants.length,
		checksum: args.checksum,
		source: args.source,
		createdAt: args.createdAt,
		createdBy: args.createdBy,
	});
	for (const [order, variant] of args.draft.variants.entries()) {
		await ctx.db.insert("catalogProductVariants", {
			siteUrl: args.product.siteUrl,
			productId: args.product._id,
			revisionId,
			variantKey: variant.key,
			order,
			materialOptionKey: variant.materialOptionKey,
			sizeOptionKey: variant.sizeOptionKey,
			retailPriceCents: variant.retailPriceCents,
			status: variant.status,
		});
	}
	return revisionId;
}

export function projectCatalogEditorRevision(
	graph: Awaited<ReturnType<typeof loadCatalogRevisionGraph>>,
) {
	if (!graph) return null;
	return {
		revisionId: graph.revision._id,
		schemaVersion: graph.revision.schemaVersion,
		productKind: graph.revision.productKind,
		currency: graph.revision.currency,
		title: graph.revision.title ?? null,
		slug: graph.revision.slug ?? null,
		description: graph.revision.description ?? null,
		fulfillmentMode: graph.revision.fulfillmentMode,
		saleAvailability: graph.revision.saleAvailability,
		borderOptionsEnabled: graph.revision.borderOptionsEnabled,
		frameOptionsEnabled: graph.revision.frameOptionsEnabled,
		framePriceMultiplierBasisPoints: graph.revision.framePriceMultiplierBasisPoints,
		variantCount: graph.revision.variantCount,
		checksum: graph.revision.checksum,
		source: graph.revision.source,
		createdAt: graph.revision.createdAt,
		variants: graph.variants.map((variant) => ({
			key: variant.variantKey,
			order: variant.order,
			materialOptionKey: variant.materialOptionKey ?? null,
			sizeOptionKey: variant.sizeOptionKey ?? null,
			retailPriceCents: variant.retailPriceCents ?? null,
			status: variant.status,
		})),
	};
}
