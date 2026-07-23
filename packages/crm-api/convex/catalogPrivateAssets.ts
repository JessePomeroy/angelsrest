import { v } from "convex/values";
import type { MutationCtx } from "./_generated/server";
import { internalMutation, internalQuery, query } from "./_generated/server";
import { requireSiteAdmin } from "./authHelpers";
import {
	CATALOG_PRIVATE_ASSET_CANARY_EXPECTATION,
	createCatalogPrivateAssetV2CanarySnapshot,
	requireCatalogPrivateAssetV2CanaryInspectionReceipt,
	requireCatalogPrivateAssetV2CanaryStorageReceipt,
} from "./helpers/catalogPrivateAssetCanarySnapshot";
import {
	catalogPrivateEditorReceiptError,
	isCatalogPrivateEditorExpectedValidationError,
} from "./helpers/catalogPrivateAssetEditorErrors";
import {
	type CatalogPrivateInspectionReceiptSet,
	type CatalogPrivateStorageReceiptSet,
	catalogPrivateInspectionReceiptSetValidator,
	catalogPrivateStorageReceiptSetValidator,
} from "./helpers/catalogPrivateAssetReceiptContract";
import {
	CATALOG_PRIVATE_EDITOR_OPERATION_ID_PATTERN,
	claimsCatalogPrivateEditorOperation,
	sameCatalogPrivateInspectionReceiptSet,
	sameCatalogPrivateStorageReceiptSet,
	validateCatalogPrivateEditorInspectionReceiptSet,
	validateCatalogPrivateEditorStorageReceiptSet,
} from "./helpers/catalogPrivateAssetReceiptValidation";
import {
	recordCatalogPrivateInspectionReceiptSet,
	recordCatalogPrivateStorageReceiptSet,
} from "./helpers/catalogPrivateAssetRegistry";
import {
	backfillPrivateCatalogTargetAuthorities,
	requireVerifiedPrivateCatalogTargets,
} from "./helpers/catalogPrivateAssetRegistryTargets";
import {
	toEditorSafePaidDigitalFileAsset,
	toEditorSafePrivatePrintSourceAsset,
} from "./helpers/catalogPrivateAssetValidators";
import { requireCatalogProductKindEnabled } from "./helpers/catalogProductPolicy";
import { catalogProductKindValidator } from "./helpers/catalogProductValidators";

function editorAdmissionResult(
	result: Awaited<ReturnType<typeof recordCatalogPrivateStorageReceiptSet>>,
) {
	return {
		status: result.status,
		replayed: result.replayed,
		assetCount: result.status === "verified" ? 1 : result.assetCount,
	};
}

type CheckedEditorReceipt =
	| Awaited<ReturnType<typeof validateCatalogPrivateEditorStorageReceiptSet>>
	| Awaited<ReturnType<typeof validateCatalogPrivateEditorInspectionReceiptSet>>;

async function bindEditorOperation(
	ctx: MutationCtx,
	receiptSet: CatalogPrivateStorageReceiptSet | CatalogPrivateInspectionReceiptSet,
	checked: CheckedEditorReceipt,
) {
	const { operation } = checked;
	// Convex tracks this indexed read and the insert in one mutation transaction.
	// Concurrent snapshots that both observe no binding conflict under OCC and are
	// retried against the winner before any coordination or target write commits.
	const existing = await ctx.db
		.query("catalogPrivateAssetEditorOperations")
		.withIndex("by_siteUrl_and_operationId", (q) =>
			q.eq("siteUrl", receiptSet.siteUrl).eq("operationId", operation.operationId),
		)
		.unique();
	const binding = {
		siteUrl: receiptSet.siteUrl,
		operationId: operation.operationId,
		sourceId: operation.sourceId,
		receiptSetId: receiptSet.receiptSetId,
		assetSetChecksum: checked.assetSetChecksum,
		kind: operation.kind,
		assetKey: operation.assetKey,
		privateObjectKey: operation.privateObjectKey,
	};
	if (!existing) {
		await ctx.db.insert("catalogPrivateAssetEditorOperations", {
			...binding,
			createdAt: Date.now(),
		});
		return;
	}
	if (
		existing.siteUrl !== binding.siteUrl ||
		existing.operationId !== binding.operationId ||
		existing.sourceId !== binding.sourceId ||
		existing.receiptSetId !== binding.receiptSetId ||
		existing.assetSetChecksum !== binding.assetSetChecksum ||
		existing.kind !== binding.kind ||
		existing.assetKey !== binding.assetKey ||
		existing.privateObjectKey !== binding.privateObjectKey
	)
		throw catalogPrivateEditorReceiptError("conflict");
}

async function requireNoEditorRoleDrift(
	ctx: MutationCtx,
	receiptSet: CatalogPrivateStorageReceiptSet | CatalogPrivateInspectionReceiptSet,
	checked: CheckedEditorReceipt,
	role: "storage" | "inspection",
) {
	const coordination = await ctx.db
		.query("catalogPrivateAssetReceiptCoordinations")
		.withIndex("by_siteUrl_and_receiptSetId", (q) =>
			q.eq("siteUrl", receiptSet.siteUrl).eq("receiptSetId", receiptSet.receiptSetId),
		)
		.unique();
	if (!coordination) return;
	if (coordination.assetSetChecksum !== checked.assetSetChecksum) {
		throw catalogPrivateEditorReceiptError("conflict");
	}
	if (
		role === "storage" &&
		"storageReceiptSet" in coordination &&
		!sameCatalogPrivateStorageReceiptSet(
			coordination.storageReceiptSet,
			receiptSet as CatalogPrivateStorageReceiptSet,
		)
	)
		throw catalogPrivateEditorReceiptError("conflict");
	if (
		role === "inspection" &&
		"inspectionReceiptSet" in coordination &&
		!sameCatalogPrivateInspectionReceiptSet(
			coordination.inspectionReceiptSet,
			receiptSet as CatalogPrivateInspectionReceiptSet,
		)
	)
		throw catalogPrivateEditorReceiptError("conflict");
}

async function validateEditorStorageReceipt(receiptSet: CatalogPrivateStorageReceiptSet) {
	try {
		return await validateCatalogPrivateEditorStorageReceiptSet(receiptSet);
	} catch (error) {
		if (!isCatalogPrivateEditorExpectedValidationError(error)) throw error;
		throw catalogPrivateEditorReceiptError("validation");
	}
}

async function validateEditorInspectionReceipt(receiptSet: CatalogPrivateInspectionReceiptSet) {
	try {
		return await validateCatalogPrivateEditorInspectionReceiptSet(receiptSet);
	} catch (error) {
		if (!isCatalogPrivateEditorExpectedValidationError(error)) throw error;
		throw catalogPrivateEditorReceiptError("validation");
	}
}

async function admitEditorStorageReceipt(
	ctx: MutationCtx,
	receiptSet: CatalogPrivateStorageReceiptSet,
) {
	const checked = await validateEditorStorageReceipt(receiptSet);
	await bindEditorOperation(ctx, receiptSet, checked);
	await requireNoEditorRoleDrift(ctx, receiptSet, checked, "storage");
}

async function admitEditorInspectionReceipt(
	ctx: MutationCtx,
	receiptSet: CatalogPrivateInspectionReceiptSet,
) {
	const checked = await validateEditorInspectionReceipt(receiptSet);
	await bindEditorOperation(ctx, receiptSet, checked);
	await requireNoEditorRoleDrift(ctx, receiptSet, checked, "inspection");
}

async function admitHistoricalEditorStorageReceipt(
	ctx: MutationCtx,
	receiptSet: CatalogPrivateStorageReceiptSet,
) {
	if (claimsCatalogPrivateEditorOperation(receiptSet)) {
		await admitEditorStorageReceipt(ctx, receiptSet);
	}
}

async function admitHistoricalEditorInspectionReceipt(
	ctx: MutationCtx,
	receiptSet: CatalogPrivateInspectionReceiptSet,
) {
	if (claimsCatalogPrivateEditorOperation(receiptSet)) {
		await admitEditorInspectionReceipt(ctx, receiptSet);
	}
}

/** Acceptance-only, bounded and redacted production state projection. */
export const getV2CanarySnapshot = internalQuery({
	args: {},
	handler: async (ctx) => await createCatalogPrivateAssetV2CanarySnapshot(ctx),
});

/** Bounded operator backfill; empty args select only the acceptance canary's exact V1 set. */
export const backfillTargetAuthorities = internalMutation({
	args: { siteUrl: v.optional(v.string()), receiptSetId: v.optional(v.string()) },
	handler: async (ctx, { siteUrl, receiptSetId }) => {
		if ((siteUrl === undefined) !== (receiptSetId === undefined)) {
			throw new Error("Private catalog authority backfill identity is incomplete");
		}
		return await backfillPrivateCatalogTargetAuthorities(
			ctx,
			siteUrl ?? CATALOG_PRIVATE_ASSET_CANARY_EXPECTATION.siteUrl,
			receiptSetId ?? CATALOG_PRIVATE_ASSET_CANARY_EXPECTATION.v1ReceiptSetId,
		);
	},
});

/** Server-to-server storage evidence only; not part of the public/admin API. */
export const recordStorageReceiptSet = internalMutation({
	args: { receiptSet: catalogPrivateStorageReceiptSetValidator },
	handler: async (ctx, { receiptSet }) => {
		// Reserved editor operation facts always pass through the same strict
		// admission before retained canary checks. Removing the canary cannot
		// turn this historical path into an editor-policy bypass.
		await admitHistoricalEditorStorageReceipt(ctx, receiptSet);
		await requireCatalogPrivateAssetV2CanaryStorageReceipt(ctx, receiptSet);
		return await recordCatalogPrivateStorageReceiptSet(ctx, receiptSet);
	},
});

/** Independently authenticated content-inspection evidence only. */
export const recordInspectionReceiptSet = internalMutation({
	args: { receiptSet: catalogPrivateInspectionReceiptSetValidator },
	handler: async (ctx, { receiptSet }) => {
		await admitHistoricalEditorInspectionReceipt(ctx, receiptSet);
		await requireCatalogPrivateAssetV2CanaryInspectionReceipt(ctx, receiptSet);
		return await recordCatalogPrivateInspectionReceiptSet(ctx, receiptSet);
	},
});

/** Exact-one schema-2 editor storage evidence on the dedicated ingress. */
export const recordEditorStorageReceipt = internalMutation({
	args: { receiptSet: catalogPrivateStorageReceiptSetValidator },
	handler: async (ctx, { receiptSet }) => {
		await admitEditorStorageReceipt(ctx, receiptSet);
		return editorAdmissionResult(await recordCatalogPrivateStorageReceiptSet(ctx, receiptSet));
	},
});

/** Exact-one independently inspected editor evidence with the schema-2 policy pinned. */
export const recordEditorInspectionReceipt = internalMutation({
	args: { receiptSet: catalogPrivateInspectionReceiptSetValidator },
	handler: async (ctx, { receiptSet }) => {
		await admitEditorInspectionReceipt(ctx, receiptSet);
		return editorAdmissionResult(await recordCatalogPrivateInspectionReceiptSet(ctx, receiptSet));
	},
});

/** Resolve one verified editor operation to metadata that is already safe for the Editor. */
export const resolveEditorUpload = query({
	args: {
		siteUrl: v.string(),
		operationId: v.string(),
		productKind: catalogProductKindValidator,
	},
	handler: async (ctx, { siteUrl, operationId, productKind }) => {
		const { client } = await requireSiteAdmin(ctx, siteUrl);
		requireCatalogProductKindEnabled(client, productKind);
		const expectedKind =
			productKind === "print" || productKind === "print_set"
				? "print_source"
				: productKind === "digital_download"
					? "paid_digital_file"
					: null;
		if (!expectedKind) {
			throw new Error("Catalog product kind does not support private upload resolution");
		}
		if (!CATALOG_PRIVATE_EDITOR_OPERATION_ID_PATTERN.test(operationId)) {
			throw new Error("Private catalog editor upload is not verified");
		}
		const binding = await ctx.db
			.query("catalogPrivateAssetEditorOperations")
			.withIndex("by_siteUrl_and_operationId", (q) =>
				q.eq("siteUrl", siteUrl).eq("operationId", operationId),
			)
			.unique();
		if (
			!binding ||
			binding.sourceId !== `editor-upload:${operationId}` ||
			binding.assetKey !== `editor-upload-${operationId}` ||
			binding.kind !== expectedKind
		)
			throw new Error("Private catalog editor upload is not verified");
		const coordination = await ctx.db
			.query("catalogPrivateAssetReceiptCoordinations")
			.withIndex("by_siteUrl_and_receiptSetId", (q) =>
				q.eq("siteUrl", siteUrl).eq("receiptSetId", binding.receiptSetId),
			)
			.unique();
		if (!coordination || coordination.status !== "verified") {
			throw new Error("Private catalog editor upload is not verified");
		}
		const [storage, inspection] = await Promise.all([
			validateCatalogPrivateEditorStorageReceiptSet(coordination.storageReceiptSet),
			validateCatalogPrivateEditorInspectionReceiptSet(coordination.inspectionReceiptSet),
		]);
		const facts = storage.facts[0];
		const targetResolutionVersion =
			"targetResolutionVersion" in coordination ? coordination.targetResolutionVersion : undefined;
		const targetBindings =
			"targetBindings" in coordination ? coordination.targetBindings : undefined;
		if (
			!facts ||
			inspection.facts.length !== 1 ||
			inspection.facts[0]?.kind !== facts.kind ||
			storage.operation.operationId !== operationId ||
			inspection.operation.operationId !== operationId ||
			storage.operation.sourceId !== binding.sourceId ||
			inspection.operation.sourceId !== binding.sourceId ||
			facts.kind !== binding.kind ||
			facts.assetKey !== binding.assetKey ||
			facts.privateObjectKey !== binding.privateObjectKey ||
			storage.assetSetChecksum !== binding.assetSetChecksum ||
			coordination.receiptSetId !== binding.receiptSetId ||
			targetResolutionVersion !== 1 ||
			targetBindings?.length !== 1
		)
			throw new Error("Private catalog editor upload authority is inconsistent");
		const targets = await requireVerifiedPrivateCatalogTargets(ctx, coordination);
		const target = targets[0];
		if (
			targets.length !== 1 ||
			!target ||
			target.kind !== facts.kind ||
			target.assetKey !== facts.assetKey
		)
			throw new Error("Private catalog editor upload target is inconsistent");
		if (target.kind === "print_source") {
			const asset = await ctx.db.get(target.assetId);
			if (!asset || asset.siteUrl !== siteUrl) {
				throw new Error("Private catalog editor upload target is unavailable");
			}
			return toEditorSafePrivatePrintSourceAsset(asset);
		}
		const asset = await ctx.db.get(target.assetId);
		if (!asset || asset.siteUrl !== siteUrl) {
			throw new Error("Private catalog editor upload target is unavailable");
		}
		return toEditorSafePaidDigitalFileAsset(asset);
	},
});
