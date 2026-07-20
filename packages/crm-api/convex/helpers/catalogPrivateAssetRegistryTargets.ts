import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import type {
	CatalogPrivateAssetFacts,
	CatalogPrivateAssetTargetMapping,
} from "./catalogPrivateAssetReceiptContract";
import {
	privateCatalogRegistrationTarget,
	validateCatalogPrivateInspectionReceiptSet,
	validateCatalogPrivateStorageReceiptSet,
} from "./catalogPrivateAssetReceiptValidation";
import {
	type PaidDigitalFileAsset,
	type PrivatePrintSourceAsset,
	validatePaidDigitalFileAsset,
	validatePrivatePrintSourceAsset,
} from "./catalogPrivateAssetValidators";

const STORAGE_ACTOR = "cms-catalog-storage-receipt:v1";
const VERIFICATION_ACTOR = "cms-catalog-evidence-match:v1";

type VerifiedCoordination = Extract<
	Doc<"catalogPrivateAssetReceiptCoordinations">,
	{ status: "verified" }
>;
type PendingCoordination = Exclude<
	Doc<"catalogPrivateAssetReceiptCoordinations">,
	{ status: "verified" }
>;

function isSafeTimestamp(value: number) {
	return Number.isSafeInteger(value) && value >= 0;
}

export function requirePendingPrivateCatalogCoordination(
	coordination: PendingCoordination,
) {
	const receivedAt = coordination.status === "pending_inspection"
		? coordination.storageReceivedAt
		: coordination.inspectionReceivedAt;
	if (
		!isSafeTimestamp(coordination.createdAt)
		|| !isSafeTimestamp(coordination.updatedAt)
		|| !isSafeTimestamp(receivedAt)
		|| coordination.createdAt !== receivedAt
		|| coordination.updatedAt !== receivedAt
	) throw new Error("Private catalog pending coordination audit is corrupt");
}

function requireVerifiedCoordinationAudit(coordination: VerifiedCoordination) {
	const timestamps = [
		coordination.createdAt,
		coordination.updatedAt,
		coordination.storageReceivedAt,
		coordination.inspectionReceivedAt,
		coordination.verifiedAt,
	];
	if (
		timestamps.some((value) => !isSafeTimestamp(value))
		|| coordination.createdAt !== Math.min(
			coordination.storageReceivedAt,
			coordination.inspectionReceivedAt,
		)
		|| coordination.verifiedAt < Math.max(
			coordination.storageReceivedAt,
			coordination.inspectionReceivedAt,
		)
		|| coordination.updatedAt !== coordination.verifiedAt
	) throw new Error("Private catalog verified coordination audit is corrupt");
}

function printAssetValue(asset: Doc<"catalogPrintSourceAssets">): PrivatePrintSourceAsset {
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

function paidAssetValue(asset: Doc<"catalogDigitalFileAssets">): PaidDigitalFileAsset {
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

function canonicalAsset(asset: PrivatePrintSourceAsset | PaidDigitalFileAsset) {
	return {
		siteUrl: asset.siteUrl,
		assetKey: asset.assetKey,
		privateObjectKey: asset.privateObjectKey,
		status: asset.status,
		originalFilename: asset.originalFilename,
		mimeType: asset.mimeType,
		sizeBytes: asset.sizeBytes,
		...(asset.mimeType === "application/zip"
			? { version: asset.version ?? null }
			: { widthPixels: asset.widthPixels, heightPixels: asset.heightPixels }),
		sha256: asset.sha256,
		provenance: asset.provenance,
		createdAt: asset.createdAt,
		createdBy: asset.createdBy,
		verifiedAt: asset.verifiedAt,
		verifiedBy: asset.verifiedBy,
	};
}

function sameAsset(
	left: PrivatePrintSourceAsset | PaidDigitalFileAsset,
	right: PrivatePrintSourceAsset | PaidDigitalFileAsset,
) {
	return JSON.stringify(canonicalAsset(left)) === JSON.stringify(canonicalAsset(right));
}

export async function requireNoPrivateCatalogTargetRows(
	ctx: MutationCtx,
	siteUrl: string,
	facts: readonly CatalogPrivateAssetFacts[],
) {
	for (const asset of facts) {
		const existing = asset.kind === "print_source"
			? await ctx.db.query("catalogPrintSourceAssets")
				.withIndex("by_siteUrl_and_assetKey", (q) =>
					q.eq("siteUrl", siteUrl).eq("assetKey", asset.assetKey)
				)
				.unique()
			: await ctx.db.query("catalogDigitalFileAssets")
				.withIndex("by_siteUrl_and_assetKey", (q) =>
					q.eq("siteUrl", siteUrl).eq("assetKey", asset.assetKey)
				)
				.unique();
		if (existing) {
			throw new Error("Private catalog registry contains uncoordinated target state");
		}
	}
}

export async function insertPrivateCatalogTargetRows(
	ctx: MutationCtx,
	siteUrl: string,
	facts: readonly CatalogPrivateAssetFacts[],
	storageReceivedAt: number,
	verifiedAt: number,
) {
	const targets: CatalogPrivateAssetTargetMapping[] = [];
	for (const item of facts) {
		const target = privateCatalogRegistrationTarget(siteUrl, item, {
			createdAt: storageReceivedAt,
			createdBy: STORAGE_ACTOR,
			verifiedAt,
			verifiedBy: VERIFICATION_ACTOR,
		});
		if (target.kind === "print_source") {
			const assetId = await ctx.db.insert("catalogPrintSourceAssets", target.asset);
			targets.push({ kind: target.kind, assetKey: item.assetKey, assetId });
		} else {
			const assetId = await ctx.db.insert("catalogDigitalFileAssets", target.asset);
			targets.push({ kind: target.kind, assetKey: item.assetKey, assetId });
		}
	}
	return targets;
}

export async function requireVerifiedPrivateCatalogTargets(
	ctx: MutationCtx,
	coordination: VerifiedCoordination,
) {
	requireVerifiedCoordinationAudit(coordination);
	const [storage, inspection] = await Promise.all([
		validateCatalogPrivateStorageReceiptSet(coordination.storageReceiptSet),
		validateCatalogPrivateInspectionReceiptSet(coordination.inspectionReceiptSet),
	]);
	if (
		storage.assetSetChecksum !== coordination.assetSetChecksum
		|| storage.roleChecksum !== coordination.storageReceiptChecksum
		|| inspection.assetSetChecksum !== coordination.assetSetChecksum
		|| inspection.roleChecksum !== coordination.inspectionReceiptChecksum
		|| storage.assetCanonical !== inspection.assetCanonical
		|| coordination.storageReceiptSet.siteUrl !== coordination.siteUrl
		|| coordination.inspectionReceiptSet.siteUrl !== coordination.siteUrl
		|| coordination.storageReceiptSet.receiptSetId !== coordination.receiptSetId
		|| coordination.inspectionReceiptSet.receiptSetId !== coordination.receiptSetId
		|| storage.facts.length !== coordination.targets.length
	) throw new Error("Private catalog verified coordination is corrupt");

	for (let index = 0; index < storage.facts.length; index += 1) {
		const facts = storage.facts[index];
		const mapping = coordination.targets[index];
		if (!facts || !mapping || facts.kind !== mapping.kind || facts.assetKey !== mapping.assetKey) {
			throw new Error("Private catalog verified target mapping is corrupt");
		}
		const expected = privateCatalogRegistrationTarget(coordination.siteUrl, facts, {
			createdAt: coordination.storageReceivedAt,
			createdBy: STORAGE_ACTOR,
			verifiedAt: coordination.verifiedAt,
			verifiedBy: VERIFICATION_ACTOR,
		});
		if (facts.kind === "print_source" && mapping.kind === "print_source") {
			const row = await ctx.db.get(mapping.assetId);
			const indexed = await ctx.db.query("catalogPrintSourceAssets")
				.withIndex("by_siteUrl_and_assetKey", (q) =>
					q.eq("siteUrl", coordination.siteUrl).eq("assetKey", facts.assetKey)
				)
				.unique();
			if (!row || !indexed || indexed._id !== mapping.assetId || expected.kind !== "print_source") {
				throw new Error("Private catalog verified print source is missing or corrupt");
			}
			const value = printAssetValue(row);
			validatePrivatePrintSourceAsset(value);
			if (!sameAsset(value, expected.asset)) {
				throw new Error("Private catalog verified print source has drifted");
			}
			continue;
		}
		if (facts.kind === "paid_digital_file" && mapping.kind === "paid_digital_file") {
			const row = await ctx.db.get(mapping.assetId);
			const indexed = await ctx.db.query("catalogDigitalFileAssets")
				.withIndex("by_siteUrl_and_assetKey", (q) =>
					q.eq("siteUrl", coordination.siteUrl).eq("assetKey", facts.assetKey)
				)
				.unique();
			if (!row || !indexed || indexed._id !== mapping.assetId
				|| expected.kind !== "paid_digital_file") {
				throw new Error("Private catalog verified paid file is missing or corrupt");
			}
			const value = paidAssetValue(row);
			validatePaidDigitalFileAsset(value);
			if (!sameAsset(value, expected.asset)) {
				throw new Error("Private catalog verified paid file has drifted");
			}
			continue;
		}
		throw new Error("Private catalog verified target kind is corrupt");
	}
	return coordination.targets;
}
