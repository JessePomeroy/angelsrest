import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import {
	type CatalogPrivateAssetTargetMapping,
	type CatalogPrivateInspectionReceiptSet,
	type CatalogPrivateStorageReceiptSet,
} from "./catalogPrivateAssetReceiptContract";
import {
	sameCatalogPrivateInspectionReceiptSet,
	sameCatalogPrivateStorageReceiptSet,
	validateCatalogPrivateInspectionReceiptSet,
	validateCatalogPrivateStorageReceiptSet,
} from "./catalogPrivateAssetReceiptValidation";
import {
	insertPrivateCatalogTargetRows,
	requireNoPrivateCatalogTargetRows,
	requirePendingPrivateCatalogCoordination,
	requireVerifiedPrivateCatalogTargets,
} from "./catalogPrivateAssetRegistryTargets";

type Coordination = Doc<"catalogPrivateAssetReceiptCoordinations">;

type SafeRegistrationResult =
	| {
			status: "pending_inspection" | "pending_storage";
			replayed: boolean;
			assetCount: number;
	  }
	| {
			status: "verified";
			replayed: boolean;
			targets: CatalogPrivateAssetTargetMapping[];
	  };

async function getCoordination(
	ctx: MutationCtx,
	siteUrl: string,
	receiptSetId: string,
) {
	return await ctx.db
		.query("catalogPrivateAssetReceiptCoordinations")
		.withIndex("by_siteUrl_and_receiptSetId", (q) =>
			q.eq("siteUrl", siteUrl).eq("receiptSetId", receiptSetId)
		)
		.unique();
}

function pendingResult(
	status: "pending_inspection" | "pending_storage",
	replayed: boolean,
	assetCount: number,
): SafeRegistrationResult {
	return { status, replayed, assetCount };
}

async function verifiedResult(
	ctx: MutationCtx,
	coordination: Extract<Coordination, { status: "verified" }>,
	replayed: boolean,
): Promise<SafeRegistrationResult> {
	return {
		status: "verified",
		replayed,
		targets: await requireVerifiedPrivateCatalogTargets(ctx, coordination),
	};
}

async function completeRegistration(
	ctx: MutationCtx,
	coordination: Exclude<Coordination, { status: "verified" }>,
	storageReceiptSet: CatalogPrivateStorageReceiptSet,
	inspectionReceiptSet: CatalogPrivateInspectionReceiptSet,
	storageReceivedAt: number,
	inspectionReceivedAt: number,
	now: number,
): Promise<SafeRegistrationResult> {
	requirePendingPrivateCatalogCoordination(coordination);
	const [storage, inspection] = await Promise.all([
		validateCatalogPrivateStorageReceiptSet(storageReceiptSet),
		validateCatalogPrivateInspectionReceiptSet(inspectionReceiptSet),
	]);
	if (
		storage.assetSetChecksum !== inspection.assetSetChecksum
		|| storage.assetCanonical !== inspection.assetCanonical
		|| storage.assetSetChecksum !== coordination.assetSetChecksum
		|| storageReceiptSet.siteUrl !== inspectionReceiptSet.siteUrl
		|| storageReceiptSet.siteUrl !== coordination.siteUrl
		|| storageReceiptSet.receiptSetId !== inspectionReceiptSet.receiptSetId
		|| storageReceiptSet.receiptSetId !== coordination.receiptSetId
		|| (coordination.status === "pending_inspection"
			&& coordination.storageReceiptChecksum !== storage.roleChecksum)
		|| (coordination.status === "pending_storage"
			&& coordination.inspectionReceiptChecksum !== inspection.roleChecksum)
	) throw new Error("Private catalog storage and inspection evidence do not match");
	await requireNoPrivateCatalogTargetRows(ctx, coordination.siteUrl, storage.facts);
	const targets = await insertPrivateCatalogTargetRows(
		ctx,
		coordination.siteUrl,
		storage.facts,
		storageReceivedAt,
		now,
	);
	const completed = {
		siteUrl: coordination.siteUrl,
		receiptSetId: coordination.receiptSetId,
		assetSetChecksum: storage.assetSetChecksum,
		status: "verified" as const,
		storageReceiptChecksum: storage.roleChecksum,
		inspectionReceiptChecksum: inspection.roleChecksum,
		storageReceivedAt,
		inspectionReceivedAt,
		verifiedAt: now,
		storageReceiptSet,
		inspectionReceiptSet,
		targets,
		createdAt: coordination.createdAt,
		updatedAt: now,
	};
	await ctx.db.replace("catalogPrivateAssetReceiptCoordinations", coordination._id, completed);
	return { status: "verified", replayed: false, targets };
}

export async function recordCatalogPrivateStorageReceiptSet(
	ctx: MutationCtx,
	receiptSet: CatalogPrivateStorageReceiptSet,
): Promise<SafeRegistrationResult> {
	const checked = await validateCatalogPrivateStorageReceiptSet(receiptSet);
	const now = Date.now();
	const coordination = await getCoordination(ctx, receiptSet.siteUrl, receiptSet.receiptSetId);
	if (!coordination) {
		await requireNoPrivateCatalogTargetRows(ctx, receiptSet.siteUrl, checked.facts);
		await ctx.db.insert("catalogPrivateAssetReceiptCoordinations", {
			siteUrl: receiptSet.siteUrl,
			receiptSetId: receiptSet.receiptSetId,
			assetSetChecksum: checked.assetSetChecksum,
			status: "pending_inspection",
			storageReceiptChecksum: checked.roleChecksum,
			storageReceivedAt: now,
			storageReceiptSet: receiptSet,
			createdAt: now,
			updatedAt: now,
		});
		return pendingResult("pending_inspection", false, checked.facts.length);
	}
	if (coordination.status === "verified") {
		if (
			coordination.storageReceiptChecksum !== checked.roleChecksum
			|| !sameCatalogPrivateStorageReceiptSet(coordination.storageReceiptSet, receiptSet)
		) throw new Error("Private catalog storage receipt replay has drifted");
		return await verifiedResult(ctx, coordination, true);
	}
	requirePendingPrivateCatalogCoordination(coordination);
	if (coordination.status === "pending_inspection") {
		if (
			coordination.assetSetChecksum !== checked.assetSetChecksum
			|| coordination.storageReceiptChecksum !== checked.roleChecksum
			|| !sameCatalogPrivateStorageReceiptSet(coordination.storageReceiptSet, receiptSet)
		) throw new Error("Private catalog storage receipt replay has drifted");
		await requireNoPrivateCatalogTargetRows(ctx, receiptSet.siteUrl, checked.facts);
		return pendingResult(coordination.status, true, checked.facts.length);
	}
	return await completeRegistration(
		ctx,
		coordination,
		receiptSet,
		coordination.inspectionReceiptSet,
		now,
		coordination.inspectionReceivedAt,
		now,
	);
}

export async function recordCatalogPrivateInspectionReceiptSet(
	ctx: MutationCtx,
	receiptSet: CatalogPrivateInspectionReceiptSet,
): Promise<SafeRegistrationResult> {
	const checked = await validateCatalogPrivateInspectionReceiptSet(receiptSet);
	const now = Date.now();
	const coordination = await getCoordination(ctx, receiptSet.siteUrl, receiptSet.receiptSetId);
	if (!coordination) {
		await requireNoPrivateCatalogTargetRows(ctx, receiptSet.siteUrl, checked.facts);
		await ctx.db.insert("catalogPrivateAssetReceiptCoordinations", {
			siteUrl: receiptSet.siteUrl,
			receiptSetId: receiptSet.receiptSetId,
			assetSetChecksum: checked.assetSetChecksum,
			status: "pending_storage",
			inspectionReceiptChecksum: checked.roleChecksum,
			inspectionReceivedAt: now,
			inspectionReceiptSet: receiptSet,
			createdAt: now,
			updatedAt: now,
		});
		return pendingResult("pending_storage", false, checked.facts.length);
	}
	if (coordination.status === "verified") {
		if (
			coordination.inspectionReceiptChecksum !== checked.roleChecksum
			|| !sameCatalogPrivateInspectionReceiptSet(coordination.inspectionReceiptSet, receiptSet)
		) throw new Error("Private catalog inspection receipt replay has drifted");
		return await verifiedResult(ctx, coordination, true);
	}
	requirePendingPrivateCatalogCoordination(coordination);
	if (coordination.status === "pending_storage") {
		if (
			coordination.assetSetChecksum !== checked.assetSetChecksum
			|| coordination.inspectionReceiptChecksum !== checked.roleChecksum
			|| !sameCatalogPrivateInspectionReceiptSet(coordination.inspectionReceiptSet, receiptSet)
		) throw new Error("Private catalog inspection receipt replay has drifted");
		await requireNoPrivateCatalogTargetRows(ctx, receiptSet.siteUrl, checked.facts);
		return pendingResult(coordination.status, true, checked.facts.length);
	}
	return await completeRegistration(
		ctx,
		coordination,
		coordination.storageReceiptSet,
		receiptSet,
		coordination.storageReceivedAt,
		now,
		now,
	);
}
