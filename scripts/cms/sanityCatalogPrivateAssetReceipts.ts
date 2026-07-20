import { createHash } from "node:crypto";
import {
	type PaidDigitalFileAsset,
	PRIVATE_CATALOG_ASSET_LIMITS,
	type PrivatePrintSourceAsset,
	validatePaidDigitalFileAsset,
	validatePrivatePrintSourceAsset,
} from "../../packages/crm-api/convex/helpers/catalogPrivateAssetValidators";
import type { SanityCatalogImportManifest } from "../../packages/crm-api/convex/helpers/sanityCatalogImport";

const SANITY_IMAGE_REF_PATTERN = /^image-([0-9a-f]{40})-([1-9]\d*)x([1-9]\d*)-(jpg|png)$/;
const SANITY_FILE_REF_PATTERN = /^file-[0-9a-f]{40}-[A-Za-z0-9.]+$/;
const RECEIPT_SET_CHECKSUM_PREFIX = "catalog-private-asset-receipt-set:candidate:v1:";
const PLACEHOLDER_SHA256 = "0".repeat(64);

export const ANGELS_REST_CATALOG_SITE_URL = "angelsrest.online" as const;

export type CatalogPrivateAssetByteEvidence =
	| {
			kind: "print_source";
			sourceAssetRef: string;
			bytes: AsyncIterable<Uint8Array>;
			/** Trusted decoder attestations supplied by the later transfer boundary. */
			observedMimeType: "image/jpeg" | "image/png";
			observedWidthPixels: number;
			observedHeightPixels: number;
	  }
	| {
			kind: "paid_digital_file";
			sourceAssetRef: string;
			bytes: AsyncIterable<Uint8Array>;
			/** Trusted MIME attestation supplied by the later transfer boundary. */
			observedMimeType: "application/zip";
	  };

export type CatalogPrivatePrintSourceReceipt = {
	kind: "print_source";
	sourceAssetRef: string;
	/** Validator-approved candidate metadata; not proof of upload or registration. */
	target: PrivatePrintSourceAsset;
};

export type CatalogPrivatePaidFileReceipt = {
	kind: "paid_digital_file";
	sourceAssetRef: string;
	/** Validator-approved candidate metadata; not proof of upload or registration. */
	target: PaidDigitalFileAsset;
};

export type CatalogPrivateAssetReceipt =
	| CatalogPrivatePrintSourceReceipt
	| CatalogPrivatePaidFileReceipt;

export type SanityCatalogPrivateAssetReceiptCandidate = {
	schemaVersion: 1;
	siteUrl: string;
	receipts: CatalogPrivateAssetReceipt[];
};

export type SanityCatalogPrivateAssetReceiptSet = SanityCatalogPrivateAssetReceiptCandidate & {
	/** Candidate integrity only; this is not an import, release, or authorization digest. */
	candidateChecksum: string;
};

type ExpectedPrintSource = {
	kind: "print_source";
	sourceAssetRef: string;
	sourceAssetId: string;
	sourceAssetRevision: string;
	originalFilename: string;
	mimeType: "image/jpeg" | "image/png";
	widthPixels: number;
	heightPixels: number;
};

type ExpectedPaidFile = {
	kind: "paid_digital_file";
	sourceAssetRef: string;
	sourceAssetId: string;
	sourceAssetRevision: string;
	originalFilename: string;
	mimeType: string;
	sizeBytes: number;
	version?: string;
};

type ExpectedPrivateAsset = ExpectedPrintSource | ExpectedPaidFile;

function evidenceKey(kind: CatalogPrivateAssetReceipt["kind"], sourceAssetRef: string) {
	return `${kind}:${sourceAssetRef}`;
}

function compareReceiptIdentity(
	left: Pick<CatalogPrivateAssetReceipt, "kind" | "sourceAssetRef">,
	right: Pick<CatalogPrivateAssetReceipt, "kind" | "sourceAssetRef">,
) {
	const kindOrder = { print_source: 0, paid_digital_file: 1 } as const;
	return (
		kindOrder[left.kind] - kindOrder[right.kind] ||
		compareOrdinal(left.sourceAssetRef, right.sourceAssetRef)
	);
}

function compareOrdinal(left: string, right: string) {
	return left < right ? -1 : left > right ? 1 : 0;
}

function imageFacts(sourceAssetRef: string) {
	const match = SANITY_IMAGE_REF_PATTERN.exec(sourceAssetRef);
	if (!match) {
		throw new Error(
			`Print source ${sourceAssetRef} is not a canonical Sanity JPEG or PNG reference`,
		);
	}
	const [, assetId, widthText, heightText, extension] = match;
	const widthPixels = Number(widthText);
	const heightPixels = Number(heightText);
	if (!Number.isSafeInteger(widthPixels) || !Number.isSafeInteger(heightPixels)) {
		throw new Error(`Print source ${sourceAssetRef} has unsafe image dimensions`);
	}
	return {
		originalFilename: `${assetId}-${widthPixels}x${heightPixels}.${extension}`,
		mimeType: extension === "jpg" ? ("image/jpeg" as const) : ("image/png" as const),
		widthPixels,
		heightPixels,
	};
}

function sameExpectedAsset(left: ExpectedPrivateAsset, right: ExpectedPrivateAsset) {
	if (
		left.kind !== right.kind ||
		left.sourceAssetRef !== right.sourceAssetRef ||
		left.sourceAssetId !== right.sourceAssetId ||
		left.sourceAssetRevision !== right.sourceAssetRevision
	) {
		return false;
	}
	if (left.kind === "print_source" && right.kind === "print_source") {
		return (
			left.originalFilename === right.originalFilename &&
			left.mimeType === right.mimeType &&
			left.widthPixels === right.widthPixels &&
			left.heightPixels === right.heightPixels
		);
	}
	if (left.kind === "paid_digital_file" && right.kind === "paid_digital_file") {
		return (
			left.originalFilename === right.originalFilename &&
			left.mimeType === right.mimeType &&
			left.sizeBytes === right.sizeBytes &&
			left.version === right.version
		);
	}
	return false;
}

function requiredPrivateAssets(manifest: SanityCatalogImportManifest) {
	if (manifest.version !== 1) throw new Error("Unsupported Sanity catalog manifest version");
	const hasBlockingIssue =
		manifest.issues.some((issue) => issue.severity === "error") ||
		manifest.products.some((product) => product.issues.some((issue) => issue.severity === "error"));
	if (hasBlockingIssue) {
		throw new Error("Private-asset receipts require a ready Sanity catalog manifest");
	}

	const expectedByKey = new Map<string, ExpectedPrivateAsset>();
	const kindByRef = new Map<string, ExpectedPrivateAsset["kind"]>();
	const addExpected = (expected: ExpectedPrivateAsset) => {
		const previousKind = kindByRef.get(expected.sourceAssetRef);
		if (previousKind && previousKind !== expected.kind) {
			throw new Error(`Manifest cross-wires ${expected.sourceAssetRef} across private asset kinds`);
		}
		kindByRef.set(expected.sourceAssetRef, expected.kind);
		const key = evidenceKey(expected.kind, expected.sourceAssetRef);
		const previous = expectedByKey.get(key);
		if (previous && !sameExpectedAsset(previous, expected)) {
			throw new Error(
				`Repeated manifest reference ${expected.sourceAssetRef} has conflicting facts`,
			);
		}
		expectedByKey.set(key, expected);
	};

	for (const product of manifest.products) {
		if (product.kind === "unsupported") {
			throw new Error("Private-asset receipts require only supported catalog products");
		}
		for (const placement of product.media) {
			if (!placement.printSource) continue;
			if (product.kind !== "print" && product.kind !== "print_set") {
				throw new Error(`Product ${product.productKey} cross-wires a print-source placement`);
			}
			if (placement.sourceAssetId !== placement.sourceAssetRef) {
				throw new Error(
					`Print source ${placement.sourceAssetRef} disagrees with its manifest asset ID`,
				);
			}
			addExpected({
				kind: "print_source",
				sourceAssetRef: placement.sourceAssetRef,
				sourceAssetId: placement.sourceAssetId,
				sourceAssetRevision: placement.sourceAssetRevision,
				...imageFacts(placement.sourceAssetRef),
			});
		}
		if (product.digitalFile) {
			if (product.kind !== "digital_download") {
				throw new Error(`Product ${product.productKey} cross-wires a paid digital file`);
			}
			if (!SANITY_FILE_REF_PATTERN.test(product.digitalFile.sourceFileRef)) {
				throw new Error(
					`Paid file ${product.digitalFile.sourceFileRef} is not a canonical Sanity file reference`,
				);
			}
			if (product.digitalFile.sourceAssetId !== product.digitalFile.sourceFileRef) {
				throw new Error(
					`Paid file ${product.digitalFile.sourceFileRef} disagrees with its manifest asset ID`,
				);
			}
			addExpected({
				kind: "paid_digital_file",
				sourceAssetRef: product.digitalFile.sourceFileRef,
				sourceAssetId: product.digitalFile.sourceAssetId,
				sourceAssetRevision: product.digitalFile.sourceAssetRevision,
				originalFilename: product.digitalFile.originalFilename,
				mimeType: product.digitalFile.mimeType,
				sizeBytes: product.digitalFile.sizeBytes,
				...(product.digitalFile.version === undefined
					? {}
					: { version: product.digitalFile.version }),
			});
		}
	}
	if (expectedByKey.size === 0) {
		throw new Error("Sanity catalog manifest requires no private assets to receipt");
	}
	return { expectedByKey, kindByRef };
}

export async function hashCatalogPrivateAssetByteStream(
	bytes: AsyncIterable<Uint8Array>,
	maximumSizeBytes: number,
) {
	if (!Number.isSafeInteger(maximumSizeBytes) || maximumSizeBytes <= 0) {
		throw new Error("Private-asset byte limit must be a positive safe integer");
	}
	const hash = createHash("sha256");
	let sizeBytes = 0;
	for await (const chunk of bytes) {
		if (!(chunk instanceof Uint8Array)) {
			throw new Error("Private-asset byte evidence must yield Uint8Array chunks");
		}
		if (chunk.byteLength === 0) {
			throw new Error("Private-asset byte evidence cannot contain empty chunks");
		}
		if (chunk.byteLength > maximumSizeBytes - sizeBytes) {
			throw new Error("Private-asset byte evidence exceeds its bounded size");
		}
		sizeBytes += chunk.byteLength;
		hash.update(chunk);
	}
	if (sizeBytes === 0) throw new Error("Private-asset byte evidence cannot be empty");
	return { sizeBytes, sha256: hash.digest("hex") };
}

function canonicalTarget(target: PrivatePrintSourceAsset | PaidDigitalFileAsset) {
	return {
		siteUrl: target.siteUrl,
		assetKey: target.assetKey,
		privateObjectKey: target.privateObjectKey,
		status: target.status,
		originalFilename: target.originalFilename,
		mimeType: target.mimeType,
		sizeBytes: target.sizeBytes,
		...(target.mimeType === "application/zip"
			? { version: target.version ?? null }
			: {
					widthPixels: target.widthPixels,
					heightPixels: target.heightPixels,
				}),
		sha256: target.sha256,
		provenance: {
			provider: target.provenance.provider,
			sourceId: target.provenance.sourceId,
			...(target.provenance.provider === "sanity"
				? { sourceRevision: target.provenance.sourceRevision }
				: {}),
		},
		createdAt: target.createdAt,
		createdBy: target.createdBy,
		verifiedAt: target.verifiedAt,
		verifiedBy: target.verifiedBy,
	};
}

function commonTargetCandidate(
	expected: ExpectedPrivateAsset,
	context: { siteUrl: string; recordedAt: number; actorIdentity: string },
) {
	return {
		siteUrl: context.siteUrl,
		assetKey: expected.sourceAssetId,
		status: "verified" as const,
		provenance: {
			provider: "sanity" as const,
			sourceId: expected.sourceAssetId,
			sourceRevision: expected.sourceAssetRevision,
		},
		createdAt: context.recordedAt,
		createdBy: context.actorIdentity,
		verifiedAt: context.recordedAt,
		verifiedBy: context.actorIdentity,
	};
}

function validateStaticTargetCandidate(
	expected: ExpectedPrivateAsset,
	item: CatalogPrivateAssetByteEvidence,
	context: { siteUrl: string; recordedAt: number; actorIdentity: string },
) {
	const common = commonTargetCandidate(expected, context);
	if (expected.kind === "print_source" && item.kind === "print_source") {
		if (
			item.observedMimeType !== expected.mimeType ||
			item.observedWidthPixels !== expected.widthPixels ||
			item.observedHeightPixels !== expected.heightPixels
		) {
			throw new Error(
				`Observed metadata differs from canonical Sanity print source ${expected.sourceAssetRef}`,
			);
		}
		validatePrivatePrintSourceAsset({
			...common,
			privateObjectKey: `sites/${context.siteUrl}/catalog/print-sources/${expected.sourceAssetId}/original`,
			originalFilename: expected.originalFilename,
			mimeType: expected.mimeType,
			sizeBytes: 1,
			widthPixels: expected.widthPixels,
			heightPixels: expected.heightPixels,
			sha256: PLACEHOLDER_SHA256,
		});
		return;
	}
	if (expected.kind === "paid_digital_file" && item.kind === "paid_digital_file") {
		if (expected.mimeType !== "application/zip" || item.observedMimeType !== expected.mimeType) {
			throw new Error(
				`Observed MIME type differs from Sanity paid file ${expected.sourceAssetRef}`,
			);
		}
		validatePaidDigitalFileAsset({
			...common,
			privateObjectKey: `sites/${context.siteUrl}/catalog/paid-digital-files/${expected.sourceAssetId}/original`,
			originalFilename: expected.originalFilename,
			mimeType: "application/zip",
			sizeBytes: expected.sizeBytes,
			sha256: PLACEHOLDER_SHA256,
			...(expected.version === undefined ? {} : { version: expected.version }),
		});
		return;
	}
	throw new Error(`Byte evidence cross-wires ${expected.sourceAssetRef}`);
}

/** Fixed-field serialization; injected byte streams and transport authority are never retained. */
function serializeSanityCatalogPrivateAssetReceiptCandidate(
	candidate: SanityCatalogPrivateAssetReceiptCandidate,
) {
	const receipts = [...candidate.receipts].sort(compareReceiptIdentity).map((receipt) => ({
		kind: receipt.kind,
		sourceAssetRef: receipt.sourceAssetRef,
		target: canonicalTarget(receipt.target),
	}));
	return `${RECEIPT_SET_CHECKSUM_PREFIX}${JSON.stringify({
		schemaVersion: 1,
		siteUrl: candidate.siteUrl,
		receipts,
	})}`;
}

/**
 * Builds non-authorizing candidate metadata from one-shot byte evidence. The later
 * transfer boundary must attest the observations and re-hash/upload these same
 * immutable bytes; neither the site nor actor fields grant registration authority.
 */
export async function createSanityCatalogPrivateAssetReceiptSet({
	manifest,
	evidence,
	siteUrl,
	recordedAt,
	actorIdentity,
}: {
	manifest: SanityCatalogImportManifest;
	evidence: readonly CatalogPrivateAssetByteEvidence[];
	siteUrl: string;
	recordedAt: number;
	actorIdentity: string;
}): Promise<SanityCatalogPrivateAssetReceiptSet> {
	if (siteUrl !== ANGELS_REST_CATALOG_SITE_URL) {
		throw new Error(`Catalog receipt candidates are fixed to ${ANGELS_REST_CATALOG_SITE_URL}`);
	}
	const { expectedByKey, kindByRef } = requiredPrivateAssets(manifest);
	const evidenceByKey = new Map<string, CatalogPrivateAssetByteEvidence>();
	for (const item of evidence) {
		const key = evidenceKey(item.kind, item.sourceAssetRef);
		if (evidenceByKey.has(key)) {
			throw new Error(`Duplicate byte evidence for ${item.sourceAssetRef}`);
		}
		if (!expectedByKey.has(key)) {
			if (kindByRef.has(item.sourceAssetRef)) {
				throw new Error(`Byte evidence cross-wires ${item.sourceAssetRef} to the wrong asset kind`);
			}
			throw new Error(`Byte evidence contains extra source ${item.sourceAssetRef}`);
		}
		evidenceByKey.set(key, item);
	}
	const missing = [...expectedByKey.keys()].filter((key) => !evidenceByKey.has(key));
	if (missing.length > 0) {
		throw new Error(`Byte evidence is missing ${missing.sort(compareOrdinal)[0]}`);
	}
	const sortedExpected = [...expectedByKey.values()].sort(compareReceiptIdentity);
	const context = { siteUrl, recordedAt, actorIdentity };
	for (const expected of sortedExpected) {
		const item = evidenceByKey.get(evidenceKey(expected.kind, expected.sourceAssetRef));
		if (!item) throw new Error(`Byte evidence is missing ${expected.sourceAssetRef}`);
		validateStaticTargetCandidate(expected, item, context);
	}

	const receipts: CatalogPrivateAssetReceipt[] = [];
	for (const expected of sortedExpected) {
		const item = evidenceByKey.get(evidenceKey(expected.kind, expected.sourceAssetRef));
		if (!item || item.kind !== expected.kind) {
			throw new Error(`Byte evidence is missing ${expected.sourceAssetRef}`);
		}
		const common = commonTargetCandidate(expected, context);
		if (expected.kind === "print_source" && item.kind === "print_source") {
			const measured = await hashCatalogPrivateAssetByteStream(
				item.bytes,
				PRIVATE_CATALOG_ASSET_LIMITS.printSourceSizeBytes,
			);
			const target: PrivatePrintSourceAsset = {
				...common,
				privateObjectKey: `sites/${siteUrl}/catalog/print-sources/${expected.sourceAssetId}/original`,
				originalFilename: expected.originalFilename,
				mimeType: expected.mimeType,
				sizeBytes: measured.sizeBytes,
				widthPixels: expected.widthPixels,
				heightPixels: expected.heightPixels,
				sha256: measured.sha256,
			};
			validatePrivatePrintSourceAsset(target);
			receipts.push({ kind: expected.kind, sourceAssetRef: expected.sourceAssetRef, target });
			continue;
		}
		if (expected.kind === "paid_digital_file" && item.kind === "paid_digital_file") {
			const measured = await hashCatalogPrivateAssetByteStream(
				item.bytes,
				PRIVATE_CATALOG_ASSET_LIMITS.paidDigitalFileSizeBytes,
			);
			if (measured.sizeBytes !== expected.sizeBytes) {
				throw new Error(`Paid-file byte count differs from ${expected.sourceAssetRef}`);
			}
			const target: PaidDigitalFileAsset = {
				...common,
				privateObjectKey: `sites/${siteUrl}/catalog/paid-digital-files/${expected.sourceAssetId}/original`,
				originalFilename: expected.originalFilename,
				mimeType: "application/zip",
				sizeBytes: measured.sizeBytes,
				sha256: measured.sha256,
				...(expected.version === undefined ? {} : { version: expected.version }),
			};
			validatePaidDigitalFileAsset(target);
			receipts.push({ kind: expected.kind, sourceAssetRef: expected.sourceAssetRef, target });
			continue;
		}
		throw new Error(`Byte evidence cross-wires ${expected.sourceAssetRef}`);
	}

	const candidate: SanityCatalogPrivateAssetReceiptCandidate = {
		schemaVersion: 1,
		siteUrl,
		receipts: receipts.sort(compareReceiptIdentity),
	};
	return {
		...candidate,
		candidateChecksum: createHash("sha256")
			.update(serializeSanityCatalogPrivateAssetReceiptCandidate(candidate))
			.digest("hex"),
	};
}
