import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { requireDocumentSiteAdmin, requireSiteAdmin } from "../authHelpers";
import {
	assertCatalogRevisionOwnership,
	assertExpectedCatalogDraft,
	checksumCatalogProductDraft,
	getCatalogRevision,
	insertCatalogRevisionGraph,
	loadCatalogRevisionGraph,
	loadCatalogRevisionSummary,
	projectCatalogEditorRevision,
	projectCatalogEditorRevisionSummary,
	requireSinglePrintProduct,
} from "./catalogProductData";
import {
	CATALOG_PRODUCT_LIMITS,
	type CatalogProductDraft,
	canonicalCatalogSlug,
	validateCatalogProductDraft,
	validateCatalogProductKey,
	validateCatalogProductSlug,
	validateCatalogTimestamp,
} from "./catalogProductValidators";

type CatalogContext = QueryCtx | MutationCtx;

async function getProductByKey(
	ctx: CatalogContext,
	siteUrl: string,
	productKey: string,
) {
	return await ctx.db
		.query("catalogProducts")
		.withIndex("by_siteUrl_and_productKey", (q) =>
			q.eq("siteUrl", siteUrl).eq("productKey", productKey),
		)
		.unique();
}

async function requireAvailableSlug(
	ctx: CatalogContext,
	siteUrl: string,
	slug: string | undefined,
	productId?: Id<"catalogProducts">,
) {
	if (!slug) return;
	const owner = await ctx.db
		.query("catalogProducts")
		.withIndex("by_siteUrl_and_slug", (q) => q.eq("siteUrl", siteUrl).eq("slug", slug))
		.unique();
	if (owner && owner._id !== productId) {
		throw new Error(`Catalog product slug "${slug}" already exists`);
	}
}

function requireActiveDraftSlugIntegrity(
	product: Doc<"catalogProducts">,
	draft: CatalogProductDraft,
) {
	if (product.slug !== canonicalCatalogSlug(draft.slug)) {
		throw new Error("Catalog product slug ownership mismatch");
	}
}

export async function createCatalogProductDraft(
	ctx: MutationCtx,
	args: {
		siteUrl: string;
		productKey: string;
		draft: CatalogProductDraft;
	},
) {
	const { identity, client } = await requireSiteAdmin(ctx, args.siteUrl);
	validateCatalogProductKey(args.productKey);
	validateCatalogProductDraft(args.draft);
	const checksum = await checksumCatalogProductDraft(args.draft);
	const existing = await getProductByKey(ctx, client.siteUrl, args.productKey);
	if (existing) {
		requireSinglePrintProduct(existing);
		const active = await loadCatalogRevisionGraph(ctx, existing, existing.draftRevisionId);
		if (active) requireActiveDraftSlugIntegrity(existing, active.draft);
		if (active?.revision.checksum === checksum) {
			return { productId: existing._id, revisionId: active.revision._id };
		}
		throw new Error(`Catalog product key "${args.productKey}" already exists`);
	}

	const slug = canonicalCatalogSlug(args.draft.slug);
	await requireAvailableSlug(ctx, client.siteUrl, slug);
	const products = await ctx.db
		.query("catalogProducts")
		.withIndex("by_siteUrl_and_productKind_and_createdAt", (q) =>
			q.eq("siteUrl", client.siteUrl).eq("productKind", "print"),
		)
		.take(CATALOG_PRODUCT_LIMITS.productsPerKind + 1);
	if (products.length >= CATALOG_PRODUCT_LIMITS.productsPerKind) {
		throw new Error(
			`A site cannot exceed ${CATALOG_PRODUCT_LIMITS.productsPerKind} print products`,
		);
	}

	const now = Date.now();
	const actor = identity.tokenIdentifier;
	const productId = await ctx.db.insert("catalogProducts", {
		siteUrl: client.siteUrl,
		productKey: args.productKey,
		productKind: "print",
		slug,
		createdAt: now,
		createdBy: actor,
		updatedAt: now,
		updatedBy: actor,
	});
	const product = await ctx.db.get(productId);
	if (!product) throw new Error("Catalog product creation failed");
	const revisionId = await insertCatalogRevisionGraph(ctx, {
		product,
		draft: args.draft,
		checksum,
		source: "admin",
		createdAt: now,
		createdBy: actor,
	});
	await ctx.db.patch(product._id, { draftRevisionId: revisionId });
	return { productId: product._id, revisionId };
}

export async function saveCatalogProductDraft(
	ctx: MutationCtx,
	args: {
		productId: Id<"catalogProducts">;
		expectedDraftRevisionId?: Id<"catalogProductRevisions">;
		draft: CatalogProductDraft;
	},
) {
	const product = requireSinglePrintProduct(
		await requireDocumentSiteAdmin(ctx, "catalogProducts", args.productId),
	);
	validateCatalogProductDraft(args.draft);
	const checksum = await checksumCatalogProductDraft(args.draft);
	const active = await loadCatalogRevisionGraph(ctx, product, product.draftRevisionId);
	if (active) requireActiveDraftSlugIntegrity(product, active.draft);
	if (active?.revision.checksum === checksum) {
		return { productId: product._id, revisionId: active.revision._id };
	}
	assertExpectedCatalogDraft(product, args.expectedDraftRevisionId);

	const slug = canonicalCatalogSlug(args.draft.slug);
	if (product.publishedRevisionId && product.slug !== slug) {
		throw new Error("Published product slug changes require redirect support");
	}
	await requireAvailableSlug(ctx, product.siteUrl, slug, product._id);
	const identity = await ctx.auth.getUserIdentity();
	if (!identity) throw new Error("Not authenticated");
	const now = Date.now();
	const revisionId = await insertCatalogRevisionGraph(ctx, {
		product,
		draft: args.draft,
		checksum,
		source: "admin",
		createdAt: now,
		createdBy: identity.tokenIdentifier,
	});
	await ctx.db.patch(product._id, {
		slug,
		draftRevisionId: revisionId,
		updatedAt: now,
		updatedBy: identity.tokenIdentifier,
	});
	return { productId: product._id, revisionId };
}

export async function discardCatalogProductDraft(
	ctx: MutationCtx,
	args: {
		productId: Id<"catalogProducts">;
		draftRevisionId: Id<"catalogProductRevisions">;
	},
) {
	const product = requireSinglePrintProduct(
		await requireDocumentSiteAdmin(ctx, "catalogProducts", args.productId),
	);
	if (product.draftRevisionId === args.draftRevisionId) {
		await loadCatalogRevisionGraph(ctx, product, args.draftRevisionId);
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new Error("Not authenticated");
		await ctx.db.patch(product._id, {
			draftRevisionId: undefined,
			...(product.publishedRevisionId ? {} : { slug: undefined }),
			updatedAt: Date.now(),
			updatedBy: identity.tokenIdentifier,
		});
		return { productId: product._id, draftRevisionId: null };
	}
	if (!product.draftRevisionId) {
		const revision = await getCatalogRevision(ctx, args.draftRevisionId);
		if (!revision) throw new Error("Catalog revision not found");
		assertCatalogRevisionOwnership(revision, product);
		await loadCatalogRevisionGraph(ctx, product, revision._id);
		return { productId: product._id, draftRevisionId: null };
	}
	throw new Error("Catalog draft conflict: reload before discarding");
}

export async function getCatalogProductEditorState(
	ctx: QueryCtx,
	productId: Id<"catalogProducts">,
) {
	const product = requireSinglePrintProduct(
		await requireDocumentSiteAdmin(ctx, "catalogProducts", productId),
	);
	const [draft, published] = await Promise.all([
		loadCatalogRevisionGraph(ctx, product, product.draftRevisionId),
		loadCatalogRevisionGraph(ctx, product, product.publishedRevisionId),
	]);
	if (draft) requireActiveDraftSlugIntegrity(product, draft.draft);
	return {
		productId: product._id,
		productKey: product.productKey,
		productKind: product.productKind,
		slug: product.slug ?? null,
		draft: projectCatalogEditorRevision(draft),
		published: projectCatalogEditorRevision(published),
		updatedAt: product.updatedAt,
		publishedAt: product.publishedAt ?? null,
	};
}

/**
 * Return compact headers for every single-print identity owned by one tenant.
 *
 * The catalog's existing per-kind capacity is also the list boundary. Reading
 * one extra row lets corruption fail closed rather than silently hiding it.
 */
export async function listCatalogProductsForEditor(
	ctx: QueryCtx,
	siteUrl: string,
) {
	const { client } = await requireSiteAdmin(ctx, siteUrl);
	const products = await ctx.db
		.query("catalogProducts")
		.withIndex("by_siteUrl_and_productKind_and_createdAt", (q) =>
			q.eq("siteUrl", client.siteUrl).eq("productKind", "print"),
		)
		.order("desc")
		.take(CATALOG_PRODUCT_LIMITS.productsPerKind + 1);
	if (products.length > CATALOG_PRODUCT_LIMITS.productsPerKind) {
		throw new Error("Catalog print product limit exceeded");
	}
	const productKeys = new Set<string>();
	const slugs = new Set<string>();
	for (const product of products) {
		if (productKeys.has(product.productKey)) {
			throw new Error("Duplicate catalog product key");
		}
		productKeys.add(product.productKey);
		if (product.slug !== undefined) {
			if (slugs.has(product.slug)) {
				throw new Error("Duplicate catalog product slug");
			}
			slugs.add(product.slug);
		}
	}

	return await Promise.all(products.map(async (storedProduct) => {
		const product = requireSinglePrintProduct(storedProduct);
		validateCatalogProductKey(product.productKey);
		validateCatalogProductSlug(product.slug);
		validateCatalogTimestamp(product.createdAt, "Catalog product created timestamp");
		validateCatalogTimestamp(product.updatedAt, "Catalog product updated timestamp");
		if (product.updatedAt < product.createdAt) {
			throw new Error("Catalog product updated timestamp cannot precede created timestamp");
		}
		const hasPublishedRevision = product.publishedRevisionId !== undefined;
		if (
			hasPublishedRevision !== (product.publishedAt !== undefined)
			|| hasPublishedRevision !== (product.publishedBy !== undefined)
		) {
			throw new Error("Catalog product publication fields must move together");
		}
		if (product.publishedAt !== undefined) {
			validateCatalogTimestamp(product.publishedAt, "Catalog product published timestamp");
			if (
				product.publishedAt < product.createdAt
				|| product.publishedAt > product.updatedAt
			) {
				throw new Error("Catalog product published timestamp is outside its lifecycle");
			}
		}
		const [draft, published] = await Promise.all([
			loadCatalogRevisionSummary(ctx, product, product.draftRevisionId),
			loadCatalogRevisionSummary(ctx, product, product.publishedRevisionId),
		]);
		for (const revision of [draft, published]) {
			if (
				revision
				&& (
					revision.createdAt < product.createdAt
					|| revision.createdAt > product.updatedAt
				)
			) {
				throw new Error("Catalog revision timestamp is outside its product lifecycle");
			}
		}
		if (
			published
			&& (
				product.publishedAt === undefined
				|| published.createdAt > product.publishedAt
			)
		) {
			throw new Error("Catalog published revision postdates publication");
		}
		if (!draft && !published && product.slug !== undefined) {
			throw new Error("Catalog product slug ownership mismatch");
		}
		return {
			productId: product._id,
			productKey: product.productKey,
			productKind: product.productKind,
			slug: product.slug ?? null,
			draft: projectCatalogEditorRevisionSummary(draft),
			published: projectCatalogEditorRevisionSummary(published),
			createdAt: product.createdAt,
			updatedAt: product.updatedAt,
			publishedAt: product.publishedAt ?? null,
		};
	}));
}
