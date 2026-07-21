import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
	requireAuth,
	requireDocumentSiteAdminWithClient,
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
import { requireCatalogProductKindEnabled } from "./catalogProductPolicy";
import {
	assertSanityCatalogV2GraphPlan,
	type SanityCatalogV2GraphPlan,
} from "./sanityCatalogGraphPlan";

type CatalogContext = QueryCtx | MutationCtx;
type CatalogProduct = Doc<"catalogProducts">;
type CatalogGraphV2Product = CatalogProduct & { graphVersion: 2 };
type CatalogRevisionState = { createdAt: number } | null;
const CATALOG_GRAPH_LIST_PROOF_BATCH = 50;
const CATALOG_GRAPH_RETIREMENT_REVISION_SCAN_LIMIT = 100;
const CATALOG_GRAPH_ASSET_REFERENCE_SCAN_LIMIT = 100;
const SANITY_CATALOG_IMPORT_KINDS = [
	"print",
	"print_set",
	"postcard",
	"tapestry",
	"digital_download",
	"merchandise",
] as const satisfies readonly CatalogProductKind[];

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

async function listExistingCatalogGraphV2Products(ctx: CatalogContext, siteUrl: string) {
	const products = [] as CatalogGraphV2Product[];
	for (const productKind of SANITY_CATALOG_IMPORT_KINDS) {
		const rows = await ctx.db
			.query("catalogProducts")
			.withIndex("by_siteUrl_and_graphVersion_and_productKind_and_createdAt", (query) =>
				query
					.eq("siteUrl", siteUrl)
					.eq("graphVersion", 2)
					.eq("productKind", productKind),
			)
			.take(CATALOG_PRODUCT_LIMITS.productsPerKind + 1);
		if (rows.length > CATALOG_PRODUCT_LIMITS.productsPerKind) {
			throw new Error(`Catalog ${productKind} product limit exceeded`);
		}
		products.push(...rows.map(requireCatalogProductGraphV2Product));
	}
	return products;
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

function uniqueRevisionIds(product: CatalogGraphV2Product) {
	return [
		...new Set(
			[product.draftRevisionId, product.publishedRevisionId].filter(
				(revisionId): revisionId is Id<"catalogProductRevisions"> =>
					revisionId !== undefined,
			),
		),
	];
}

async function isActiveCatalogGraphRevisionReference(
	ctx: QueryCtx,
	siteUrl: string,
	productId: Id<"catalogProducts">,
	revisionId: Id<"catalogProductRevisions">,
) {
	const productValue = await ctx.db.get(productId);
	if (!productValue || productValue.siteUrl !== siteUrl) return false;
	const product = requireCatalogProductGraphV2Product(productValue);
	return product.draftRevisionId === revisionId || product.publishedRevisionId === revisionId;
}

async function projectCatalogGraphAssetEligibility(
	ctx: QueryCtx,
	args: {
		siteUrl: string;
		assetId: Id<"mediaAssets"> | Id<"catalogPrintSourceAssets"> | Id<"catalogDigitalFileAssets">;
		assetKind: "webMedia" | "printSource" | "digitalFile";
		referenceTable:
			| "catalogProductMediaPlacements"
			| "catalogProductPrintSources"
			| "catalogProductDigitalFiles";
	},
) {
	const references = await ctx.db
		.query(args.referenceTable)
		.withIndex("by_siteUrl_and_assetId", (query) =>
			query.eq("siteUrl", args.siteUrl).eq("assetId", args.assetId),
		)
		.take(CATALOG_GRAPH_ASSET_REFERENCE_SCAN_LIMIT + 1);
	if (references.length > CATALOG_GRAPH_ASSET_REFERENCE_SCAN_LIMIT) {
		throw new Error("Catalog asset reference usage cannot be verified safely");
	}
	let activeReferenceCount = 0;
	for (const reference of references) {
		if (await isActiveCatalogGraphRevisionReference(
			ctx,
			args.siteUrl,
			reference.productId,
			reference.revisionId,
		)) {
			activeReferenceCount += 1;
		}
	}
	return {
		assetId: args.assetId,
		assetKind: args.assetKind,
		referenceCount: references.length,
		activeReferenceCount,
		retainedReferenceCount: references.length - activeReferenceCount,
		eligibleForExternalCleanup: activeReferenceCount === 0,
		externalObjectsWillBeDeleted: false,
	};
}

async function listCatalogGraphMediaRowsForRevisions(
	ctx: QueryCtx,
	productId: Id<"catalogProducts">,
	revisionIds: readonly Id<"catalogProductRevisions">[],
) {
	const rows = [];
	for (const revisionId of revisionIds) {
		rows.push(...await ctx.db
			.query("catalogProductMediaPlacements")
			.withIndex("by_productId_and_revisionId", (query) =>
				query.eq("productId", productId).eq("revisionId", revisionId),
			)
			.take(CATALOG_PRODUCT_LIMITS.variantsPerRevision + 1));
	}
	return rows;
}

async function listCatalogGraphPrintSourceRowsForRevisions(
	ctx: QueryCtx,
	productId: Id<"catalogProducts">,
	revisionIds: readonly Id<"catalogProductRevisions">[],
) {
	const rows = [];
	for (const revisionId of revisionIds) {
		rows.push(...await ctx.db
			.query("catalogProductPrintSources")
			.withIndex("by_productId_and_revisionId", (query) =>
				query.eq("productId", productId).eq("revisionId", revisionId),
			)
			.take(CATALOG_PRODUCT_LIMITS.variantsPerRevision + 1));
	}
	return rows;
}

async function listCatalogGraphDigitalFileRowsForRevisions(
	ctx: QueryCtx,
	productId: Id<"catalogProducts">,
	revisionIds: readonly Id<"catalogProductRevisions">[],
) {
	const rows = [];
	for (const revisionId of revisionIds) {
		rows.push(...await ctx.db
			.query("catalogProductDigitalFiles")
			.withIndex("by_productId_and_revisionId", (query) =>
				query.eq("productId", productId).eq("revisionId", revisionId),
			)
			.take(CATALOG_PRODUCT_LIMITS.variantsPerRevision + 1));
	}
	return rows;
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
	requireCatalogProductKindEnabled(client, draft.productKind);
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

async function verifySanityImportedCatalogProduct(
	ctx: MutationCtx,
	product: CatalogGraphV2Product,
	planned: SanityCatalogV2GraphPlan["products"][number],
) {
	if (product.productKind !== planned.draft.productKind) {
		throw new Error(`Catalog product key "${planned.productKey}" already exists`);
	}
	if (product.publishedRevisionId !== undefined) {
		throw new Error("Sanity catalog import can only replay unpublished products");
	}
	const draft = await loadCatalogProductGraphV2Revision(ctx, product, product.draftRevisionId);
	if (!draft) throw new Error("Sanity catalog imported product has no draft revision");
	if (draft.revision.source !== "sanityImport") {
		throw new Error("Existing catalog draft was not created by Sanity import");
	}
	if (draft.revision.checksum !== planned.graphChecksum) {
		throw new Error("Existing Sanity catalog draft does not match the graph plan");
	}
	return {
		productKey: planned.productKey,
		productId: product._id,
		revisionId: draft.revision._id,
		graphChecksum: planned.graphChecksum,
	};
}

/** Import one complete Sanity catalog V2 graph as unpublished private drafts. */
export async function importSanityCatalogGraphV2Drafts(
	ctx: MutationCtx,
	args: {
		siteUrl: string;
		plan: SanityCatalogV2GraphPlan;
	},
) {
	const { identity, client } = await requireSiteAdmin(ctx, args.siteUrl);
	const plan = await assertSanityCatalogV2GraphPlan(args.plan);
	const plannedProducts = [...plan.products].sort((left, right) =>
		left.productKey.localeCompare(right.productKey)
	);
	if (plannedProducts.length === 0) throw new Error("Sanity catalog import plan is empty");
	for (const planned of plannedProducts) {
		requireCatalogProductKindEnabled(client, planned.draft.productKind);
	}

	const existingProducts = await listExistingCatalogGraphV2Products(ctx, client.siteUrl);
	const existingByKey = new Map(existingProducts.map((product) => [product.productKey, product]));
	const planKeys = new Set(plannedProducts.map((product) => product.productKey));
	const unexpectedExisting = existingProducts.filter((product) => !planKeys.has(product.productKey));
	if (unexpectedExisting.length > 0) {
		throw new Error("Sanity catalog import requires an empty or exact-replay V2 catalog");
	}
	const existingPlanned = plannedProducts.filter((product) =>
		existingByKey.has(product.productKey)
	);
	if (existingPlanned.length > 0 && existingPlanned.length !== plannedProducts.length) {
		throw new Error("Partial Sanity catalog import state is not replayable");
	}
	if (existingPlanned.length === plannedProducts.length) {
		const products = [];
		for (const planned of plannedProducts) {
			const product = existingByKey.get(planned.productKey);
			if (!product) throw new Error("Sanity catalog replay lost a planned product");
			products.push(await verifySanityImportedCatalogProduct(ctx, product, planned));
		}
		return {
			status: "replayed" as const,
			graphPlanChecksum: plan.graphPlanChecksum,
			productCount: products.length,
			products,
		};
	}

	const now = Date.now();
	validateCatalogTimestamp(now, "Sanity catalog import timestamp");
	const actor = identity.tokenIdentifier;
	const products = [];
	for (const planned of plannedProducts) {
		validateCatalogProductKey(planned.productKey);
		validateCatalogProductGraphV2Draft(planned.draft);
		const draft = await normalizeCatalogProductGraphV2DraftAssets(
			ctx,
			client.siteUrl,
			planned.draft,
		);
		const checksum = await checksumCatalogProductGraphV2Draft(draft);
		if (checksum !== planned.graphChecksum) {
			throw new Error(`Sanity catalog graph checksum changed for ${planned.productKey}`);
		}
		const slug = canonicalCatalogSlug(draft.slug);
		await requireAvailableSlug(ctx, client.siteUrl, slug);
		const productId = await ctx.db.insert("catalogProducts", {
			siteUrl: client.siteUrl,
			productKey: planned.productKey,
			productKind: draft.productKind,
			graphVersion: 2,
			slug,
			createdAt: now,
			createdBy: actor,
			updatedAt: now,
			updatedBy: actor,
		});
		const productValue = await ctx.db.get(productId);
		if (!productValue) throw new Error("Sanity catalog product creation failed");
		const product = requireCatalogProductGraphV2Product(productValue);
		const inserted = await insertCatalogProductGraphV2Revision(ctx, {
			product,
			draft,
			source: "sanityImport",
			createdAt: now,
			createdBy: actor,
		});
		if (inserted.checksum !== planned.graphChecksum) {
			throw new Error(`Sanity catalog inserted checksum changed for ${planned.productKey}`);
		}
		await ctx.db.patch(product._id, { draftRevisionId: inserted.revisionId });
		products.push({
			productKey: planned.productKey,
			productId: product._id,
			revisionId: inserted.revisionId,
			graphChecksum: planned.graphChecksum,
		});
	}
	return {
		status: "imported" as const,
		graphPlanChecksum: plan.graphPlanChecksum,
		productCount: products.length,
		products,
	};
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
	const { doc, client } = await requireDocumentSiteAdminWithClient(
		ctx,
		"catalogProducts",
		args.productId,
	);
	const product = requireCatalogProductGraphV2Product(doc);
	requireCatalogProductKindEnabled(client, product.productKind);
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
	const { doc, client } = await requireDocumentSiteAdminWithClient(
		ctx,
		"catalogProducts",
		args.productId,
	);
	const product = requireCatalogProductGraphV2Product(doc);
	requireCatalogProductKindEnabled(client, product.productKind);
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
	const { doc, client } = await requireDocumentSiteAdminWithClient(
		ctx,
		"catalogProducts",
		productId,
	);
	const product = requireCatalogProductGraphV2Product(doc);
	requireCatalogProductKindEnabled(client, product.productKind);
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

/** Read-only retirement proof for immutable graph rows and referenced assets. */
export async function getCatalogProductGraphV2RetirementEligibility(
	ctx: QueryCtx,
	productId: Id<"catalogProducts">,
) {
	const { doc, client } = await requireDocumentSiteAdminWithClient(
		ctx,
		"catalogProducts",
		productId,
	);
	const product = requireCatalogProductGraphV2Product(doc);
	requireCatalogProductKindEnabled(client, product.productKind);
	const revisions = await ctx.db
		.query("catalogProductRevisions")
		.withIndex("by_siteUrl_and_productId", (query) =>
			query.eq("siteUrl", product.siteUrl).eq("productId", product._id),
		)
		.take(CATALOG_GRAPH_RETIREMENT_REVISION_SCAN_LIMIT + 1);
	if (revisions.length > CATALOG_GRAPH_RETIREMENT_REVISION_SCAN_LIMIT) {
		throw new Error("Catalog graph revision history cannot be verified safely");
	}
	const activeRevisionIds = uniqueRevisionIds(product);
	const activeRevisionIdSet = new Set(activeRevisionIds);
	const retainedRevisionIds = revisions
		.map((revision) => revision._id)
		.filter((revisionId) => !activeRevisionIdSet.has(revisionId));
	const referencedRevisionIds = revisions.map((revision) => revision._id);
	const [webRows, printRows, digitalRows] = await Promise.all([
		listCatalogGraphMediaRowsForRevisions(
			ctx,
			product._id,
			referencedRevisionIds,
		),
		listCatalogGraphPrintSourceRowsForRevisions(
			ctx,
			product._id,
			referencedRevisionIds,
		),
		listCatalogGraphDigitalFileRowsForRevisions(
			ctx,
			product._id,
			referencedRevisionIds,
		),
	]);
	const webAssetIds = [...new Set(webRows.map((row) => row.assetId))];
	const printSourceAssetIds = [...new Set(printRows.map((row) => row.assetId))];
	const digitalFileAssetIds = [...new Set(digitalRows.map((row) => row.assetId))];

	return {
		productId: product._id,
		productKey: product.productKey,
		productKind: product.productKind,
		graphVersion: 2 as const,
		retired: activeRevisionIds.length === 0,
		activeRevisionIds,
		retainedRevisionIds,
		revisionCount: revisions.length,
		databaseRowsWillBeDeleted: false,
		externalObjectsWillBeDeleted: false,
		webMedia: await Promise.all(webAssetIds.map(async (assetId) =>
			await projectCatalogGraphAssetEligibility(ctx, {
				siteUrl: product.siteUrl,
				assetId,
				assetKind: "webMedia",
				referenceTable: "catalogProductMediaPlacements",
			})
		)),
		printSources: await Promise.all(printSourceAssetIds.map(async (assetId) =>
			await projectCatalogGraphAssetEligibility(ctx, {
				siteUrl: product.siteUrl,
				assetId,
				assetKind: "printSource",
				referenceTable: "catalogProductPrintSources",
			})
		)),
		digitalFiles: await Promise.all(digitalFileAssetIds.map(async (assetId) =>
			await projectCatalogGraphAssetEligibility(ctx, {
				siteUrl: product.siteUrl,
				assetId,
				assetKind: "digitalFile",
				referenceTable: "catalogProductDigitalFiles",
			})
		)),
	};
}

/** Bounded V2 headers for one authenticated tenant and product kind. */
export async function listCatalogProductGraphsV2ForEditor(
	ctx: QueryCtx,
	siteUrl: string,
	productKind: CatalogProductKind,
) {
	const { client } = await requireSiteAdmin(ctx, siteUrl);
	requireCatalogProductKindEnabled(client, productKind);
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
