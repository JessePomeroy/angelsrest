import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import type {
	CatalogPrivateAssetFacts,
	CatalogPrivateInspectionReceiptSet,
	CatalogPrivateStorageReceiptSet,
} from "./catalogPrivateAssetReceiptContract";
import {
	createCatalogPrivateAssetReceiptSetId,
	validateCatalogPrivateInspectionReceiptSet,
	validateCatalogPrivateStorageReceiptSet,
} from "./catalogPrivateAssetReceiptValidation";

const SITE_URL = "angelsrest.online";
const V1_RECEIPT_SET_ID =
	"catalog-private-assets-v1:e8d573e1558301bfb52fc108baf227d6d74e4e7fbbc0228d2829ded3d32ac63b";
const EXPECTED_SHARP_VERSION = "0.35.3";
const EXPECTED_LIBVIPS_VERSION = "8.18.3";

export type CatalogPrivateAssetCanaryExpectation = {
	siteUrl: string;
	v1ReceiptSetId: string;
	selected: readonly {
		label: "jpeg" | "oversized_png" | "paid_zip";
		kind: "print_source" | "paid_digital_file";
		assetKey: string;
		targetId: string;
	}[];
	expectedSharpVersion: string;
	expectedLibvipsVersion: string;
};

export const CATALOG_PRIVATE_ASSET_CANARY_EXPECTATION = {
	siteUrl: SITE_URL,
	v1ReceiptSetId: V1_RECEIPT_SET_ID,
	selected: [
		{
			label: "jpeg",
			kind: "print_source",
			assetKey: "image-1382b9d3b95996a2d7f612c7d1943f1c63dcb695-2160x1440-jpg",
			targetId: "q970hm4246ek96y29w5hrsjkvh8axepc",
		},
		{
			label: "oversized_png",
			kind: "print_source",
			assetKey: "image-4eb6f607de53cc329dafa75645ce38b96459d010-6935x4623-png",
			targetId: "q97em2xrgehs2gg4jmeajgmj9n8awazy",
		},
		{
			label: "paid_zip",
			kind: "paid_digital_file",
			assetKey: "file-69ddd31ce4d9f51c978074210560e7249fe7e42f-zip",
			targetId: "q57679yxvbbbkz74563mvg34gn8axprw",
		},
	] as const,
	expectedSharpVersion: EXPECTED_SHARP_VERSION,
	expectedLibvipsVersion: EXPECTED_LIBVIPS_VERSION,
} satisfies CatalogPrivateAssetCanaryExpectation;

async function requireCanaryReceiptIdentity(
	ctx: QueryCtx,
	receiptSet: Pick<CatalogPrivateStorageReceiptSet, "schemaVersion" | "siteUrl" | "receiptSetId">,
	expectation: CatalogPrivateAssetCanaryExpectation,
) {
	if (receiptSet.schemaVersion !== 2 || receiptSet.siteUrl !== expectation.siteUrl) return;
	const snapshot = await createCatalogPrivateAssetV2CanarySnapshot(ctx, expectation);
	if (receiptSet.receiptSetId !== snapshot.canary.receiptSetId) {
		throw new Error("Angels Rest V2 receipt identity differs from the acceptance canary");
	}
}

export async function requireCatalogPrivateAssetV2CanaryStorageReceipt(
	ctx: QueryCtx,
	receiptSet: CatalogPrivateStorageReceiptSet,
	expectation: CatalogPrivateAssetCanaryExpectation = CATALOG_PRIVATE_ASSET_CANARY_EXPECTATION,
) {
	await requireCanaryReceiptIdentity(ctx, receiptSet, expectation);
}

export async function requireCatalogPrivateAssetV2CanaryInspectionReceipt(
	ctx: QueryCtx,
	receiptSet: CatalogPrivateInspectionReceiptSet,
	expectation: CatalogPrivateAssetCanaryExpectation = CATALOG_PRIVATE_ASSET_CANARY_EXPECTATION,
) {
	await requireCanaryReceiptIdentity(ctx, receiptSet, expectation);
	if (receiptSet.schemaVersion !== 2 || receiptSet.siteUrl !== expectation.siteUrl) return;
	const printReceipts = receiptSet.receipts.filter((receipt) =>
		receipt.facts.kind === "print_source"
	);
	if (
		printReceipts.length !== 2 ||
		printReceipts.some(
			(receipt) =>
				receipt.inspection.method !== "sharp_libvips_full_raster_v1" ||
				receipt.inspection.sharpVersion !== expectation.expectedSharpVersion ||
				receipt.inspection.libvipsVersion !== expectation.expectedLibvipsVersion,
		)
	) {
		throw new Error("Angels Rest V2 receipt decoder versions differ from the acceptance canary");
	}
}

const LIMITS = {
	coordinations: 2,
	authorities: 12,
	printTargets: 11,
	paidTargets: 1,
	products: 40,
	revisions: 40,
	variants: 100,
	mediaPlacements: 50,
	printSources: 20,
	setMembers: 10,
	digitalFiles: 5,
	shopPlacements: 40,
} as const;

function normalize(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(normalize);
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value as Record<string, unknown>)
				.sort(([left], [right]) => left.localeCompare(right))
				.map(([key, item]) => [key, normalize(item)]),
		);
	}
	return value;
}

function canonical(value: unknown) {
	return JSON.stringify(normalize(value));
}

async function digest(domain: string, value: unknown) {
	const bytes = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(`${domain}\u0000${canonical(value)}`),
	);
	return [...new Uint8Array(bytes)]
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}

function bounded<T>(rows: T[], limit: number, label: string) {
	if (rows.length > limit) throw new Error(`${label} exceeds the V2 canary snapshot bound`);
	return rows;
}

function same(left: unknown, right: unknown) {
	return canonical(left) === canonical(right);
}

function immutableFacts(facts: CatalogPrivateAssetFacts) {
	return {
		kind: facts.kind,
		assetKey: facts.assetKey,
		privateObjectKey: facts.privateObjectKey,
		originalFilename: facts.originalFilename,
		mimeType: facts.mimeType,
		sizeBytes: facts.sizeBytes,
		...(facts.kind === "print_source"
			? { widthPixels: facts.widthPixels, heightPixels: facts.heightPixels }
			: { version: facts.version ?? null }),
		sha256: facts.sha256,
		provenance: facts.provenance,
	};
}

function registryImmutableFacts(
	target: Doc<"catalogPrintSourceAssets"> | Doc<"catalogDigitalFileAssets">,
	kind: CatalogPrivateAssetFacts["kind"],
) {
	return {
		kind,
		assetKey: target.assetKey,
		privateObjectKey: target.privateObjectKey,
		originalFilename: target.originalFilename,
		mimeType: target.mimeType,
		sizeBytes: target.sizeBytes,
		...(kind === "print_source" && "widthPixels" in target
			? { widthPixels: target.widthPixels, heightPixels: target.heightPixels }
			: { version: "version" in target ? target.version ?? null : null }),
		sha256: target.sha256,
		provenance: target.provenance,
	};
}

function mappingFor(
	coordination: Extract<Doc<"catalogPrivateAssetReceiptCoordinations">, { status: "verified" }>,
	facts: CatalogPrivateAssetFacts,
) {
	const index = coordination.storageReceiptSet.receipts.findIndex((receipt) =>
		receipt.facts.kind === facts.kind && receipt.facts.assetKey === facts.assetKey
	);
	const mapping = coordination.targets[index];
	if (!mapping || mapping.kind !== facts.kind || mapping.assetKey !== facts.assetKey) {
		throw new Error("V1 canary target mapping is missing or corrupt");
	}
	return mapping;
}

async function readState(ctx: QueryCtx, siteUrl: string) {
	const [
		coordinations,
		authorities,
		printTargets,
		paidTargets,
		products,
		revisions,
		variants,
		mediaPlacements,
		printSources,
		setMembers,
		digitalFiles,
		shopPlacements,
	] = await Promise.all([
		ctx.db.query("catalogPrivateAssetReceiptCoordinations")
			.withIndex("by_siteUrl_and_receiptSetId", (q) => q.eq("siteUrl", siteUrl))
			.take(LIMITS.coordinations + 1),
		ctx.db.query("catalogPrivateAssetTargetAuthorities")
			.withIndex("by_siteUrl_and_kind_and_assetKey", (q) => q.eq("siteUrl", siteUrl))
			.take(LIMITS.authorities + 1),
		ctx.db.query("catalogPrintSourceAssets")
			.withIndex("by_siteUrl_and_createdAt", (q) => q.eq("siteUrl", siteUrl))
			.take(LIMITS.printTargets + 1),
		ctx.db.query("catalogDigitalFileAssets")
			.withIndex("by_siteUrl_and_createdAt", (q) => q.eq("siteUrl", siteUrl))
			.take(LIMITS.paidTargets + 1),
		ctx.db.query("catalogProducts")
			.withIndex("by_siteUrl_and_productKey", (q) => q.eq("siteUrl", siteUrl))
			.take(LIMITS.products + 1),
		ctx.db.query("catalogProductRevisions")
			.withIndex("by_siteUrl_and_productId", (q) => q.eq("siteUrl", siteUrl))
			.take(LIMITS.revisions + 1),
		ctx.db.query("catalogProductVariants")
			.withIndex("by_siteUrl", (q) => q.eq("siteUrl", siteUrl))
			.take(LIMITS.variants + 1),
		ctx.db.query("catalogProductMediaPlacements")
			.withIndex("by_siteUrl_and_assetId", (q) => q.eq("siteUrl", siteUrl))
			.take(LIMITS.mediaPlacements + 1),
		ctx.db.query("catalogProductPrintSources")
			.withIndex("by_siteUrl_and_assetId", (q) => q.eq("siteUrl", siteUrl))
			.take(LIMITS.printSources + 1),
		ctx.db.query("catalogProductSetMembers")
			.withIndex("by_siteUrl", (q) => q.eq("siteUrl", siteUrl))
			.take(LIMITS.setMembers + 1),
		ctx.db.query("catalogProductDigitalFiles")
			.withIndex("by_siteUrl_and_assetId", (q) => q.eq("siteUrl", siteUrl))
			.take(LIMITS.digitalFiles + 1),
		ctx.db.query("catalogProductShopPlacements")
			.withIndex("by_siteUrl", (q) => q.eq("siteUrl", siteUrl))
			.take(LIMITS.shopPlacements + 1),
	]);
	return {
		coordinations: bounded(coordinations, LIMITS.coordinations, "Receipt coordination table"),
		authorities: bounded(authorities, LIMITS.authorities, "Target authority table"),
		printTargets: bounded(printTargets, LIMITS.printTargets, "Print target table"),
		paidTargets: bounded(paidTargets, LIMITS.paidTargets, "Paid target table"),
		products: bounded(products, LIMITS.products, "Catalog product table"),
		revisions: bounded(revisions, LIMITS.revisions, "Catalog revision table"),
		variants: bounded(variants, LIMITS.variants, "Catalog variant table"),
		mediaPlacements: bounded(mediaPlacements, LIMITS.mediaPlacements, "Catalog media table"),
		printSources: bounded(printSources, LIMITS.printSources, "Catalog print relation table"),
		setMembers: bounded(setMembers, LIMITS.setMembers, "Catalog set-member table"),
		digitalFiles: bounded(digitalFiles, LIMITS.digitalFiles, "Catalog digital relation table"),
		shopPlacements: bounded(shopPlacements, LIMITS.shopPlacements, "Catalog shop table"),
	};
}

export async function createCatalogPrivateAssetV2CanarySnapshot(
	ctx: QueryCtx,
	expectation: CatalogPrivateAssetCanaryExpectation = CATALOG_PRIVATE_ASSET_CANARY_EXPECTATION,
) {
	if (expectation.selected.length !== 3 || new Set(expectation.selected.map((item) => item.targetId)).size !== 3) {
		throw new Error("V2 canary expectation is invalid");
	}
	const state = await readState(ctx, expectation.siteUrl);
	if (state.printTargets.length !== 11 || state.paidTargets.length !== 1) {
		throw new Error("Private catalog target baseline is not exactly 11+1");
	}
	if (state.authorities.length !== 0 && state.authorities.length !== 12) {
		throw new Error("Private catalog V1 authority baseline is partial");
	}
	const v1 = state.coordinations.find((row) => row.receiptSetId === expectation.v1ReceiptSetId);
	if (
		!v1 || v1.status !== "verified" || v1.storageReceiptSet.schemaVersion !== 1
		|| v1.inspectionReceiptSet.schemaVersion !== 1 || v1.targets.length !== 12
		|| new Set(v1.targets.map((target) => target.assetId)).size !== 12
		|| ![v1.createdAt, v1.updatedAt, v1.storageReceivedAt, v1.inspectionReceivedAt, v1.verifiedAt]
			.every((timestamp) => Number.isSafeInteger(timestamp) && timestamp >= 0)
		|| v1.createdAt !== Math.min(v1.storageReceivedAt, v1.inspectionReceivedAt)
		|| v1.updatedAt !== v1.verifiedAt
	) throw new Error("Exact verified V1 coordination is missing");
	const [v1Storage, v1Inspection] = await Promise.all([
		validateCatalogPrivateStorageReceiptSet(v1.storageReceiptSet),
		validateCatalogPrivateInspectionReceiptSet(v1.inspectionReceiptSet),
	]);
	if (v1Storage.assetCanonical !== v1Inspection.assetCanonical || v1Storage.facts.length !== 12) {
		throw new Error("Exact V1 coordination evidence is corrupt");
	}

	const selectedFacts = expectation.selected.map((selected) => {
		const facts = v1Storage.facts.find((item) =>
			item.kind === selected.kind && item.assetKey === selected.assetKey
		);
		if (!facts) throw new Error("V2 canary source is absent from the exact V1 coordination");
		const mapping = mappingFor(v1, facts);
		if (mapping.assetId !== selected.targetId) {
			throw new Error("V2 canary stable target differs from the reviewed journal");
		}
		return facts;
	});
	const pngFacts = selectedFacts[1];
	if (
		!pngFacts || pngFacts.kind !== "print_source" || pngFacts.mimeType !== "image/png"
		|| pngFacts.sizeBytes !== 55_009_177 || pngFacts.widthPixels !== 6_935
		|| pngFacts.heightPixels !== 4_623
	) throw new Error("Recorded oversized PNG facts have drifted");

	for (const facts of v1Storage.facts) {
		const mapping = mappingFor(v1, facts);
		const target = facts.kind === "print_source"
			? state.printTargets.find((row) => row._id === mapping.assetId)
			: state.paidTargets.find((row) => row._id === mapping.assetId);
		if (!target || !same(immutableFacts(facts), registryImmutableFacts(target, facts.kind))) {
			throw new Error("V1 registry target is missing or has drifted");
		}
	}

	if (state.authorities.length === 12) {
		for (const facts of v1Storage.facts) {
			const mapping = mappingFor(v1, facts);
			const authority = state.authorities.find((row) =>
				row.kind === facts.kind && row.assetKey === facts.assetKey
			);
			if (
				!authority || authority.assetId !== mapping.assetId
				|| authority.originCoordinationId !== v1._id
				|| authority.originReceiptSetId !== expectation.v1ReceiptSetId
				|| authority.originSchemaVersion !== 1
				|| !Number.isSafeInteger(authority.indexedAt) || authority.indexedAt < 0
			) throw new Error("V1 target authority is conflicting or corrupt");
		}
	}

	const v2ReceiptSetId = await createCatalogPrivateAssetReceiptSetId(
		expectation.siteUrl,
		selectedFacts,
		2,
	);
	const v2 = state.coordinations.find((row) => row.receiptSetId === v2ReceiptSetId) ?? null;
	if (state.coordinations.some((row) => row._id !== v1._id && row._id !== v2?._id)) {
		throw new Error("A conflicting private catalog coordination exists");
	}
	if (v2?.status === "pending_storage") {
		throw new Error("Inspection-first V2 coordination is outside the canary state machine");
	}
	if (v2?.status === "pending_inspection") {
		if (
			v2.storageReceiptSet.schemaVersion !== 2 || !("targetPlan" in v2)
			|| v2.targetResolutionVersion !== 1 || v2.targetPlan?.length !== 3
			|| v2.createdAt !== v2.storageReceivedAt || v2.updatedAt !== v2.storageReceivedAt
		) throw new Error("Pending V2 canary coordination is incomplete");
		const storage = await validateCatalogPrivateStorageReceiptSet(v2.storageReceiptSet);
		if (storage.facts.length !== selectedFacts.length) {
			throw new Error("Pending V2 canary storage evidence has drifted");
		}
		for (let index = 0; index < storage.facts.length; index += 1) {
			const actual = storage.facts[index];
			const expected = selectedFacts[index];
			if (!actual || !expected || !same(immutableFacts(actual), immutableFacts(expected))) {
				throw new Error("Pending V2 canary storage evidence has drifted");
			}
		}
		for (let index = 0; index < selectedFacts.length; index += 1) {
			const facts = selectedFacts[index];
			const plan = v2.targetPlan[index];
			if (
				!facts || !plan || plan.kind !== facts.kind || plan.assetKey !== facts.assetKey
				|| plan.resolution !== "reuse_v1" || plan.assetId !== expectation.selected[index]?.targetId
				|| plan.originCoordinationId !== v1._id
				|| plan.originReceiptSetId !== expectation.v1ReceiptSetId
			) throw new Error("Pending V2 canary target plan has drifted");
		}
	}

	let evidence: null | {
		fullRaster: true;
		safeZip: true;
		sharpVersion: string;
		libvipsVersion: string;
	} = null;
	if (v2?.status === "verified") {
		if (
			v2.storageReceiptSet.schemaVersion !== 2 || v2.inspectionReceiptSet.schemaVersion !== 2
			|| v2.targets.length !== 3 || !("targetBindings" in v2)
			|| v2.targetResolutionVersion !== 1 || v2.targetBindings?.length !== 3
		) throw new Error("Verified V2 canary coordination is incomplete");
		const [storage, inspection] = await Promise.all([
			validateCatalogPrivateStorageReceiptSet(v2.storageReceiptSet),
			validateCatalogPrivateInspectionReceiptSet(v2.inspectionReceiptSet),
		]);
		if (storage.assetCanonical !== inspection.assetCanonical) {
			throw new Error("V2 canary role evidence differs");
		}
		for (let index = 0; index < selectedFacts.length; index += 1) {
			const facts = selectedFacts[index];
			const mapping = v2.targets[index];
			const binding = v2.targetBindings[index];
			if (
				!facts || !mapping || !binding || mapping.kind !== facts.kind
				|| mapping.assetKey !== facts.assetKey
				|| mapping.assetId !== expectation.selected[index]?.targetId
				|| binding.assetId !== mapping.assetId || binding.resolution !== "reused_v1"
				|| binding.originCoordinationId !== v1._id
				|| binding.originReceiptSetId !== expectation.v1ReceiptSetId
			) throw new Error("V2 canary did not reuse the exact V1 stable targets");
		}
		const printEvidence = v2.inspectionReceiptSet.receipts.filter((receipt) =>
			receipt.facts.kind === "print_source"
		);
		const zipEvidence = v2.inspectionReceiptSet.receipts.find((receipt) =>
			receipt.facts.kind === "paid_digital_file"
		);
		if (
			printEvidence.length !== 2
			|| printEvidence.some((receipt) =>
				receipt.inspection.method !== "sharp_libvips_full_raster_v1"
				|| receipt.inspection.sharpVersion !== expectation.expectedSharpVersion
				|| receipt.inspection.libvipsVersion !== expectation.expectedLibvipsVersion
			)
			|| !zipEvidence || zipEvidence.inspection.method !== "safe_zip_v1"
			|| zipEvidence.inspection.encryptedEntryCount !== 0
			|| zipEvidence.inspection.unsafePathCount !== 0
			|| zipEvidence.inspection.duplicatePathCount !== 0
		) throw new Error("V2 canary inspection evidence is invalid");
		evidence = {
			fullRaster: true,
			safeZip: true,
			sharpVersion: expectation.expectedSharpVersion,
			libvipsVersion: expectation.expectedLibvipsVersion,
		};
	}

	const publicationPointers = state.products.filter((product) =>
		product.publishedRevisionId !== undefined || product.publishedAt !== undefined
		|| product.publishedBy !== undefined
	);
	const counts = {
		receiptCoordinations: state.coordinations.length,
		authorities: state.authorities.length,
		printTargets: state.printTargets.length,
		paidTargets: state.paidTargets.length,
		products: state.products.length,
		revisions: state.revisions.length,
		variants: state.variants.length,
		mediaPlacements: state.mediaPlacements.length,
		printSources: state.printSources.length,
		setMembers: state.setMembers.length,
		digitalFiles: state.digitalFiles.length,
		shopPlacements: state.shopPlacements.length,
		publicationPointers: publicationPointers.length,
	};
	const timestamps = state.coordinations.map((row) => ({
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		...(row.status === "pending_inspection"
			? { storageReceivedAt: row.storageReceivedAt }
			: row.status === "pending_storage"
				? { inspectionReceivedAt: row.inspectionReceivedAt }
				: {
					storageReceivedAt: row.storageReceivedAt,
					inspectionReceivedAt: row.inspectionReceivedAt,
					verifiedAt: row.verifiedAt,
				}),
	}));
	return {
		schemaVersion: 1 as const,
		canary: {
			receiptSetId: v2ReceiptSetId,
			targets: expectation.selected.map(({ label, kind, targetId }) => ({ label, kind, targetId })),
			oversizedPng: { sizeBytes: pngFacts.sizeBytes, widthPixels: pngFacts.widthPixels, heightPixels: pngFacts.heightPixels },
		},
		v2: { status: v2?.status ?? "absent", evidence },
		counts,
		digests: {
			receipts: await digest("catalog-v2-canary:receipts:v1", state.coordinations.map((row) => ({
				receiptSetId: row.receiptSetId,
				storage: "storageReceiptSet" in row ? row.storageReceiptSet : null,
				inspection: "inspectionReceiptSet" in row ? row.inspectionReceiptSet : null,
			}))),
			coordinations: await digest("catalog-v2-canary:coordinations:v1", state.coordinations),
			timestamps: await digest("catalog-v2-canary:timestamps:v1", timestamps),
			authorities: await digest("catalog-v2-canary:authorities:v1", state.authorities),
			registryTargets: await digest("catalog-v2-canary:registry-targets:v1", [state.printTargets, state.paidTargets]),
			products: await digest("catalog-v2-canary:products:v1", state.products),
			revisions: await digest("catalog-v2-canary:revisions:v1", state.revisions),
			variants: await digest("catalog-v2-canary:variants:v1", state.variants),
			mediaPlacements: await digest("catalog-v2-canary:media:v1", state.mediaPlacements),
			printSources: await digest("catalog-v2-canary:print-relations:v1", state.printSources),
			setMembers: await digest("catalog-v2-canary:set-members:v1", state.setMembers),
			digitalFiles: await digest("catalog-v2-canary:digital-relations:v1", state.digitalFiles),
			shopPlacements: await digest("catalog-v2-canary:shop-placements:v1", state.shopPlacements),
			publicationPointers: await digest("catalog-v2-canary:publication-pointers:v1", publicationPointers),
		},
	};
}
