import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
	prepareCatalogProductGraphV2Draft,
} from "./catalogProductGraphAssets";
import {
	CATALOG_PRODUCT_GRAPH_V2_WEB_MEDIA_ROLES as WEB_MEDIA_ROLES,
	canonicalizeCatalogProductGraphV2WebMedia as canonicalWebMedia,
	checksumCatalogProductGraphV2Draft,
} from "./catalogProductGraphChecksum";
import {
	CATALOG_PRODUCT_GRAPH_V2_LIMITS,
	type CatalogProductGraphV2Draft,
	validateCatalogProductGraphV2Draft,
} from "./catalogProductGraphValidators";
import {
	validateCatalogProductSlug,
	validateCatalogTimestamp,
} from "./catalogProductValidators";

export {
	normalizeCatalogProductGraphV2DraftAssets,
	projectCatalogProductGraphV2ForEditor,
} from "./catalogProductGraphAssets";
export {
	CATALOG_PRODUCT_GRAPH_V2_CHECKSUM_PREFIX,
	checksumCatalogProductGraphV2Draft,
	serializeCatalogProductGraphV2Draft,
} from "./catalogProductGraphChecksum";

type CatalogGraphContext = QueryCtx | MutationCtx;
type CatalogProduct = Doc<"catalogProducts">;
type CatalogRevision = Doc<"catalogProductRevisions">;
type CatalogRevisionV2 = Extract<CatalogRevision, { schemaVersion: 2 }>;
type CatalogGraphV2Product = CatalogProduct & { graphVersion: 2 };
type CatalogRevisionSource = "admin" | "sanityImport" | "restore";

export function requireCatalogProductGraphV2Product(
	product: CatalogProduct,
): CatalogGraphV2Product {
	if (product.graphVersion !== 2) {
		throw new Error("Catalog product is not a V2 graph product");
	}
	return product as CatalogGraphV2Product;
}

function assertCatalogProductGraphV2RevisionOwnership(
	revision: CatalogRevision,
	product: CatalogGraphV2Product,
): asserts revision is CatalogRevisionV2 {
	if (
		revision.schemaVersion !== 2
		|| revision.productId !== product._id
		|| revision.siteUrl !== product.siteUrl
		|| revision.productKind !== product.productKind
	) throw new Error("Catalog V2 revision ownership mismatch");
}

function assertBoundedRevisionCount(
	value: number,
	minimum: number,
	maximum: number,
	label: string,
) {
	if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
		throw new Error(`${label} count is outside the V2 graph contract`);
	}
}

function assertOptionalRevisionTitle(title: string | undefined) {
	if (
		title !== undefined
		&& (!title
			|| title !== title.trim()
			|| title.length > CATALOG_PRODUCT_GRAPH_V2_LIMITS.title)
	) {
		throw new Error(
			`Catalog V2 revision title must be trimmed and ${CATALOG_PRODUCT_GRAPH_V2_LIMITS.title} characters or fewer`,
		);
	}
}

function assertCatalogProductGraphV2RevisionSummary(
	revision: CatalogRevisionV2,
	product: CatalogGraphV2Product,
) {
	assertCatalogProductGraphV2RevisionOwnership(revision, product);
	assertOptionalRevisionTitle(revision.title);
	validateCatalogProductSlug(revision.slug);
	if (revision.slug !== product.slug) {
		throw new Error("Catalog V2 revision slug ownership mismatch");
	}
	validateCatalogTimestamp(revision.createdAt, "Catalog V2 revision created timestamp");
	assertBoundedRevisionCount(
		revision.variantCount,
		1,
		CATALOG_PRODUCT_GRAPH_V2_LIMITS.variantsPerRevision,
		"Catalog V2 variant",
	);
	assertBoundedRevisionCount(
		revision.webMediaCount,
		0,
		CATALOG_PRODUCT_GRAPH_V2_LIMITS.webMediaPlacements,
		"Catalog V2 web-media",
	);
	const maximumPrintSources = revision.productKind === "print"
		? 1
		: revision.productKind === "print_set"
		? CATALOG_PRODUCT_GRAPH_V2_LIMITS.printSources
		: 0;
	assertBoundedRevisionCount(
		revision.printSourceCount,
		0,
		maximumPrintSources,
		"Catalog V2 print-source",
	);
	assertBoundedRevisionCount(
		revision.setMemberCount,
		0,
		revision.productKind === "print_set"
			? CATALOG_PRODUCT_GRAPH_V2_LIMITS.printSetMembers
			: 0,
		"Catalog V2 print-set member",
	);
	if (
		revision.productKind === "print_set"
		&& revision.printSourceCount !== revision.setMemberCount
	) throw new Error("Catalog V2 print-set relation counts do not form an exact graph");
	assertBoundedRevisionCount(
		revision.digitalFileCount,
		0,
		revision.productKind === "digital_download" ? 1 : 0,
		"Catalog V2 paid-file",
	);
	if (revision.shopPlacementCount !== 1) {
		throw new Error("Catalog V2 requires exactly one shop placement");
	}
	const totalChildRows = revision.variantCount
		+ revision.webMediaCount
		+ revision.printSourceCount
		+ revision.setMemberCount
		+ revision.digitalFileCount
		+ revision.shopPlacementCount;
	if (totalChildRows > CATALOG_PRODUCT_GRAPH_V2_LIMITS.totalChildRows) {
		throw new Error("Catalog V2 graph exceeds the bounded child-row budget");
	}
}

function graphCounts(draft: CatalogProductGraphV2Draft) {
	return {
		variantCount: draft.variants.length,
		webMediaCount: draft.webMedia.length,
		printSourceCount:
			draft.productKind === "print" || draft.productKind === "print_set"
				? draft.printSources.length
				: 0,
		setMemberCount: draft.productKind === "print_set"
			? draft.setMembers.length
			: 0,
		digitalFileCount:
			draft.productKind === "digital_download" && draft.paidFile ? 1 : 0,
		shopPlacementCount: 1,
	};
}

/**
 * Insert one complete immutable V2 revision. Every referenced asset is checked
 * before the first write in the transaction.
 */
export async function insertCatalogProductGraphV2Revision(
	ctx: MutationCtx,
	args: {
		product: CatalogProduct;
		draft: CatalogProductGraphV2Draft;
		source: CatalogRevisionSource;
		createdAt: number;
		createdBy: string;
	},
) {
	const product = requireCatalogProductGraphV2Product(args.product);
	if (product.productKind !== args.draft.productKind) {
		throw new Error("Catalog V2 draft product kind does not match its product");
	}
	const prepared = await prepareCatalogProductGraphV2Draft(
		ctx,
		product.siteUrl,
		args.draft,
	);
	const { draft } = prepared;
	const checksum = await checksumCatalogProductGraphV2Draft(draft);
	const counts = graphCounts(draft);
	const commonRevision = {
		siteUrl: product.siteUrl,
		productId: product._id,
		schemaVersion: 2 as const,
		title: draft.title,
		slug: draft.slug,
		description: draft.description,
		seoDescription: draft.seoDescription,
		currency: "usd" as const,
		saleAvailability: draft.saleAvailability,
		...counts,
		checksum,
		source: args.source,
		createdAt: args.createdAt,
		createdBy: args.createdBy,
	};

	let revisionId: Id<"catalogProductRevisions">;
	if (draft.productKind === "print" || draft.productKind === "print_set") {
		revisionId = await ctx.db.insert("catalogProductRevisions", {
			...commonRevision,
			productKind: draft.productKind,
			fulfillmentMode: draft.fulfillmentMode,
			printOptions: draft.printOptions,
		});
	} else if (draft.productKind === "digital_download") {
		revisionId = await ctx.db.insert("catalogProductRevisions", {
			...commonRevision,
			productKind: "digital_download",
			fulfillmentMode: "digital_delivery",
		});
	} else {
		revisionId = await ctx.db.insert("catalogProductRevisions", {
			...commonRevision,
			productKind: draft.productKind,
			fulfillmentMode: "merchant_fulfilled",
		});
	}

	for (const variant of draft.variants) {
		await ctx.db.insert("catalogProductVariants", {
			siteUrl: product.siteUrl,
			productId: product._id,
			revisionId,
			variantKey: variant.key,
			order: variant.order,
			materialOptionKey: variant.materialOptionKey,
			sizeOptionKey: variant.sizeOptionKey,
			retailPriceCents: variant.retailPriceCents,
			status: variant.status,
		});
	}
	for (const [index, placement] of draft.webMedia.entries()) {
		const asset = prepared.webMediaAssets[index]?.asset;
		if (!asset || prepared.webMediaAssets[index]?.placementKey !== placement.key) {
			throw new Error("Catalog web-media preparation mismatch");
		}
		await ctx.db.insert("catalogProductMediaPlacements", {
			siteUrl: product.siteUrl,
			productId: product._id,
			revisionId,
			assetId: asset._id,
			placementKey: placement.key,
			role: placement.role,
			order: placement.order,
			altText: placement.altText,
		});
	}
	if (draft.productKind === "print" || draft.productKind === "print_set") {
		for (const [index, source] of draft.printSources.entries()) {
			const asset = prepared.printSourceAssets[index]?.asset;
			if (!asset || prepared.printSourceAssets[index]?.relationKey !== source.key) {
				throw new Error("Catalog print-source preparation mismatch");
			}
			await ctx.db.insert("catalogProductPrintSources", {
				siteUrl: product.siteUrl,
				productId: product._id,
				revisionId,
				assetId: asset._id,
				relationKey: source.key,
				order: source.order,
			});
		}
	}
	if (draft.productKind === "print_set") {
		for (const member of draft.setMembers) {
			await ctx.db.insert("catalogProductSetMembers", {
				siteUrl: product.siteUrl,
				productId: product._id,
				revisionId,
				memberKey: member.key,
				order: member.order,
				mediaPlacementKey: member.mediaPlacementKey,
				printSourceKey: member.printSourceKey,
			});
		}
	}
	if (draft.productKind === "digital_download" && draft.paidFile) {
		const asset = prepared.paidFileAsset?.asset;
		if (!asset || prepared.paidFileAsset?.relationKey !== draft.paidFile.key) {
			throw new Error("Catalog paid-file preparation mismatch");
		}
		await ctx.db.insert("catalogProductDigitalFiles", {
			siteUrl: product.siteUrl,
			productId: product._id,
			revisionId,
			assetId: asset._id,
			relationKey: draft.paidFile.key,
			version: draft.paidFile.version,
		});
	}
	await ctx.db.insert("catalogProductShopPlacements", {
		siteUrl: product.siteUrl,
		productId: product._id,
		revisionId,
		featured: draft.shopPlacement.featured,
		orderRank: draft.shopPlacement.orderRank,
	});
	return { revisionId, checksum, draft };
}

function assertRowsOwned(
	rows: Array<{
		siteUrl: string;
		productId: Id<"catalogProducts">;
		revisionId: Id<"catalogProductRevisions">;
	}>,
	product: CatalogGraphV2Product,
	revision: CatalogRevisionV2,
	label: string,
) {
	if (rows.some((row) =>
		row.siteUrl !== product.siteUrl
		|| row.productId !== product._id
		|| row.revisionId !== revision._id
	)) throw new Error(`${label} ownership mismatch`);
}

function assertExactCount(
	actual: number,
	expected: number,
	maximum: number,
	label: string,
) {
	if (
		!Number.isSafeInteger(expected)
		|| expected < 0
		|| expected > maximum
		|| actual !== expected
	) throw new Error(`${label} count mismatch`);
}

async function getGraphVariants(
	ctx: CatalogGraphContext,
	revisionId: Id<"catalogProductRevisions">,
) {
	return await ctx.db
		.query("catalogProductVariants")
		.withIndex("by_revisionId_and_order", (query) =>
			query.eq("revisionId", revisionId),
		)
		.take(CATALOG_PRODUCT_GRAPH_V2_LIMITS.variantsPerRevision + 1);
}

async function getGraphWebMedia(
	ctx: CatalogGraphContext,
	revisionId: Id<"catalogProductRevisions">,
) {
	const byRole = await Promise.all(WEB_MEDIA_ROLES.map(async (role) =>
		await ctx.db
			.query("catalogProductMediaPlacements")
			.withIndex("by_revisionId_and_role_and_order", (query) =>
				query.eq("revisionId", revisionId).eq("role", role),
			)
			.take(CATALOG_PRODUCT_GRAPH_V2_LIMITS.webMediaPlacements + 1)
	));
	if (byRole.some((rows) =>
		rows.length > CATALOG_PRODUCT_GRAPH_V2_LIMITS.webMediaPlacements
	)) throw new Error("Catalog V2 web-media placement limit exceeded");
	const rows = byRole.flat();
	if (rows.length > CATALOG_PRODUCT_GRAPH_V2_LIMITS.webMediaPlacements) {
		throw new Error("Catalog V2 web-media placement limit exceeded");
	}
	return rows;
}

async function getGraphPrintSources(
	ctx: CatalogGraphContext,
	revisionId: Id<"catalogProductRevisions">,
) {
	return await ctx.db
		.query("catalogProductPrintSources")
		.withIndex("by_revisionId_and_order", (query) =>
			query.eq("revisionId", revisionId),
		)
		.take(CATALOG_PRODUCT_GRAPH_V2_LIMITS.printSources + 1);
}

async function getGraphSetMembers(
	ctx: CatalogGraphContext,
	revisionId: Id<"catalogProductRevisions">,
) {
	return await ctx.db
		.query("catalogProductSetMembers")
		.withIndex("by_revisionId_and_order", (query) =>
			query.eq("revisionId", revisionId),
		)
		.take(CATALOG_PRODUCT_GRAPH_V2_LIMITS.printSetMembers + 1);
}

async function loadCatalogProductGraphV2Rows(
	ctx: CatalogGraphContext,
	revisionId: Id<"catalogProductRevisions">,
) {
	const [variants, webMedia, printSources, setMembers, digitalFiles, shopPlacements] =
		await Promise.all([
			getGraphVariants(ctx, revisionId),
			getGraphWebMedia(ctx, revisionId),
			getGraphPrintSources(ctx, revisionId),
			getGraphSetMembers(ctx, revisionId),
			ctx.db
				.query("catalogProductDigitalFiles")
				.withIndex("by_revisionId", (query) => query.eq("revisionId", revisionId))
				.take(2),
			ctx.db
				.query("catalogProductShopPlacements")
				.withIndex("by_revisionId", (query) => query.eq("revisionId", revisionId))
				.take(2),
		]);
	return { variants, webMedia, printSources, setMembers, digitalFiles, shopPlacements };
}

function draftFromStoredGraph(
	revision: CatalogRevisionV2,
	rows: Awaited<ReturnType<typeof loadCatalogProductGraphV2Rows>>,
): CatalogProductGraphV2Draft {
	const shopPlacement = rows.shopPlacements[0];
	if (!shopPlacement) throw new Error("Catalog V2 shop placement is missing");
	const common = {
		schemaVersion: 2 as const,
		title: revision.title,
		slug: revision.slug,
		description: revision.description,
		seoDescription: revision.seoDescription,
		currency: "usd" as const,
		saleAvailability: revision.saleAvailability,
		shopPlacement: {
			featured: shopPlacement.featured,
			orderRank: shopPlacement.orderRank,
		},
		variants: rows.variants.map((variant) => ({
			key: variant.variantKey,
			order: variant.order,
			materialOptionKey: variant.materialOptionKey,
			sizeOptionKey: variant.sizeOptionKey,
			retailPriceCents: variant.retailPriceCents,
			status: variant.status,
		})),
		webMedia: canonicalWebMedia(rows.webMedia.map((placement) => ({
			key: placement.placementKey,
			order: placement.order,
			role: placement.role,
			assetId: placement.assetId,
			altText: placement.altText,
		}))),
	};

	if (revision.productKind === "print") {
		return {
			...common,
			productKind: "print",
			fulfillmentMode: revision.fulfillmentMode,
			printOptions: revision.printOptions,
			printSources: rows.printSources.map((source) => ({
				key: source.relationKey,
				order: source.order,
				assetId: source.assetId,
			})),
		};
	}
	if (revision.productKind === "print_set") {
		return {
			...common,
			productKind: "print_set",
			fulfillmentMode: revision.fulfillmentMode,
			printOptions: revision.printOptions,
			printSources: rows.printSources.map((source) => ({
				key: source.relationKey,
				order: source.order,
				assetId: source.assetId,
			})),
			setMembers: rows.setMembers.map((member) => ({
				key: member.memberKey,
				order: member.order,
				mediaPlacementKey: member.mediaPlacementKey,
				printSourceKey: member.printSourceKey,
			})),
		};
	}
	if (revision.productKind === "digital_download") {
		const file = rows.digitalFiles[0];
		return {
			...common,
			productKind: "digital_download",
			fulfillmentMode: "digital_delivery",
			...(file
				? {
					paidFile: {
						key: file.relationKey,
						assetId: file.assetId,
						version: file.version,
					},
				}
				: {}),
		};
	}
	return {
		...common,
		productKind: revision.productKind,
		fulfillmentMode: "merchant_fulfilled",
	};
}

/** One-document list-view read: no child relation or asset fan-out. */
export async function loadCatalogProductGraphV2RevisionSummary(
	ctx: CatalogGraphContext,
	productValue: CatalogProduct,
	revisionId: Id<"catalogProductRevisions"> | undefined,
) {
	if (!revisionId) return null;
	const product = requireCatalogProductGraphV2Product(productValue);
	const revision = await ctx.db.get(revisionId);
	if (!revision) throw new Error("Catalog V2 revision not found");
	assertCatalogProductGraphV2RevisionOwnership(revision, product);
	assertCatalogProductGraphV2RevisionSummary(revision, product);
	return projectCatalogProductGraphV2RevisionSummary(revision);
}

/**
 * Load and prove one immutable V2 graph. The returned stored asset documents
 * are internal-only; callers must use the Editor projection before returning.
 */
export async function loadCatalogProductGraphV2Revision(
	ctx: CatalogGraphContext,
	productValue: CatalogProduct,
	revisionId: Id<"catalogProductRevisions"> | undefined,
) {
	if (!revisionId) return null;
	const product = requireCatalogProductGraphV2Product(productValue);
	const revision = await ctx.db.get(revisionId);
	if (!revision) throw new Error("Catalog V2 revision not found");
	assertCatalogProductGraphV2RevisionOwnership(revision, product);
	assertCatalogProductGraphV2RevisionSummary(revision, product);
	const rows = await loadCatalogProductGraphV2Rows(ctx, revision._id);

	assertExactCount(
		rows.variants.length,
		revision.variantCount,
		CATALOG_PRODUCT_GRAPH_V2_LIMITS.variantsPerRevision,
		"Catalog V2 variant",
	);
	assertExactCount(
		rows.webMedia.length,
		revision.webMediaCount,
		CATALOG_PRODUCT_GRAPH_V2_LIMITS.webMediaPlacements,
		"Catalog V2 web-media",
	);
	assertExactCount(
		rows.printSources.length,
		revision.printSourceCount,
		CATALOG_PRODUCT_GRAPH_V2_LIMITS.printSources,
		"Catalog V2 print-source",
	);
	assertExactCount(
		rows.setMembers.length,
		revision.setMemberCount,
		CATALOG_PRODUCT_GRAPH_V2_LIMITS.printSetMembers,
		"Catalog V2 print-set member",
	);
	assertExactCount(
		rows.digitalFiles.length,
		revision.digitalFileCount,
		1,
		"Catalog V2 paid-file",
	);
	assertExactCount(
		rows.shopPlacements.length,
		revision.shopPlacementCount,
		1,
		"Catalog V2 shop-placement",
	);
	if (revision.shopPlacementCount !== 1) {
		throw new Error("Catalog V2 requires exactly one shop placement");
	}
	if (
		(revision.productKind !== "print" && revision.productKind !== "print_set"
			&& rows.printSources.length !== 0)
		|| (revision.productKind !== "print_set" && rows.setMembers.length !== 0)
		|| (revision.productKind !== "digital_download" && rows.digitalFiles.length !== 0)
	) throw new Error("Catalog V2 child relation is invalid for its product kind");

	assertRowsOwned(rows.variants, product, revision, "Catalog V2 variant");
	assertRowsOwned(rows.webMedia, product, revision, "Catalog V2 web-media");
	assertRowsOwned(rows.printSources, product, revision, "Catalog V2 print-source");
	assertRowsOwned(rows.setMembers, product, revision, "Catalog V2 print-set member");
	assertRowsOwned(rows.digitalFiles, product, revision, "Catalog V2 paid-file");
	assertRowsOwned(rows.shopPlacements, product, revision, "Catalog V2 shop-placement");

	const storedDraft = validateCatalogProductGraphV2Draft(
		draftFromStoredGraph(revision, rows),
	);
	const prepared = await prepareCatalogProductGraphV2Draft(
		ctx,
		product.siteUrl,
		storedDraft,
	);
	if (await checksumCatalogProductGraphV2Draft(prepared.draft) !== revision.checksum) {
		throw new Error("Catalog V2 revision checksum mismatch");
	}
	return {
		revision,
		variants: rows.variants,
		webMediaPlacements: rows.webMedia,
		printSources: rows.printSources,
		setMembers: rows.setMembers,
		digitalFile: rows.digitalFiles[0] ?? null,
		shopPlacement: rows.shopPlacements[0] as Doc<"catalogProductShopPlacements">,
		webMediaAssets: prepared.webMediaAssets,
		printSourceAssets: prepared.printSourceAssets,
		paidFileAsset: prepared.paidFileAsset,
		draft: prepared.draft,
	};
}

export function projectCatalogProductGraphV2RevisionSummary(
	revision: CatalogRevisionV2 | null,
) {
	if (!revision) return null;
	return {
		revisionId: revision._id,
		productKind: revision.productKind,
		title: revision.title ?? null,
		saleAvailability: revision.saleAvailability,
		variantCount: revision.variantCount,
		webMediaCount: revision.webMediaCount,
		createdAt: revision.createdAt,
	};
}
