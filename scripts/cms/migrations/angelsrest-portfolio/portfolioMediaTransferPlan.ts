import { createHash } from "node:crypto";

export const PORTFOLIO_MEDIA_OPERATION = "R6-portfolio-media-transfer-v1" as const;
export const PORTFOLIO_MEDIA_SITE_URL = "angelsrest.online" as const;
export const PORTFOLIO_MEDIA_TRANSFORM_RECIPE = "sanity-width-1600-webp-q90" as const;
export const PORTFOLIO_MEDIA_TRANSFORM_QUERY = "w=1600&fm=webp&q=90" as const;
export const PORTFOLIO_MEDIA_MAX_BYTES = 20_000_000 as const;
export const PORTFOLIO_MEDIA_CONCURRENCY = 3 as const;
export const PORTFOLIO_MEDIA_CANARY_REF =
	"image-3fd4cd2a50b69dd516c3dfac71248f2b9a2fbb54-810x1440-gif" as const;
export const PORTFOLIO_MEDIA_CONFIRMATION =
	"transfer R6 Portfolio 294-asset batch to www.angelsrest.online" as const;

export const PORTFOLIO_INVENTORY_FILE_SHA256 = {
	"INDEX.json": "ab4558595ed115209b823a14c40898b177ffb7bcb621c2589b3903d6729f3533",
	"MAPPING-CANDIDATES.json": "90f583411f17ad079ebda9153027e6c57beff8b1abc80556d46daea1aeedcd96",
	"OWNER-AUTHORITY.txt": "db85c76cf21186e5c63a0820543c1e57c3c4c50b121ebe2c94a36ecb81cdac3e",
	"RESULT.json": "7e0b4cdf2876751e4ea70919f4bb042d211b9f80b15f6c4f8a7193861dd027e1",
	"SANITY-INVENTORY.json": "25da05daa61022a41300a8ebfaa2aa713440672a75e931be23dc8e16ea3a7c19",
	"SOURCE-BINDING.json": "73ea133fd29c4741837ac9c9b66a2a96dcdd051518c6754716611b43094a8968",
	"TARGET-INVENTORY.json": "99d5e389da5c1efe118e95e76a61730eef89a42b0286b091a0d2b95fbd2c11c1",
} as const;

export const PORTFOLIO_PRESERVED_TARGET_READ_FILE_SHA256 = {
	"INDEX.json": "016d261e70fa33ef894594285a3cd326c876c6827d9c32064c687fd910cbb28f",
	"RESULT.json": "69e33d7055aa4db71eedb6590ca2c5f4403009ebb2992489acd036c55cf6ae67",
} as const;

export const PORTFOLIO_PRESERVED_TARGET_EVIDENCE_SHA256 = {
	"OWNER-AUTHORITY.txt": "b3917d01a427cc6829c69c9e49e9bfa785298367aa5514e313b30fef8ada80ea",
	"RESULT.json": "69e33d7055aa4db71eedb6590ca2c5f4403009ebb2992489acd036c55cf6ae67",
	"SOURCE-BINDING.json": "374cfc0b205f18cd4684d3a0b168596c5373a6570834c969c3524dc20fef2e07",
	"TARGET-REREAD.json": "a2dd70d848d16d8ae7889ecc140618b79249690a4d3b7af28273ba57ec8694c5",
} as const;

export const PORTFOLIO_DECISION_SET = {
	id: "angelsrest-r6-portfolio-owner-approved-v1",
	ordering: "order-rank-then-source-id-owner-approved",
	visibility: "preserve-unfiltered-all-published-owner-approved",
	canonicalUrl: "preserve-title-derived-canonical-owner-approved",
	derivatives: "accept-fixed-convex-webp-owner-approved",
	cropHotspot: "accept-focal-only-owner-approved",
	captions: "confirmed-absent-owner-approved",
	missingAlt: "legacy-runtime-fallback-only-owner-approved",
	seo: "confirmed-absent-owner-approved",
	unsupportedFields: "omit-category-date-featured-visibility-with-presence-recorded-owner-approved",
	mediaTransfer: "sanity-width-1600-webp-q90-owner-approved",
	gifCanary: "17-frames-100ms-infinite-card-and-display2048",
} as const;

const ACCEPTED_PLAN_SHA256 = "7a384befe604972ec690e41381f39f5c4e8f4a4641304c6a642dd7eb00c5c37e";
const PREVIOUS_MODULE_COMPLETION_INDEX_SHA256 =
	"bdafc055a9c47adfdfc785d0ea4700e447e9a83c20c3f14364c8155323e5797c";
const SANITY_ASSET_REF = /^image-[0-9a-f]{40}-[1-9]\d*x[1-9]\d*-(?:jpg|png|gif|webp)$/;
const SHA1 = /^[0-9a-f]{40}$/;

type JsonObject = Record<string, unknown>;

export type PortfolioInventoryFiles = Record<keyof typeof PORTFOLIO_INVENTORY_FILE_SHA256, string>;
export type PortfolioPreservedTargetFiles = Record<
	keyof typeof PORTFOLIO_PRESERVED_TARGET_READ_FILE_SHA256,
	string
>;

export type PortfolioMediaPlanAsset = {
	sourceOrder: number;
	gallerySourceId: string;
	gallerySourceRevision: string;
	galleryPortfolioOrder: number;
	placementOrder: number;
	placementKey: string;
	sourceAltState: "present" | "absent";
	sourceAsset: {
		id: string;
		revision: string;
		url: string;
		sha1: string;
		originalContentType: string;
		originalSizeBytes: number;
		originalWidth: number;
		originalHeight: number;
	};
	transferSource: {
		recipe: typeof PORTFOLIO_MEDIA_TRANSFORM_RECIPE;
		query: typeof PORTFOLIO_MEDIA_TRANSFORM_QUERY;
		url: string;
		expectedContentType: "image/webp";
		maximumSizeBytes: typeof PORTFOLIO_MEDIA_MAX_BYTES;
	};
	canary: boolean;
};

export type PortfolioMediaTransferPlanPayload = {
	schema: "angelsrest.r6.portfolio-media-transfer-plan.v1";
	operation: typeof PORTFOLIO_MEDIA_OPERATION;
	siteUrl: typeof PORTFOLIO_MEDIA_SITE_URL;
	acceptedPlanSha256: typeof ACCEPTED_PLAN_SHA256;
	previousModuleCompletionIndexSha256: typeof PREVIOUS_MODULE_COMPLETION_INDEX_SHA256;
	inventory: {
		files: typeof PORTFOLIO_INVENTORY_FILE_SHA256;
		sourceSchema: "angelsrest.r6.portfolio-sanity-inventory.v1";
		mappingSchema: "angelsrest.r6.portfolio-mapping-candidates.v1";
		targetSchema: "angelsrest.r6.portfolio-target-inventory.v1";
		preservedTargetReread: {
			filesRead: typeof PORTFOLIO_PRESERVED_TARGET_READ_FILE_SHA256;
			evidenceFiles: typeof PORTFOLIO_PRESERVED_TARGET_EVIDENCE_SHA256;
			indexSchema: "angelsrest.r6.portfolio-preserved-target-reread-index.v1";
			resultSchema: "angelsrest.r6.portfolio-preserved-target-reread-result.v1";
			rawActorsReturnedOrStored: false;
		};
	};
	source: {
		projectId: "n7rvza4g";
		dataset: "production";
		perspective: "published";
		galleryCount: 12;
		placementCount: 294;
		assetCount: 294;
	};
	decisionSet: typeof PORTFOLIO_DECISION_SET;
	preservation: {
		sourceDraft: {
			id: "drafts.70ec23b8-5bed-4db4-ba1b-e86155386b40";
			revision: "60a2d084-8b84-4d89-a2d9-0338c930a8c3";
			changedFields: readonly [];
			disposition: "preserve-source-unmodified";
		};
		preservedTargetGallery: {
			galleryId: "nn74x1p6t7123zy7neabeyh1pn8awmzw";
			draftRevisionId: "ns74hc5agzdv66ck3mv542y0sx8ax75v";
			publishedRevisionId: null;
			slug: "test";
			portfolioOrder: 0;
			isPublished: false;
			isVisible: null;
			sourceDocumentId: null;
			createdAt: 1_784_515_136_078;
			createdByDigest: "6c23d755463868dedab30a5e38be41c6141978a9bb6a953189d61f663d6b6787";
			updatedAt: 1_784_515_136_078;
			updatedByDigest: "a723b3bfa349cad4f526ed0abd588dfebd0f8cf73e77576dfa35ded79f56d35a";
			publishedAt: null;
			publishedBy: null;
			revision: {
				revisionId: "ns74hc5agzdv66ck3mv542y0sx8ax75v";
				checksum: "4293cf2b0d1774bc56765acaea3511b3f0a2004f160c0900734cdb27240a7d42";
				createdAt: 1_784_515_136_078;
				createdByDigest: "039008400e7dbc04469989b94aa3be4c1b6d4bb8cb3f7156ee0eb72b398efe0d";
			};
			fieldPresence: {
				isVisible: "absent";
				sourceDocumentId: "absent";
				publishedBy: "absent";
			};
			disposition: "preserve-unrelated-unpublished-target-draft";
		};
	};
	transfer: {
		recipe: typeof PORTFOLIO_MEDIA_TRANSFORM_RECIPE;
		query: typeof PORTFOLIO_MEDIA_TRANSFORM_QUERY;
		maximumSizeBytes: typeof PORTFOLIO_MEDIA_MAX_BYTES;
		concurrency: typeof PORTFOLIO_MEDIA_CONCURRENCY;
		publicDerivativeEvidence: {
			requiredForEveryAsset: true;
			receiptSchemaVersion: 2;
			gate: "must-bind-before-per-asset-receipt";
			fields: readonly ["sha256", "sizeBytes", "contentType", "width", "height"];
			derivatives: {
				card: "card.webp";
				display2048: "display-2048.webp";
			};
		};
		canary: {
			sourceAssetRef: typeof PORTFOLIO_MEDIA_CANARY_REF;
			expectedFrameCount: 17;
			expectedFrameDurationMs: 100;
			expectedLoop: "infinite";
			targetPublicDerivatives: readonly ["card", "display2048"];
			gate: "must-pass-before-remaining-assets";
		};
	};
	galleryOrder: Array<{
		portfolioOrder: number;
		sourceId: string;
		sourceRevision: string;
		sourceOrderRank: string;
		slug: string;
		placementCount: number;
	}>;
	assets: PortfolioMediaPlanAsset[];
	transferOrder: string[];
};

export type PortfolioMediaTransferPlan = PortfolioMediaTransferPlanPayload & {
	planDigest: string;
};

function objectValue(value: unknown, label: string): JsonObject {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`${label} must be an object`);
	}
	return value as JsonObject;
}

function arrayValue(value: unknown, label: string): unknown[] {
	if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
	return value;
}

function stringValue(value: unknown, label: string): string {
	if (typeof value !== "string" || !value || value !== value.trim()) {
		throw new Error(`${label} must be a non-empty trimmed string`);
	}
	return value;
}

function integerValue(value: unknown, label: string): number {
	if (typeof value !== "number" || !Number.isSafeInteger(value)) {
		throw new Error(`${label} must be an integer`);
	}
	return value;
}

function positiveInteger(value: unknown, label: string): number {
	const parsed = integerValue(value, label);
	if (parsed < 1) throw new Error(`${label} must be positive`);
	return parsed;
}

function parseJson(contents: string, label: string): unknown {
	try {
		return JSON.parse(contents) as unknown;
	} catch {
		throw new Error(`${label} is not valid JSON`);
	}
}

export function canonicalPortfolioMediaJson(value: unknown): string {
	if (value === null) return "null";
	if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
	if (typeof value === "number") {
		if (!Number.isFinite(value))
			throw new Error("Portfolio media plan contains a non-finite number");
		return JSON.stringify(value);
	}
	if (Array.isArray(value)) return `[${value.map(canonicalPortfolioMediaJson).join(",")}]`;
	if (typeof value === "object") {
		return `{${Object.entries(value as JsonObject)
			.filter(([, entry]) => entry !== undefined)
			.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
			.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalPortfolioMediaJson(entry)}`)
			.join(",")}}`;
	}
	throw new Error("Portfolio media plan contains an unsupported value");
}

export function sha256Bytes(value: string | Uint8Array): string {
	return createHash("sha256").update(value).digest("hex");
}

export function digestPortfolioMediaPlan(payload: PortfolioMediaTransferPlanPayload): string {
	return sha256Bytes(canonicalPortfolioMediaJson(payload));
}

function assertInventoryHashes(files: PortfolioInventoryFiles): void {
	for (const [filename, expected] of Object.entries(PORTFOLIO_INVENTORY_FILE_SHA256)) {
		const contents = files[filename as keyof PortfolioInventoryFiles];
		if (typeof contents !== "string" || sha256Bytes(contents) !== expected) {
			throw new Error(`Sealed Portfolio inventory hash differs for ${filename}`);
		}
	}
}

function assertPreservedTargetHashes(files: PortfolioPreservedTargetFiles): void {
	for (const [filename, expected] of Object.entries(PORTFOLIO_PRESERVED_TARGET_READ_FILE_SHA256)) {
		const contents = files[filename as keyof PortfolioPreservedTargetFiles];
		if (typeof contents !== "string" || sha256Bytes(contents) !== expected) {
			throw new Error(`Sealed preserved Portfolio target hash differs for ${filename}`);
		}
	}
}

function transformedUrl(sourceUrl: string): string {
	let url: URL;
	try {
		url = new URL(sourceUrl);
	} catch {
		throw new Error("Portfolio source asset URL is invalid");
	}
	if (
		url.protocol !== "https:" ||
		url.hostname !== "cdn.sanity.io" ||
		url.pathname.split("/").slice(0, 4).join("/") !== "/images/n7rvza4g/production" ||
		url.username ||
		url.password ||
		url.search ||
		url.hash
	) {
		throw new Error("Portfolio source asset URL left the sealed Sanity boundary");
	}
	return `${url.toString()}?${PORTFOLIO_MEDIA_TRANSFORM_QUERY}`;
}

function exactSourceAsset(
	assetValue: unknown,
	placement: JsonObject,
): PortfolioMediaPlanAsset["sourceAsset"] {
	const asset = objectValue(assetValue, "Portfolio inventory asset");
	const ref = stringValue(asset.assetRef, "Portfolio inventory asset ref");
	const resolved = objectValue(asset.resolved, "Portfolio resolved asset");
	const dimensions = objectValue(resolved.dimensions, "Portfolio resolved dimensions");
	const id = stringValue(resolved.id, "Portfolio resolved asset ID");
	const revision = stringValue(resolved.rev, "Portfolio resolved asset revision");
	const sha1 = stringValue(resolved.sha1hash, "Portfolio resolved asset SHA-1");
	if (
		!SANITY_ASSET_REF.test(ref) ||
		id !== ref ||
		placement.sourceAssetRef !== ref ||
		placement.sourceAssetRev !== revision ||
		!SHA1.test(sha1) ||
		!ref.startsWith(`image-${sha1}-`)
	) {
		throw new Error("Portfolio placement and resolved source asset identity differ");
	}
	return {
		id,
		revision,
		url: stringValue(resolved.url, "Portfolio resolved asset URL"),
		sha1,
		originalContentType: stringValue(resolved.mimeType, "Portfolio resolved asset content type"),
		originalSizeBytes: positiveInteger(resolved.sizeBytes, "Portfolio resolved asset byte count"),
		originalWidth: positiveInteger(dimensions.width, "Portfolio resolved asset width"),
		originalHeight: positiveInteger(dimensions.height, "Portfolio resolved asset height"),
	};
}

function validateTargetDraft(target: JsonObject) {
	const counts = objectValue(target.counts, "Portfolio target counts");
	if (
		target.schema !== "angelsrest.r6.portfolio-target-inventory.v1" ||
		target.siteUrl !== PORTFOLIO_MEDIA_SITE_URL ||
		counts.galleries !== 1 ||
		counts.revisions !== 1 ||
		counts.placements !== 0
	) {
		throw new Error("Portfolio target inventory differs from the sealed pre-effect state");
	}
	const gallery = objectValue(
		arrayValue(target.galleries, "Portfolio target galleries")[0],
		"Portfolio target draft gallery",
	);
	const revision = objectValue(
		arrayValue(target.revisions, "Portfolio target revisions")[0],
		"Portfolio target draft revision",
	);
	if (
		gallery.galleryId !== "nn74x1p6t7123zy7neabeyh1pn8awmzw" ||
		gallery.draftRevisionId !== "ns74hc5agzdv66ck3mv542y0sx8ax75v" ||
		gallery.publishedRevisionId !== null ||
		gallery.isPublished !== false ||
		gallery.slug !== "test" ||
		revision.revisionId !== gallery.draftRevisionId ||
		revision.galleryId !== gallery.galleryId ||
		revision.checksum !== "4293cf2b0d1774bc56765acaea3511b3f0a2004f160c0900734cdb27240a7d42" ||
		revision.slug !== "test" ||
		revision.title !== "test" ||
		revision.placementCount !== 0 ||
		arrayValue(target.placements, "Portfolio target placements").length !== 0
	) {
		throw new Error("Unrelated Portfolio target draft identity changed");
	}
}

function validatePreservedTargetEvidence(
	files: PortfolioPreservedTargetFiles,
): PortfolioMediaTransferPlanPayload["preservation"]["preservedTargetGallery"] {
	assertPreservedTargetHashes(files);
	const index = objectValue(
		parseJson(files["INDEX.json"], "Preserved Portfolio target INDEX.json"),
		"Preserved Portfolio target index",
	);
	const result = objectValue(
		parseJson(files["RESULT.json"], "Preserved Portfolio target RESULT.json"),
		"Preserved Portfolio target result",
	);
	if (
		index.schema !== "angelsrest.r6.portfolio-preserved-target-reread-index.v1" ||
		index.status !== "GO" ||
		canonicalPortfolioMediaJson(index.evidenceSha256) !==
			canonicalPortfolioMediaJson(PORTFOLIO_PRESERVED_TARGET_EVIDENCE_SHA256) ||
		result.schema !== "angelsrest.r6.portfolio-preserved-target-reread-result.v1" ||
		result.status !== "GO" ||
		arrayValue(result.failedChecks, "Preserved Portfolio failed checks").length !== 0
	) {
		throw new Error("Preserved Portfolio target evidence identity changed");
	}

	const checks = objectValue(result.checks, "Preserved Portfolio target checks");
	const effectBoundary = objectValue(
		result.effectBoundary,
		"Preserved Portfolio target effect boundary",
	);
	const target = objectValue(result.target, "Preserved Portfolio target");
	const gallery = objectValue(target.gallery, "Preserved Portfolio target gallery");
	const revision = objectValue(target.revision, "Preserved Portfolio target revision");
	const optionalFields = objectValue(target.optionalFields, "Preserved Portfolio optional fields");
	const isVisible = objectValue(optionalFields.isVisible, "Preserved Portfolio visibility state");
	const sourceDocumentId = objectValue(
		optionalFields.sourceDocumentId,
		"Preserved Portfolio source identity state",
	);
	const actorDigests = objectValue(target.actorDigests, "Preserved Portfolio target actor digests");
	if (
		canonicalPortfolioMediaJson(checks) !==
			canonicalPortfolioMediaJson({
				capabilityAbsent: true,
				digestsOnly: true,
				exactDomain: true,
				exactGallery: true,
				exactRevision: true,
				noDrift: true,
				oneQueryNoMutation: true,
				optionalFieldShapes: true,
			}) ||
		canonicalPortfolioMediaJson(effectBoundary) !==
			canonicalPortfolioMediaJson({
				capabilitiesEnabled: 0,
				convexQueries: 1,
				mutations: 0,
				rawActorsReturnedOrStored: false,
				sanityReads: 0,
			}) ||
		target.migrationCapabilityState !== "absent" ||
		arrayValue(target.driftCodes, "Preserved Portfolio drift codes").length !== 0 ||
		gallery.galleryId !== "nn74x1p6t7123zy7neabeyh1pn8awmzw" ||
		gallery.draftRevisionId !== "ns74hc5agzdv66ck3mv542y0sx8ax75v" ||
		gallery.publishedRevisionId !== null ||
		gallery.slug !== "test" ||
		gallery.portfolioOrder !== 0 ||
		gallery.isPublished !== false ||
		gallery.createdAt !== 1_784_515_136_078 ||
		gallery.updatedAt !== 1_784_515_136_078 ||
		gallery.publishedAt !== null ||
		gallery.publishedByPresent !== false ||
		isVisible.present !== false ||
		isVisible.value !== null ||
		sourceDocumentId.present !== false ||
		sourceDocumentId.value !== null ||
		revision.revisionId !== "ns74hc5agzdv66ck3mv542y0sx8ax75v" ||
		revision.galleryId !== gallery.galleryId ||
		revision.checksum !== "4293cf2b0d1774bc56765acaea3511b3f0a2004f160c0900734cdb27240a7d42" ||
		revision.createdAt !== 1_784_515_136_078 ||
		revision.slug !== "test" ||
		revision.title !== "test" ||
		revision.source !== "admin" ||
		revision.schemaVersion !== 1 ||
		revision.placementCount !== 0 ||
		revision.descriptionPresent !== false ||
		actorDigests.galleryCreatedBy !==
			"6c23d755463868dedab30a5e38be41c6141978a9bb6a953189d61f663d6b6787" ||
		actorDigests.galleryUpdatedBy !==
			"a723b3bfa349cad4f526ed0abd588dfebd0f8cf73e77576dfa35ded79f56d35a" ||
		actorDigests.revisionCreatedBy !==
			"039008400e7dbc04469989b94aa3be4c1b6d4bb8cb3f7156ee0eb72b398efe0d"
	) {
		throw new Error("Preserved Portfolio target tuple changed");
	}

	return {
		galleryId: "nn74x1p6t7123zy7neabeyh1pn8awmzw",
		draftRevisionId: "ns74hc5agzdv66ck3mv542y0sx8ax75v",
		publishedRevisionId: null,
		slug: "test",
		portfolioOrder: 0,
		isPublished: false,
		isVisible: null,
		sourceDocumentId: null,
		createdAt: 1_784_515_136_078,
		createdByDigest: "6c23d755463868dedab30a5e38be41c6141978a9bb6a953189d61f663d6b6787",
		updatedAt: 1_784_515_136_078,
		updatedByDigest: "a723b3bfa349cad4f526ed0abd588dfebd0f8cf73e77576dfa35ded79f56d35a",
		publishedAt: null,
		publishedBy: null,
		revision: {
			revisionId: "ns74hc5agzdv66ck3mv542y0sx8ax75v",
			checksum: "4293cf2b0d1774bc56765acaea3511b3f0a2004f160c0900734cdb27240a7d42",
			createdAt: 1_784_515_136_078,
			createdByDigest: "039008400e7dbc04469989b94aa3be4c1b6d4bb8cb3f7156ee0eb72b398efe0d",
		},
		fieldPresence: {
			isVisible: "absent",
			sourceDocumentId: "absent",
			publishedBy: "absent",
		},
		disposition: "preserve-unrelated-unpublished-target-draft",
	};
}

export function createPortfolioMediaTransferPlan(
	files: PortfolioInventoryFiles,
	preservedTargetFiles: PortfolioPreservedTargetFiles,
): PortfolioMediaTransferPlan {
	assertInventoryHashes(files);
	const preservedTargetGallery = validatePreservedTargetEvidence(preservedTargetFiles);
	const index = objectValue(parseJson(files["INDEX.json"], "INDEX.json"), "Portfolio index");
	const result = objectValue(parseJson(files["RESULT.json"], "RESULT.json"), "Portfolio result");
	const sourceBinding = objectValue(
		parseJson(files["SOURCE-BINDING.json"], "SOURCE-BINDING.json"),
		"Portfolio source binding",
	);
	const sanity = objectValue(
		parseJson(files["SANITY-INVENTORY.json"], "SANITY-INVENTORY.json"),
		"Portfolio Sanity inventory",
	);
	const mappings = objectValue(
		parseJson(files["MAPPING-CANDIDATES.json"], "MAPPING-CANDIDATES.json"),
		"Portfolio mapping candidates",
	);
	const target = objectValue(
		parseJson(files["TARGET-INVENTORY.json"], "TARGET-INVENTORY.json"),
		"Portfolio target inventory",
	);

	const indexCounts = objectValue(index.counts, "Portfolio index counts");
	const sanityCounts = objectValue(sanity.counts, "Portfolio source counts");
	const sanitySource = objectValue(sanity.source, "Portfolio source boundary");
	const resultSource = objectValue(result.source, "Portfolio result source counts");
	const production = objectValue(sourceBinding.production, "Portfolio production binding");
	if (
		index.outcome !== "INVENTORY_COMPLETE_BLOCKED_BEFORE_IMPORT" ||
		result.outcome !== "INVENTORY_COMPLETE_BLOCKED_BEFORE_IMPORT" ||
		result.acceptedPlanSha256 !== ACCEPTED_PLAN_SHA256 ||
		result.previousModuleCompletionIndexSha256 !== PREVIOUS_MODULE_COMPLETION_INDEX_SHA256 ||
		production.previousModuleCompletionIndexSha256 !== PREVIOUS_MODULE_COMPLETION_INDEX_SHA256 ||
		sanity.schema !== "angelsrest.r6.portfolio-sanity-inventory.v1" ||
		mappings.schema !== "angelsrest.r6.portfolio-mapping-candidates.v1" ||
		sanitySource.projectId !== "n7rvza4g" ||
		sanitySource.dataset !== "production" ||
		sanitySource.perspective !== "raw" ||
		indexCounts.publishedGalleries !== 12 ||
		indexCounts.publicPlacements !== 294 ||
		indexCounts.referencedAssets !== 294 ||
		sanityCounts.published !== 12 ||
		sanityCounts.publishedPlacements !== 294 ||
		sanityCounts.referencedAssets !== 294 ||
		resultSource.publishedGalleries !== 12 ||
		resultSource.publishedPlacements !== 294 ||
		resultSource.referencedAssets !== 294
	) {
		throw new Error("Portfolio sealed inventory counts or authority binding changed");
	}
	validateTargetDraft(target);

	const inventoryAssets = arrayValue(sanity.assets, "Portfolio source assets");
	if (inventoryAssets.length !== 294) throw new Error("Portfolio source asset set is incomplete");
	const assetByRef = new Map<string, unknown>();
	for (const value of inventoryAssets) {
		const asset = objectValue(value, "Portfolio source asset");
		const ref = stringValue(asset.assetRef, "Portfolio source asset ref");
		if (assetByRef.has(ref)) throw new Error("Portfolio source asset set contains duplicates");
		assetByRef.set(ref, value);
	}

	const galleryOrder: PortfolioMediaTransferPlanPayload["galleryOrder"] = [];
	const assets: PortfolioMediaPlanAsset[] = [];
	const usedRefs = new Set<string>();
	const sourceDrafts: Array<{ id: string; revision: string; changedFields: unknown[] }> = [];
	const mappingRows = arrayValue(mappings.mappings, "Portfolio mappings");
	if (mappingRows.length !== 12) throw new Error("Portfolio mapping gallery count is invalid");
	for (const [galleryIndex, mappingValue] of mappingRows.entries()) {
		const mapping = objectValue(mappingValue, "Portfolio gallery mapping");
		const source = objectValue(mapping.source, "Portfolio mapping source");
		const candidate = objectValue(mapping.targetCandidate, "Portfolio target candidate");
		const sourceId = stringValue(source.canonicalId, "Portfolio source gallery ID");
		const sourceRevision = stringValue(
			source.publishedRevision,
			"Portfolio source gallery revision",
		);
		const sourceOrderRank = stringValue(source.orderRank, "Portfolio source order rank");
		if (source.publishedDocumentId !== sourceId || candidate.portfolioOrder !== galleryIndex) {
			throw new Error("Portfolio source gallery mapping identity or order changed");
		}
		const placements = arrayValue(candidate.placements, "Portfolio candidate placements");
		galleryOrder.push({
			portfolioOrder: galleryIndex,
			sourceId,
			sourceRevision,
			sourceOrderRank,
			slug: stringValue(candidate.slug, "Portfolio target slug"),
			placementCount: placements.length,
		});
		if (source.draftDocumentId !== null || source.draftRevision !== null) {
			sourceDrafts.push({
				id: stringValue(source.draftDocumentId, "Portfolio source draft ID"),
				revision: stringValue(source.draftRevision, "Portfolio source draft revision"),
				changedFields: arrayValue(source.draftChangedFields, "Portfolio source draft changes"),
			});
		}
		for (const [placementIndex, placementValue] of placements.entries()) {
			const placement = objectValue(placementValue, "Portfolio candidate placement");
			if (placement.order !== placementIndex || placement.caption !== null) {
				throw new Error("Portfolio placement order or confirmed-absent caption changed");
			}
			const sourceAsset = exactSourceAsset(
				assetByRef.get(String(placement.sourceAssetRef)),
				placement,
			);
			if (usedRefs.has(sourceAsset.id)) {
				throw new Error("Portfolio migration source asset is not one-to-one");
			}
			usedRefs.add(sourceAsset.id);
			const alt = placement.alt;
			if (alt !== null && (typeof alt !== "string" || !alt.trim())) {
				throw new Error("Portfolio source alt text is invalid");
			}
			assets.push({
				sourceOrder: assets.length,
				gallerySourceId: sourceId,
				gallerySourceRevision: sourceRevision,
				galleryPortfolioOrder: galleryIndex,
				placementOrder: placementIndex,
				placementKey: stringValue(placement.targetPlacementKeyCandidate, "Portfolio placement key"),
				sourceAltState: alt === null ? "absent" : "present",
				sourceAsset,
				transferSource: {
					recipe: PORTFOLIO_MEDIA_TRANSFORM_RECIPE,
					query: PORTFOLIO_MEDIA_TRANSFORM_QUERY,
					url: transformedUrl(sourceAsset.url),
					expectedContentType: "image/webp",
					maximumSizeBytes: PORTFOLIO_MEDIA_MAX_BYTES,
				},
				canary: sourceAsset.id === PORTFOLIO_MEDIA_CANARY_REF,
			});
		}
	}
	if (
		assets.length !== 294 ||
		usedRefs.size !== 294 ||
		usedRefs.size !== assetByRef.size ||
		!usedRefs.has(PORTFOLIO_MEDIA_CANARY_REF)
	) {
		throw new Error("Portfolio transfer plan does not bind the exact 294-asset set");
	}
	const expectedGalleryOrder = [...galleryOrder].sort((left, right) => {
		const leftKey = `${left.sourceOrderRank}\u0000${left.sourceId}`;
		const rightKey = `${right.sourceOrderRank}\u0000${right.sourceId}`;
		return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
	});
	if (
		expectedGalleryOrder.some((entry, index) => entry.sourceId !== galleryOrder[index]?.sourceId)
	) {
		throw new Error("Portfolio gallery order differs from orderRank then source ID");
	}
	if (
		sourceDrafts.length !== 1 ||
		sourceDrafts[0]?.id !== "drafts.70ec23b8-5bed-4db4-ba1b-e86155386b40" ||
		sourceDrafts[0]?.revision !== "60a2d084-8b84-4d89-a2d9-0338c930a8c3" ||
		sourceDrafts[0]?.changedFields.length !== 0
	) {
		throw new Error("Portfolio source draft reconciliation identity changed");
	}

	const payload: PortfolioMediaTransferPlanPayload = {
		schema: "angelsrest.r6.portfolio-media-transfer-plan.v1",
		operation: PORTFOLIO_MEDIA_OPERATION,
		siteUrl: PORTFOLIO_MEDIA_SITE_URL,
		acceptedPlanSha256: ACCEPTED_PLAN_SHA256,
		previousModuleCompletionIndexSha256: PREVIOUS_MODULE_COMPLETION_INDEX_SHA256,
		inventory: {
			files: PORTFOLIO_INVENTORY_FILE_SHA256,
			sourceSchema: "angelsrest.r6.portfolio-sanity-inventory.v1",
			mappingSchema: "angelsrest.r6.portfolio-mapping-candidates.v1",
			targetSchema: "angelsrest.r6.portfolio-target-inventory.v1",
			preservedTargetReread: {
				filesRead: PORTFOLIO_PRESERVED_TARGET_READ_FILE_SHA256,
				evidenceFiles: PORTFOLIO_PRESERVED_TARGET_EVIDENCE_SHA256,
				indexSchema: "angelsrest.r6.portfolio-preserved-target-reread-index.v1",
				resultSchema: "angelsrest.r6.portfolio-preserved-target-reread-result.v1",
				rawActorsReturnedOrStored: false,
			},
		},
		source: {
			projectId: "n7rvza4g",
			dataset: "production",
			perspective: "published",
			galleryCount: 12,
			placementCount: 294,
			assetCount: 294,
		},
		decisionSet: PORTFOLIO_DECISION_SET,
		preservation: {
			sourceDraft: {
				id: "drafts.70ec23b8-5bed-4db4-ba1b-e86155386b40",
				revision: "60a2d084-8b84-4d89-a2d9-0338c930a8c3",
				changedFields: [],
				disposition: "preserve-source-unmodified",
			},
			preservedTargetGallery,
		},
		transfer: {
			recipe: PORTFOLIO_MEDIA_TRANSFORM_RECIPE,
			query: PORTFOLIO_MEDIA_TRANSFORM_QUERY,
			maximumSizeBytes: PORTFOLIO_MEDIA_MAX_BYTES,
			concurrency: PORTFOLIO_MEDIA_CONCURRENCY,
			publicDerivativeEvidence: {
				requiredForEveryAsset: true,
				receiptSchemaVersion: 2,
				gate: "must-bind-before-per-asset-receipt",
				fields: ["sha256", "sizeBytes", "contentType", "width", "height"],
				derivatives: {
					card: "card.webp",
					display2048: "display-2048.webp",
				},
			},
			canary: {
				sourceAssetRef: PORTFOLIO_MEDIA_CANARY_REF,
				expectedFrameCount: 17,
				expectedFrameDurationMs: 100,
				expectedLoop: "infinite",
				targetPublicDerivatives: ["card", "display2048"],
				gate: "must-pass-before-remaining-assets",
			},
		},
		galleryOrder,
		assets,
		transferOrder: [
			PORTFOLIO_MEDIA_CANARY_REF,
			...assets
				.map((asset) => asset.sourceAsset.id)
				.filter((sourceAssetRef) => sourceAssetRef !== PORTFOLIO_MEDIA_CANARY_REF),
		],
	};
	return { ...payload, planDigest: digestPortfolioMediaPlan(payload) };
}

export function parsePortfolioMediaTransferPlan(value: unknown): PortfolioMediaTransferPlan {
	const root = objectValue(value, "Portfolio media transfer plan");
	const planDigest = stringValue(root.planDigest, "Portfolio media transfer plan digest");
	const { planDigest: _ignored, ...payload } = root;
	if (sha256Bytes(canonicalPortfolioMediaJson(payload)) !== planDigest) {
		throw new Error("Portfolio media transfer plan digest mismatch");
	}
	if (
		root.schema !== "angelsrest.r6.portfolio-media-transfer-plan.v1" ||
		root.operation !== PORTFOLIO_MEDIA_OPERATION ||
		root.siteUrl !== PORTFOLIO_MEDIA_SITE_URL ||
		root.acceptedPlanSha256 !== ACCEPTED_PLAN_SHA256 ||
		canonicalPortfolioMediaJson(root.inventory) !==
			canonicalPortfolioMediaJson({
				files: PORTFOLIO_INVENTORY_FILE_SHA256,
				sourceSchema: "angelsrest.r6.portfolio-sanity-inventory.v1",
				mappingSchema: "angelsrest.r6.portfolio-mapping-candidates.v1",
				targetSchema: "angelsrest.r6.portfolio-target-inventory.v1",
				preservedTargetReread: {
					filesRead: PORTFOLIO_PRESERVED_TARGET_READ_FILE_SHA256,
					evidenceFiles: PORTFOLIO_PRESERVED_TARGET_EVIDENCE_SHA256,
					indexSchema: "angelsrest.r6.portfolio-preserved-target-reread-index.v1",
					resultSchema: "angelsrest.r6.portfolio-preserved-target-reread-result.v1",
					rawActorsReturnedOrStored: false,
				},
			}) ||
		canonicalPortfolioMediaJson(root.decisionSet) !==
			canonicalPortfolioMediaJson(PORTFOLIO_DECISION_SET)
	) {
		throw new Error("Portfolio media transfer plan identity is invalid");
	}
	const assets = arrayValue(root.assets, "Portfolio media transfer assets");
	const transferOrder = arrayValue(root.transferOrder, "Portfolio media transfer order");
	if (
		assets.length !== 294 ||
		transferOrder.length !== 294 ||
		transferOrder[0] !== PORTFOLIO_MEDIA_CANARY_REF ||
		new Set(transferOrder).size !== 294
	) {
		throw new Error("Portfolio media transfer plan asset set is invalid");
	}
	return value as PortfolioMediaTransferPlan;
}
