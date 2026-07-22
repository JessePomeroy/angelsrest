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
	materializePrivateCatalogV2Targets,
	requireNoPrivateCatalogTargetRows,
	requirePendingPrivateCatalogCoordination,
	requireStoredV2TargetPlan,
	requireVerifiedPrivateCatalogTargets,
	resolvePrivateCatalogV2TargetPlan,
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
		storageReceiptSet.schemaVersion !== inspectionReceiptSet.schemaVersion
		|| storage.assetSetChecksum !== inspection.assetSetChecksum
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
		createdAt: coordination.createdAt,
		updatedAt: now,
	};
	if (storageReceiptSet.schemaVersion === 1) {
		if (inspectionReceiptSet.schemaVersion !== 1) {
			throw new Error("Private catalog receipt schema versions do not match");
		}
		await requireNoPrivateCatalogTargetRows(ctx, coordination.siteUrl, storage.facts);
		const targets = await insertPrivateCatalogTargetRows(
			ctx,
			coordination,
			storage.facts,
			storageReceivedAt,
			now,
		);
		await ctx.db.replace("catalogPrivateAssetReceiptCoordinations", coordination._id, {
			...completed,
			storageReceiptSet,
			inspectionReceiptSet,
			targets,
		});
		return { status: "verified", replayed: false, targets };
	}
	if (inspectionReceiptSet.schemaVersion !== 2) {
		throw new Error("Private catalog receipt schema versions do not match");
	}
	const recomputedPlan = await resolvePrivateCatalogV2TargetPlan(
		ctx,
		coordination.siteUrl,
		storage.facts,
	);
	const targetPlan = requireStoredV2TargetPlan(coordination, recomputedPlan);
	const { targets, targetBindings } = await materializePrivateCatalogV2Targets(
		ctx,
		coordination,
		storage.facts,
		targetPlan,
		storageReceivedAt,
		now,
	);
	await ctx.db.replace("catalogPrivateAssetReceiptCoordinations", coordination._id, {
		...completed,
		storageReceiptSet,
		inspectionReceiptSet,
		targets,
		targetResolutionVersion: 1,
		targetBindings,
	});
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
		const pending = {
			siteUrl: receiptSet.siteUrl,
			receiptSetId: receiptSet.receiptSetId,
			assetSetChecksum: checked.assetSetChecksum,
			status: "pending_inspection" as const,
			storageReceiptChecksum: checked.roleChecksum,
			storageReceivedAt: now,
			createdAt: now,
			updatedAt: now,
		};
		if (receiptSet.schemaVersion === 1) {
			await requireNoPrivateCatalogTargetRows(ctx, receiptSet.siteUrl, checked.facts);
			await ctx.db.insert("catalogPrivateAssetReceiptCoordinations", {
				...pending,
				storageReceiptSet: receiptSet,
			});
		} else {
			const targetPlan = await resolvePrivateCatalogV2TargetPlan(
				ctx,
				receiptSet.siteUrl,
				checked.facts,
			);
			await ctx.db.insert("catalogPrivateAssetReceiptCoordinations", {
				...pending,
				storageReceiptSet: receiptSet,
				targetResolutionVersion: 1,
				targetPlan,
			});
		}
		return pendingResult("pending_inspection", false, checked.facts.length);
	}
	if (coordination.status === "verified") {
		if (
			coordination.storageReceiptSet.schemaVersion !== receiptSet.schemaVersion
			|| coordination.inspectionReceiptSet.schemaVersion !== receiptSet.schemaVersion
			|| coordination.storageReceiptChecksum !== checked.roleChecksum
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
		if (receiptSet.schemaVersion === 1) {
			await requireNoPrivateCatalogTargetRows(ctx, receiptSet.siteUrl, checked.facts);
		} else {
			const recomputedPlan = await resolvePrivateCatalogV2TargetPlan(
				ctx,
				receiptSet.siteUrl,
				checked.facts,
			);
			requireStoredV2TargetPlan(coordination, recomputedPlan);
		}
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
		const pending = {
			siteUrl: receiptSet.siteUrl,
			receiptSetId: receiptSet.receiptSetId,
			assetSetChecksum: checked.assetSetChecksum,
			status: "pending_storage" as const,
			inspectionReceiptChecksum: checked.roleChecksum,
			inspectionReceivedAt: now,
			createdAt: now,
			updatedAt: now,
		};
		if (receiptSet.schemaVersion === 1) {
			await requireNoPrivateCatalogTargetRows(ctx, receiptSet.siteUrl, checked.facts);
			await ctx.db.insert("catalogPrivateAssetReceiptCoordinations", {
				...pending,
				inspectionReceiptSet: receiptSet,
			});
		} else {
			const targetPlan = await resolvePrivateCatalogV2TargetPlan(
				ctx,
				receiptSet.siteUrl,
				checked.facts,
			);
			await ctx.db.insert("catalogPrivateAssetReceiptCoordinations", {
				...pending,
				inspectionReceiptSet: receiptSet,
				targetResolutionVersion: 1,
				targetPlan,
			});
		}
		return pendingResult("pending_storage", false, checked.facts.length);
	}
	if (coordination.status === "verified") {
		if (
			coordination.inspectionReceiptSet.schemaVersion !== receiptSet.schemaVersion
			|| coordination.storageReceiptSet.schemaVersion !== receiptSet.schemaVersion
			|| coordination.inspectionReceiptChecksum !== checked.roleChecksum
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
		if (receiptSet.schemaVersion === 1) {
			await requireNoPrivateCatalogTargetRows(ctx, receiptSet.siteUrl, checked.facts);
		} else {
			const recomputedPlan = await resolvePrivateCatalogV2TargetPlan(
				ctx,
				receiptSet.siteUrl,
				checked.facts,
			);
			requireStoredV2TargetPlan(coordination, recomputedPlan);
		}
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
