import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
	requireAuth,
	requireDocumentSiteAdmin,
	requireSiteAdmin,
} from "../authHelpers";
import {
	checksumCatalogProductGraphV2Draft,
	insertCatalogProductGraphV2Revision,
	loadCatalogProductGraphV2Revision,
	loadCatalogProductGraphV2RevisionSummary,
	normalizeCatalogProductGraphV2DraftAssets,
	projectCatalogProductGraphV2ForEditor,
	requireCatalogProductGraphV2Product,
} from "./catalogProductGraphData";
import {
	type CatalogProductGraphV2Draft,
	validateCatalogProductGraphV2Draft,
} from "./catalogProductGraphValidators";
import {
	CATALOG_PRODUCT_LIMITS,
	type CatalogProductKind,
	canonicalCatalogSlug,
	validateCatalogProductKey,
	validateCatalogProductSlug,
	validateCatalogTimestamp,
} from "./catalogProductValidators";

type CatalogContext = QueryCtx | MutationCtx;
type CatalogProduct = Doc<"catalogProducts">;
type CatalogGraphV2Product = CatalogProduct & { graphVersion: 2 };
type CatalogRevisionState = { createdAt: number } | null;
const CATALOG_GRAPH_LIST_PROOF_BATCH = 50;

async function mapCatalogGraphListInBatches<T, Result>(
	values: T[],
	map: (value: T) => Promise<Result>,
) {
	const results: Result[] = [];
	for (let start = 0; start < values.length; start += CATALOG_GRAPH_LIST_PROOF_BATCH) {
		results.push(...await Promise.all(
			values
				.slice(start, start + CATALOG_GRAPH_LIST_PROOF_BATCH)
				.map(map),
		));
	}
	return results;
}

async function getProductByKey(
	ctx: CatalogContext,
	siteUrl: string,
	productKey: string,
) {
	return await ctx.db
		.query("catalogProducts")
		.withIndex("by_siteUrl_and_productKey", (query) =>
			query.eq("siteUrl", siteUrl).eq("productKey", productKey),
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
		.withIndex("by_siteUrl_and_slug", (query) =>
			query.eq("siteUrl", siteUrl).eq("slug", slug),
		)
		.unique();
	if (owner && owner._id !== productId) {
		throw new Error(`Catalog product slug "${slug}" already exists`);
	}
}

async function proveTenantWideCatalogIdentity(
	ctx: CatalogContext,
	product: CatalogGraphV2Product,
) {
	const [keyOwner, slugOwner] = await Promise.all([
		getProductByKey(ctx, product.siteUrl, product.productKey),
		product.slug
			? ctx.db
				.query("catalogProducts")
				.withIndex("by_siteUrl_and_slug", (query) =>
					query.eq("siteUrl", product.siteUrl).eq("slug", product.slug),
				)
				.unique()
			: Promise.resolve(null),
	]);
	if (keyOwner?._id !== product._id || (product.slug && slugOwner?._id !== product._id)) {
		throw new Error("Catalog product identity ownership mismatch");
	}
}

function assertCatalogGraphV2ProductLifecycle(
	product: CatalogGraphV2Product,
	draft: CatalogRevisionState,
	published: CatalogRevisionState,
) {
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
	if (hasPublishedRevision !== (published !== null)) {
		throw new Error("Catalog published revision pointer is inconsistent");
	}
	if ((product.draftRevisionId !== undefined) !== (draft !== null)) {
		throw new Error("Catalog draft revision pointer is inconsistent");
	}

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
	if (product.publishedAt !== undefined) {
		validateCatalogTimestamp(product.publishedAt, "Catalog product published timestamp");
		if (
			product.publishedAt < product.createdAt
			|| product.publishedAt > product.updatedAt
		) {
			throw new Error("Catalog product published timestamp is outside its lifecycle");
		}
		if (!published || published.createdAt > product.publishedAt) {
			throw new Error("Catalog published revision postdates publication");
		}
	}
	if (!draft && !published && product.slug !== undefined) {
		throw new Error("Catalog product slug ownership mismatch");
	}
}

async function loadCatalogGraphV2RevisionSummaries(
	ctx: CatalogContext,
	product: CatalogGraphV2Product,
) {
	const [draft, published] = await Promise.all([
		loadCatalogProductGraphV2RevisionSummary(ctx, product, product.draftRevisionId),
		loadCatalogProductGraphV2RevisionSummary(
			ctx,
			product,
			product.publishedRevisionId,
		),
	]);
	assertCatalogGraphV2ProductLifecycle(product, draft, published);
	return { draft, published };
}

function assertExpectedCatalogGraphV2Draft(
	product: CatalogGraphV2Product,
	expectedDraftRevisionId: Id<"catalogProductRevisions"> | undefined,
) {
	if (product.draftRevisionId !== expectedDraftRevisionId) {
		throw new Error("Catalog draft conflict: reload before saving or discarding");
	}
}

async function requireOwnedCatalogGraphV2RevisionForDiscardReplay(
	ctx: MutationCtx,
	product: CatalogGraphV2Product,
	revisionId: Id<"catalogProductRevisions">,
) {
	const revision = await ctx.db.get(revisionId);
	if (!revision) throw new Error("Catalog V2 revision not found");
	if (
		revision.schemaVersion !== 2
		|| revision.siteUrl !== product.siteUrl
		|| revision.productId !== product._id
		|| revision.productKind !== product.productKind
	) {
		throw new Error("Catalog V2 revision ownership mismatch");
	}
	if (
		revision.createdAt < product.createdAt
		|| revision.createdAt > product.updatedAt
	) {
		throw new Error("Catalog revision timestamp is outside its product lifecycle");
	}

	// An unpublished product clears its identity slug when its final draft is
	// discarded. Reconstruct that historical slug only for the integrity read;
	// no document is written during an idempotent discard replay.
	const validationProduct =
		product.slug === undefined && product.publishedRevisionId === undefined
			? { ...product, slug: revision.slug }
			: product;
	await loadCatalogProductGraphV2Revision(ctx, validationProduct, revisionId);
}

/** Create one dormant, private V2 product identity and its first draft graph. */
export async function createCatalogProductGraphV2Draft(
	ctx: MutationCtx,
	args: {
		siteUrl: string;
		productKey: string;
		draft: CatalogProductGraphV2Draft;
	},
) {
	const { identity, client } = await requireSiteAdmin(ctx, args.siteUrl);
	validateCatalogProductKey(args.productKey);
	validateCatalogProductGraphV2Draft(args.draft);
	const draft = await normalizeCatalogProductGraphV2DraftAssets(
		ctx,
		client.siteUrl,
		args.draft,
	);
	const checksum = await checksumCatalogProductGraphV2Draft(draft);
	const existing = await getProductByKey(ctx, client.siteUrl, args.productKey);
	if (existing) {
		const product = requireCatalogProductGraphV2Product(existing);
		if (product.productKind !== draft.productKind) {
			throw new Error(`Catalog product key "${args.productKey}" already exists`);
		}
		const [active, published] = await Promise.all([
			loadCatalogProductGraphV2Revision(ctx, product, product.draftRevisionId),
			loadCatalogProductGraphV2RevisionSummary(
				ctx,
				product,
				product.publishedRevisionId,
			),
		]);
		assertCatalogGraphV2ProductLifecycle(product, active?.revision ?? null, published);
		if (active?.revision.checksum === checksum) {
			return { productId: product._id, revisionId: active.revision._id };
		}
		throw new Error(`Catalog product key "${args.productKey}" already exists`);
	}

	const slug = canonicalCatalogSlug(draft.slug);
	await requireAvailableSlug(ctx, client.siteUrl, slug);
	const products = await ctx.db
		.query("catalogProducts")
		.withIndex("by_siteUrl_and_graphVersion_and_productKind_and_createdAt", (query) =>
			query
				.eq("siteUrl", client.siteUrl)
				.eq("graphVersion", 2)
				.eq("productKind", draft.productKind),
		)
		.take(CATALOG_PRODUCT_LIMITS.productsPerKind + 1);
	if (products.length >= CATALOG_PRODUCT_LIMITS.productsPerKind) {
		throw new Error(
			`A site cannot exceed ${CATALOG_PRODUCT_LIMITS.productsPerKind} ${draft.productKind} products`,
		);
	}

	const now = Date.now();
	validateCatalogTimestamp(now, "Catalog product created timestamp");
	const actor = identity.tokenIdentifier;
	const productId = await ctx.db.insert("catalogProducts", {
		siteUrl: client.siteUrl,
		productKey: args.productKey,
		productKind: draft.productKind,
		graphVersion: 2,
		slug,
		createdAt: now,
		createdBy: actor,
		updatedAt: now,
		updatedBy: actor,
	});
	const productValue = await ctx.db.get(productId);
	if (!productValue) throw new Error("Catalog product creation failed");
	const product = requireCatalogProductGraphV2Product(productValue);
	const inserted = await insertCatalogProductGraphV2Revision(ctx, {
		product,
		draft,
		source: "admin",
		createdAt: now,
		createdBy: actor,
	});
	if (inserted.checksum !== checksum) {
		throw new Error("Catalog V2 normalized checksum changed during insertion");
	}
	await ctx.db.patch(product._id, { draftRevisionId: inserted.revisionId });
	return { productId: product._id, revisionId: inserted.revisionId };
}

/** Save a replacement V2 draft while retaining every historical graph. */
export async function saveCatalogProductGraphV2Draft(
	ctx: MutationCtx,
	args: {
		productId: Id<"catalogProducts">;
		expectedDraftRevisionId?: Id<"catalogProductRevisions">;
		draft: CatalogProductGraphV2Draft;
	},
) {
	const product = requireCatalogProductGraphV2Product(
		await requireDocumentSiteAdmin(ctx, "catalogProducts", args.productId),
	);
	validateCatalogProductGraphV2Draft(args.draft);
	if (product.productKind !== args.draft.productKind) {
		throw new Error("Catalog V2 draft product kind does not match its product");
	}
	const draft = await normalizeCatalogProductGraphV2DraftAssets(
		ctx,
		product.siteUrl,
		args.draft,
	);
	const checksum = await checksumCatalogProductGraphV2Draft(draft);
	const [active, published] = await Promise.all([
		loadCatalogProductGraphV2Revision(ctx, product, product.draftRevisionId),
		loadCatalogProductGraphV2RevisionSummary(
			ctx,
			product,
			product.publishedRevisionId,
		),
	]);
	assertCatalogGraphV2ProductLifecycle(product, active?.revision ?? null, published);
	if (active?.revision.checksum === checksum) {
		return { productId: product._id, revisionId: active.revision._id };
	}
	assertExpectedCatalogGraphV2Draft(product, args.expectedDraftRevisionId);

	const slug = canonicalCatalogSlug(draft.slug);
	if (product.publishedRevisionId && product.slug !== slug) {
		throw new Error("Published product slug changes require redirect support");
	}
	await requireAvailableSlug(ctx, product.siteUrl, slug, product._id);
	const identity = await requireAuth(ctx);
	const now = Date.now();
	validateCatalogTimestamp(now, "Catalog product updated timestamp");
	if (now < product.updatedAt) {
		throw new Error("Catalog product updated timestamp cannot move backwards");
	}
	const inserted = await insertCatalogProductGraphV2Revision(ctx, {
		product,
		draft,
		source: "admin",
		createdAt: now,
		createdBy: identity.tokenIdentifier,
	});
	if (inserted.checksum !== checksum) {
		throw new Error("Catalog V2 normalized checksum changed during insertion");
	}
	await ctx.db.patch(product._id, {
		slug,
		draftRevisionId: inserted.revisionId,
		updatedAt: now,
		updatedBy: identity.tokenIdentifier,
	});
	return { productId: product._id, revisionId: inserted.revisionId };
}

/** Clear only the active pointer; immutable V2 product history is retained. */
export async function discardCatalogProductGraphV2Draft(
	ctx: MutationCtx,
	args: {
		productId: Id<"catalogProducts">;
		draftRevisionId: Id<"catalogProductRevisions">;
	},
) {
	const product = requireCatalogProductGraphV2Product(
		await requireDocumentSiteAdmin(ctx, "catalogProducts", args.productId),
	);
	await loadCatalogGraphV2RevisionSummaries(ctx, product);
	if (product.draftRevisionId === args.draftRevisionId) {
		await loadCatalogProductGraphV2Revision(ctx, product, args.draftRevisionId);
		const identity = await requireAuth(ctx);
		const now = Date.now();
		validateCatalogTimestamp(now, "Catalog product updated timestamp");
		if (now < product.updatedAt) {
			throw new Error("Catalog product updated timestamp cannot move backwards");
		}
		await ctx.db.patch(product._id, {
			draftRevisionId: undefined,
			...(product.publishedRevisionId ? {} : { slug: undefined }),
			updatedAt: now,
			updatedBy: identity.tokenIdentifier,
		});
		return { productId: product._id, draftRevisionId: null };
	}
	if (!product.draftRevisionId) {
		await requireOwnedCatalogGraphV2RevisionForDiscardReplay(
			ctx,
			product,
			args.draftRevisionId,
		);
		return { productId: product._id, draftRevisionId: null };
	}
	throw new Error("Catalog draft conflict: reload before discarding");
}

/** Authenticated Editor-only detail read with no storage keys or capabilities. */
export async function getCatalogProductGraphV2EditorState(
	ctx: QueryCtx,
	productId: Id<"catalogProducts">,
) {
	const product = requireCatalogProductGraphV2Product(
		await requireDocumentSiteAdmin(ctx, "catalogProducts", productId),
	);
	const [draft, published] = await Promise.all([
		loadCatalogProductGraphV2Revision(ctx, product, product.draftRevisionId),
		loadCatalogProductGraphV2Revision(ctx, product, product.publishedRevisionId),
	]);
	assertCatalogGraphV2ProductLifecycle(
		product,
		draft?.revision ?? null,
		published?.revision ?? null,
	);
	return {
		productId: product._id,
		productKey: product.productKey,
		productKind: product.productKind,
		graphVersion: 2 as const,
		slug: product.slug ?? null,
		draft: projectCatalogProductGraphV2ForEditor(draft),
		published: projectCatalogProductGraphV2ForEditor(published),
		createdAt: product.createdAt,
		updatedAt: product.updatedAt,
		publishedAt: product.publishedAt ?? null,
	};
}

/** Bounded V2 headers for one authenticated tenant and product kind. */
export async function listCatalogProductGraphsV2ForEditor(
	ctx: QueryCtx,
	siteUrl: string,
	productKind: CatalogProductKind,
) {
	const { client } = await requireSiteAdmin(ctx, siteUrl);
	const products = await ctx.db
		.query("catalogProducts")
		.withIndex("by_siteUrl_and_graphVersion_and_productKind_and_createdAt", (query) =>
			query
				.eq("siteUrl", client.siteUrl)
				.eq("graphVersion", 2)
				.eq("productKind", productKind),
		)
		.order("desc")
		.take(CATALOG_PRODUCT_LIMITS.productsPerKind + 1);
	if (products.length > CATALOG_PRODUCT_LIMITS.productsPerKind) {
		throw new Error(`Catalog ${productKind} product limit exceeded`);
	}

	const productKeys = new Set<string>();
	const slugs = new Set<string>();
	const validatedProducts = products.map((value) => {
		const product = requireCatalogProductGraphV2Product(value);
		if (product.productKind !== productKind) {
			throw new Error("Catalog V2 product kind index mismatch");
		}
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
		return product;
	});

	// Exact tenant-wide key and slug indexes are not unique constraints. Prove
	// ownership in bounded batches so cross-kind or V1/V2 corruption fails closed
	// without exceeding Convex's concurrent-I/O ceiling at the 500-row boundary.
	await mapCatalogGraphListInBatches(
		validatedProducts,
		async (product) => await proveTenantWideCatalogIdentity(ctx, product),
	);

	return await mapCatalogGraphListInBatches(validatedProducts, async (product) => {
		const { draft, published } = await loadCatalogGraphV2RevisionSummaries(
			ctx,
			product,
		);
		return {
			productId: product._id,
			productKey: product.productKey,
			productKind: product.productKind,
			graphVersion: 2 as const,
			slug: product.slug ?? null,
			draft,
			published,
			createdAt: product.createdAt,
			updatedAt: product.updatedAt,
			publishedAt: product.publishedAt ?? null,
		};
	});
}
