import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
	canonicalizeCatalogProductGraphV2Draft,
} from "./catalogProductGraphChecksum";
import type { CatalogProductGraphV2Draft } from "./catalogProductGraphValidators";
import {
	type PaidDigitalFileAsset,
	type PrivatePrintSourceAsset,
	toEditorSafePaidDigitalFileAsset,
	toEditorSafePrivatePrintSourceAsset,
	validatePaidDigitalFileAsset,
	validatePrivatePrintSourceAsset,
} from "./catalogPrivateAssetValidators";
import { validateReadyWebAsset } from "./mediaValidators";

type CatalogGraphContext = QueryCtx | MutationCtx;
type CatalogRevision = Doc<"catalogProductRevisions">;
type CatalogRevisionV2 = Extract<CatalogRevision, { schemaVersion: 2 }>;

function readyWebAssetValue(asset: Doc<"mediaAssets">) {
	return {
		assetId: asset.assetId,
		originalFilename: asset.originalFilename,
		source: asset.source,
		master: asset.master,
		derivatives: asset.derivatives,
	};
}

function privatePrintSourceValue(
	asset: Doc<"catalogPrintSourceAssets">,
): PrivatePrintSourceAsset {
	return {
		siteUrl: asset.siteUrl,
		assetKey: asset.assetKey,
		privateObjectKey: asset.privateObjectKey,
		status: asset.status,
		originalFilename: asset.originalFilename,
		mimeType: asset.mimeType,
		sizeBytes: asset.sizeBytes,
		widthPixels: asset.widthPixels,
		heightPixels: asset.heightPixels,
		sha256: asset.sha256,
		provenance: asset.provenance,
		createdAt: asset.createdAt,
		createdBy: asset.createdBy,
		verifiedAt: asset.verifiedAt,
		verifiedBy: asset.verifiedBy,
	};
}

function paidDigitalFileValue(
	asset: Doc<"catalogDigitalFileAssets">,
): PaidDigitalFileAsset {
	return {
		siteUrl: asset.siteUrl,
		assetKey: asset.assetKey,
		privateObjectKey: asset.privateObjectKey,
		status: asset.status,
		originalFilename: asset.originalFilename,
		mimeType: asset.mimeType,
		sizeBytes: asset.sizeBytes,
		sha256: asset.sha256,
		...(asset.version === undefined ? {} : { version: asset.version }),
		provenance: asset.provenance,
		createdAt: asset.createdAt,
		createdBy: asset.createdBy,
		verifiedAt: asset.verifiedAt,
		verifiedBy: asset.verifiedBy,
	};
}

async function requireReadyWebMediaAsset(
	ctx: CatalogGraphContext,
	siteUrl: string,
	assetId: string,
) {
	const normalizedId = ctx.db.normalizeId("mediaAssets", assetId);
	if (!normalizedId) throw new Error("Catalog web-media asset ID is invalid");
	const asset = await ctx.db.get(normalizedId);
	if (
		!asset
		|| asset.siteUrl !== siteUrl
		|| asset.intent !== "web"
		|| asset.status !== "ready"
	) {
		throw new Error(
			"Catalog web media requires a ready web asset owned by the same site",
		);
	}
	validateReadyWebAsset(siteUrl, readyWebAssetValue(asset));
	return asset;
}

export async function requireVerifiedPrintSourceAsset(
	ctx: CatalogGraphContext,
	siteUrl: string,
	assetId: string,
) {
	const normalizedId = ctx.db.normalizeId("catalogPrintSourceAssets", assetId);
	if (!normalizedId) throw new Error("Catalog print-source asset ID is invalid");
	const asset = await ctx.db.get(normalizedId);
	if (!asset || asset.siteUrl !== siteUrl || asset.status !== "verified") {
		throw new Error(
			"Catalog print sources require a verified private asset owned by the same site",
		);
	}
	validatePrivatePrintSourceAsset(privatePrintSourceValue(asset));
	return asset;
}

export async function requireVerifiedPaidFileAssetById(
	ctx: CatalogGraphContext,
	siteUrl: string,
	assetId: string,
) {
	const normalizedId = ctx.db.normalizeId("catalogDigitalFileAssets", assetId);
	if (!normalizedId) throw new Error("Catalog paid-file asset ID is invalid");
	const asset = await ctx.db.get(normalizedId);
	if (!asset || asset.siteUrl !== siteUrl || asset.status !== "verified") {
		throw new Error(
			"Catalog paid files require a verified private asset owned by the same site",
		);
	}
	validatePaidDigitalFileAsset(paidDigitalFileValue(asset));
	return asset;
}

async function requireVerifiedPaidFileAsset(
	ctx: CatalogGraphContext,
	siteUrl: string,
	assetId: string,
	version: string | undefined,
) {
	const asset = await requireVerifiedPaidFileAssetById(ctx, siteUrl, assetId);
	if ((asset.version ?? null) !== (version ?? null)) {
		throw new Error("Catalog paid-file relation version does not match its asset");
	}
	return asset;
}

export type PreparedCatalogProductGraphV2 = {
	draft: CatalogProductGraphV2Draft;
	webMediaAssets: Array<{
		placementKey: string;
		asset: Doc<"mediaAssets">;
	}>;
	printSourceAssets: Array<{
		relationKey: string;
		asset: Doc<"catalogPrintSourceAssets">;
	}>;
	paidFileAsset: {
		relationKey: string;
		asset: Doc<"catalogDigitalFileAssets">;
	} | null;
};

export async function prepareCatalogProductGraphV2Draft(
	ctx: CatalogGraphContext,
	siteUrl: string,
	draft: CatalogProductGraphV2Draft,
): Promise<PreparedCatalogProductGraphV2> {
	const canonical = canonicalizeCatalogProductGraphV2Draft(draft);
	const webMediaAssets = await Promise.all(
		canonical.webMedia.map(async (placement) => ({
			placementKey: placement.key,
			asset: await requireReadyWebMediaAsset(
				ctx,
				siteUrl,
				placement.assetId,
			),
		})),
	);
	const normalizedWebMedia = canonical.webMedia.map((placement, index) => ({
		...placement,
		assetId: webMediaAssets[index]?.asset._id as Id<"mediaAssets">,
	}));

	let printSourceAssets: PreparedCatalogProductGraphV2["printSourceAssets"] = [];
	let paidFileAsset: PreparedCatalogProductGraphV2["paidFileAsset"] = null;
	let normalized: CatalogProductGraphV2Draft;

	if (canonical.productKind === "print" || canonical.productKind === "print_set") {
		printSourceAssets = await Promise.all(
			canonical.printSources.map(async (source) => ({
				relationKey: source.key,
				asset: await requireVerifiedPrintSourceAsset(
					ctx,
					siteUrl,
					source.assetId,
				),
			})),
		);
		const printSources = canonical.printSources.map((source, index) => ({
			...source,
			assetId: printSourceAssets[index]?.asset
				._id as Id<"catalogPrintSourceAssets">,
		}));
		normalized = { ...canonical, webMedia: normalizedWebMedia, printSources };
	} else if (canonical.productKind === "digital_download") {
		if (canonical.paidFile) {
			const asset = await requireVerifiedPaidFileAsset(
				ctx,
				siteUrl,
				canonical.paidFile.assetId,
				canonical.paidFile.version,
			);
			paidFileAsset = { relationKey: canonical.paidFile.key, asset };
		}
		normalized = {
			...canonical,
			webMedia: normalizedWebMedia,
			...(canonical.paidFile && paidFileAsset
				? {
					paidFile: {
						...canonical.paidFile,
						assetId: paidFileAsset.asset._id,
					},
				}
				: {}),
		};
	} else {
		normalized = { ...canonical, webMedia: normalizedWebMedia };
	}

	return {
		draft: canonicalizeCatalogProductGraphV2Draft(normalized),
		webMediaAssets,
		printSourceAssets,
		paidFileAsset,
	};
}

/** Resolve opaque input strings to real, tenant-owned asset document IDs. */
export async function normalizeCatalogProductGraphV2DraftAssets(
	ctx: CatalogGraphContext,
	siteUrl: string,
	draft: CatalogProductGraphV2Draft,
) {
	return (await prepareCatalogProductGraphV2Draft(ctx, siteUrl, draft)).draft;
}

function projectEditorWebAsset(asset: Doc<"mediaAssets">) {
	const derivative = (name: keyof Doc<"mediaAssets">["derivatives"]) => ({
		contentType: asset.derivatives[name].contentType,
		width: asset.derivatives[name].width,
		height: asset.derivatives[name].height,
	});
	return {
		mediaAssetId: asset._id,
		originalFilename: asset.originalFilename,
		status: asset.status,
		source: {
			contentType: asset.source.contentType,
			sizeBytes: asset.source.sizeBytes,
			width: asset.source.width,
			height: asset.source.height,
		},
		derivatives: {
			thumb: derivative("thumb"),
			card: derivative("card"),
			display1280: derivative("display1280"),
			display2048: derivative("display2048"),
			display2560: derivative("display2560"),
		},
		createdAt: asset.createdAt,
	};
}

type CatalogProductGraphV2EditorProjectionSource = {
	revision: CatalogRevisionV2;
	draft: CatalogProductGraphV2Draft;
	webMediaAssets: PreparedCatalogProductGraphV2["webMediaAssets"];
	printSourceAssets: PreparedCatalogProductGraphV2["printSourceAssets"];
	paidFileAsset: PreparedCatalogProductGraphV2["paidFileAsset"];
};

/**
 * Editor metadata only. Storage keys, checksums, provenance, actors, grants,
 * capabilities, and private object identities are deliberately absent.
 */
export function projectCatalogProductGraphV2ForEditor(
	graph: CatalogProductGraphV2EditorProjectionSource | null,
) {
	if (!graph) return null;
	return {
		revisionId: graph.revision._id,
		schemaVersion: 2 as const,
		productKind: graph.revision.productKind,
		createdAt: graph.revision.createdAt,
		draft: graph.draft,
		webMediaAssets: graph.webMediaAssets.map(({ placementKey, asset }) => ({
			placementKey,
			asset: projectEditorWebAsset(asset),
		})),
		printSourceAssets: graph.printSourceAssets.map(({ relationKey, asset }) => ({
			relationKey,
			asset: toEditorSafePrivatePrintSourceAsset(asset),
		})),
		paidFileAsset: graph.paidFileAsset
			? {
				relationKey: graph.paidFileAsset.relationKey,
				asset: toEditorSafePaidDigitalFileAsset(graph.paidFileAsset.asset),
			}
			: null,
	};
}
