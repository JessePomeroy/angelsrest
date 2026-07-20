import {
	type PaidDigitalFileAsset,
	PRIVATE_CATALOG_ASSET_LIMITS,
	type PrivatePrintSourceAsset,
	validatePaidDigitalFileAsset,
	validatePrivatePrintSourceAsset,
} from "./catalogPrivateAssetValidators";
import type {
	CatalogPrivateAssetFacts,
	CatalogPrivateInspectionReceiptSet,
	CatalogPrivateStorageReceiptSet,
} from "./catalogPrivateAssetReceiptContract";
import { CATALOG_PRIVATE_ASSET_RECEIPT_SET_VERSION } from "./catalogPrivateAssetReceiptContract";

const RECEIPT_SET_MAX_ASSETS = 32;
const RECEIPT_SET_ID_MAX_LENGTH = 160;
const RECEIPT_SET_ID_PATTERN = /^[A-Za-z0-9]+(?:[._:-][A-Za-z0-9]+)*$/;
export const CATALOG_PRIVATE_ASSET_RECEIPT_SET_ID_PREFIX = "catalog-private-assets-v1";
const ETAG_MAX_LENGTH = 256;
const ZIP_ENTRY_MAX = 10_000;
const ZIP_COMPRESSION_RATIO_MAX = 1_000;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;

type RegistrationAudit = {
	createdAt: number;
	createdBy: string;
	verifiedAt: number;
	verifiedBy: string;
};

export type CatalogPrivateAssetRegistrationTarget =
	| { kind: "print_source"; asset: PrivatePrintSourceAsset }
	| { kind: "paid_digital_file"; asset: PaidDigitalFileAsset };

function compareOrdinal(left: string, right: string) {
	return left < right ? -1 : left > right ? 1 : 0;
}

function compareFacts(left: CatalogPrivateAssetFacts, right: CatalogPrivateAssetFacts) {
	const kindOrder = { print_source: 0, paid_digital_file: 1 } as const;
	return kindOrder[left.kind] - kindOrder[right.kind]
		|| compareOrdinal(left.assetKey, right.assetKey);
}

function canonicalProvenance(provenance: CatalogPrivateAssetFacts["provenance"]) {
	return provenance.provider === "sanity"
		? {
				provider: provenance.provider,
				sourceId: provenance.sourceId,
				sourceRevision: provenance.sourceRevision,
			}
		: { provider: provenance.provider, sourceId: provenance.sourceId };
}

function canonicalFacts(facts: CatalogPrivateAssetFacts) {
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
		provenance: canonicalProvenance(facts.provenance),
	};
}

function canonicalAssetSetIdentity(
	receiptSet: Pick<CatalogPrivateStorageReceiptSet, "schemaVersion" | "siteUrl">,
	facts: readonly CatalogPrivateAssetFacts[],
) {
	return {
		schemaVersion: receiptSet.schemaVersion,
		siteUrl: receiptSet.siteUrl,
		assets: [...facts].sort(compareFacts).map(canonicalFacts),
	};
}

function canonicalReceiptSetIdentity(
	receiptSet: Pick<CatalogPrivateStorageReceiptSet, "schemaVersion" | "receiptSetId" | "siteUrl">,
	facts: readonly CatalogPrivateAssetFacts[],
) {
	return {
		...canonicalAssetSetIdentity(receiptSet, facts),
		receiptSetId: receiptSet.receiptSetId,
	};
}

function canonicalStorageReceiptSet(receiptSet: CatalogPrivateStorageReceiptSet) {
	return {
		...canonicalReceiptSetIdentity(
			receiptSet,
			receiptSet.receipts.map((receipt) => receipt.facts),
		),
		receipts: receiptSet.receipts.map((receipt) => ({
			facts: canonicalFacts(receipt.facts),
			uploadedAt: receipt.uploadedAt,
			etag: receipt.etag,
		})),
	};
}

function canonicalInspectionReceiptSet(receiptSet: CatalogPrivateInspectionReceiptSet) {
	return {
		...canonicalReceiptSetIdentity(
			receiptSet,
			receiptSet.receipts.map((receipt) => receipt.facts),
		),
		receipts: receiptSet.receipts.map((receipt) => ({
			facts: canonicalFacts(receipt.facts),
			inspection: receipt.inspection.method === "decoded_image_v1"
				? { method: receipt.inspection.method }
				: {
						method: receipt.inspection.method,
						entryCount: receipt.inspection.entryCount,
						totalUncompressedBytes: receipt.inspection.totalUncompressedBytes,
						maximumEntryCompressionRatio:
							receipt.inspection.maximumEntryCompressionRatio,
						encryptedEntryCount: receipt.inspection.encryptedEntryCount,
						unsafePathCount: receipt.inspection.unsafePathCount,
						duplicatePathCount: receipt.inspection.duplicatePathCount,
					},
		})),
	};
}

async function sha256(value: string) {
	const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
	return [...new Uint8Array(bytes)]
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}

async function assetSetIdentity(
	receiptSet: Pick<CatalogPrivateStorageReceiptSet, "schemaVersion" | "siteUrl">,
	facts: readonly CatalogPrivateAssetFacts[],
) {
	const canonical = JSON.stringify(canonicalAssetSetIdentity(receiptSet, facts));
	const checksum = await sha256(`catalog-private-asset-set:v1:${canonical}`);
	return {
		canonical,
		checksum,
		receiptSetId: `${CATALOG_PRIVATE_ASSET_RECEIPT_SET_ID_PREFIX}:${checksum}`,
	};
}

export async function createCatalogPrivateAssetReceiptSetId(
	siteUrl: string,
	facts: readonly CatalogPrivateAssetFacts[],
) {
	// Content addressing prevents a partial or drifted batch from claiming a reviewed set's ID.
	return (await assetSetIdentity({
		schemaVersion: CATALOG_PRIVATE_ASSET_RECEIPT_SET_VERSION,
		siteUrl,
	}, facts)).receiptSetId;
}

function requireReceiptSetIdentity(
	receiptSet: Pick<
		CatalogPrivateStorageReceiptSet,
		"schemaVersion" | "receiptSetId" | "siteUrl"
	>,
) {
	if (
		receiptSet.schemaVersion !== CATALOG_PRIVATE_ASSET_RECEIPT_SET_VERSION
		|| receiptSet.receiptSetId.length > RECEIPT_SET_ID_MAX_LENGTH
		|| !RECEIPT_SET_ID_PATTERN.test(receiptSet.receiptSetId)
	) throw new Error("Private catalog receipt-set identity is invalid");
}

function requireCanonicalIsoTimestamp(value: string) {
	if (value.length > 32) throw new Error("Private catalog upload timestamp is invalid");
	const parsed = new Date(value);
	if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString() !== value) {
		throw new Error("Private catalog upload timestamp is invalid");
	}
}

function requireBoundedEtag(value: string) {
	if (
		value.length === 0
		|| value.length > ETAG_MAX_LENGTH
		|| value !== value.trim()
		|| CONTROL_CHARACTER_PATTERN.test(value)
	) throw new Error("Private catalog storage ETag is invalid");
}

function requireReceiptFacts(
	siteUrl: string,
	receipts: readonly { facts: CatalogPrivateAssetFacts }[],
) {
	if (receipts.length === 0 || receipts.length > RECEIPT_SET_MAX_ASSETS) {
		throw new Error(`Private catalog receipt sets require 1-${RECEIPT_SET_MAX_ASSETS} assets`);
	}
	const facts = receipts.map((receipt) => receipt.facts);
	const assetKeys = new Set<string>();
	for (let index = 0; index < facts.length; index += 1) {
		const current = facts[index];
		if (!current) throw new Error("Private catalog receipt set is incomplete");
		if (assetKeys.has(current.assetKey)) {
			throw new Error("Private catalog receipt-set asset keys must be unique across kinds");
		}
		assetKeys.add(current.assetKey);
		privateCatalogRegistrationTarget(siteUrl, current, {
			createdAt: 0,
			createdBy: "catalog-receipt-contract:v1",
			verifiedAt: 0,
			verifiedBy: "catalog-receipt-contract:v1",
		});
		const previous = facts[index - 1];
		if (previous && compareFacts(previous, current) >= 0) {
			throw new Error("Private catalog receipts must be unique and canonically ordered");
		}
	}
	return facts;
}

function requirePositiveSafeInteger(value: number, maximum: number, field: string) {
	if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
		throw new Error(`${field} must be a bounded positive safe integer`);
	}
}

function requireSafeZipInspection(
	inspection: Extract<
		CatalogPrivateInspectionReceiptSet["receipts"][number],
		{ facts: { kind: "paid_digital_file" } }
	>["inspection"],
) {
	requirePositiveSafeInteger(inspection.entryCount, ZIP_ENTRY_MAX, "ZIP entry count");
	requirePositiveSafeInteger(
		inspection.totalUncompressedBytes,
		PRIVATE_CATALOG_ASSET_LIMITS.paidDigitalFileSizeBytes,
		"ZIP uncompressed byte count",
	);
	if (
		!Number.isFinite(inspection.maximumEntryCompressionRatio)
		|| inspection.maximumEntryCompressionRatio < 1
		|| inspection.maximumEntryCompressionRatio > ZIP_COMPRESSION_RATIO_MAX
	) throw new Error("ZIP compression ratio is outside the safe inspection policy");
	for (const count of [
		inspection.encryptedEntryCount,
		inspection.unsafePathCount,
		inspection.duplicatePathCount,
	]) {
		if (count !== 0) throw new Error("ZIP inspection contains an unsafe entry");
	}
}

export function privateCatalogRegistrationTarget(
	siteUrl: string,
	facts: CatalogPrivateAssetFacts,
	audit: RegistrationAudit,
): CatalogPrivateAssetRegistrationTarget {
	const common = {
		siteUrl,
		assetKey: facts.assetKey,
		privateObjectKey: facts.privateObjectKey,
		status: "verified" as const,
		originalFilename: facts.originalFilename,
		mimeType: facts.mimeType,
		sizeBytes: facts.sizeBytes,
		sha256: facts.sha256,
		provenance: facts.provenance,
		...audit,
	};
	if (facts.kind === "print_source") {
		const asset: PrivatePrintSourceAsset = {
			...common,
			mimeType: facts.mimeType,
			widthPixels: facts.widthPixels,
			heightPixels: facts.heightPixels,
		};
		validatePrivatePrintSourceAsset(asset);
		if (
			(asset.mimeType === "image/jpeg" && !/\.jpe?g$/i.test(asset.originalFilename))
			|| (asset.mimeType === "image/png" && !/\.png$/i.test(asset.originalFilename))
		) throw new Error("Private print-source filename does not match its MIME type");
		return { kind: facts.kind, asset };
	}
	const asset: PaidDigitalFileAsset = {
		...common,
		mimeType: facts.mimeType,
		...(facts.version === undefined ? {} : { version: facts.version }),
	};
	validatePaidDigitalFileAsset(asset);
	return { kind: facts.kind, asset };
}

export async function validateCatalogPrivateStorageReceiptSet(
	receiptSet: CatalogPrivateStorageReceiptSet,
) {
	requireReceiptSetIdentity(receiptSet);
	const facts = requireReceiptFacts(receiptSet.siteUrl, receiptSet.receipts);
	for (const receipt of receiptSet.receipts) {
		requireCanonicalIsoTimestamp(receipt.uploadedAt);
		requireBoundedEtag(receipt.etag);
	}
	const assetSet = await assetSetIdentity(receiptSet, facts);
	if (receiptSet.receiptSetId !== assetSet.receiptSetId) {
		throw new Error("Private catalog receipt-set identity does not match its asset set");
	}
	const roleCanonical = canonicalStorageReceiptSet(receiptSet);
	return {
		facts,
		assetSetChecksum: assetSet.checksum,
		roleChecksum: await sha256(`catalog-private-storage-receipt:v1:${JSON.stringify(roleCanonical)}`),
		assetCanonical: assetSet.canonical,
		canonical: JSON.stringify(roleCanonical),
	};
}

export async function validateCatalogPrivateInspectionReceiptSet(
	receiptSet: CatalogPrivateInspectionReceiptSet,
) {
	requireReceiptSetIdentity(receiptSet);
	const facts = requireReceiptFacts(receiptSet.siteUrl, receiptSet.receipts);
	for (const receipt of receiptSet.receipts) {
		if (receipt.facts.kind === "paid_digital_file") {
			if (receipt.inspection.method !== "safe_zip_v1") {
				throw new Error("Paid digital files require the safe ZIP inspection policy");
			}
			requireSafeZipInspection(receipt.inspection);
		} else if (receipt.inspection.method !== "decoded_image_v1") {
			throw new Error("Private print sources require decoded image inspection");
		}
	}
	const assetSet = await assetSetIdentity(receiptSet, facts);
	if (receiptSet.receiptSetId !== assetSet.receiptSetId) {
		throw new Error("Private catalog receipt-set identity does not match its asset set");
	}
	const roleCanonical = canonicalInspectionReceiptSet(receiptSet);
	return {
		facts,
		assetSetChecksum: assetSet.checksum,
		roleChecksum: await sha256(`catalog-private-inspection-receipt:v1:${JSON.stringify(roleCanonical)}`),
		assetCanonical: assetSet.canonical,
		canonical: JSON.stringify(roleCanonical),
	};
}

export function sameCatalogPrivateStorageReceiptSet(
	left: CatalogPrivateStorageReceiptSet,
	right: CatalogPrivateStorageReceiptSet,
) {
	return JSON.stringify(canonicalStorageReceiptSet(left))
		=== JSON.stringify(canonicalStorageReceiptSet(right));
}

export function sameCatalogPrivateInspectionReceiptSet(
	left: CatalogPrivateInspectionReceiptSet,
	right: CatalogPrivateInspectionReceiptSet,
) {
	return JSON.stringify(canonicalInspectionReceiptSet(left))
		=== JSON.stringify(canonicalInspectionReceiptSet(right));
}
