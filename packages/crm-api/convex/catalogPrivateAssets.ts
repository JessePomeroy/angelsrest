import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import {
	CATALOG_PRIVATE_ASSET_CANARY_EXPECTATION,
	createCatalogPrivateAssetV2CanarySnapshot,
	requireCatalogPrivateAssetV2CanaryInspectionReceipt,
	requireCatalogPrivateAssetV2CanaryStorageReceipt,
} from "./helpers/catalogPrivateAssetCanarySnapshot";
import {
	catalogPrivateInspectionReceiptSetValidator,
	catalogPrivateStorageReceiptSetValidator,
} from "./helpers/catalogPrivateAssetReceiptContract";
import {
	recordCatalogPrivateInspectionReceiptSet,
	recordCatalogPrivateStorageReceiptSet,
} from "./helpers/catalogPrivateAssetRegistry";
import {
	backfillPrivateCatalogTargetAuthorities,
} from "./helpers/catalogPrivateAssetRegistryTargets";

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
		await requireCatalogPrivateAssetV2CanaryStorageReceipt(ctx, receiptSet);
		return await recordCatalogPrivateStorageReceiptSet(ctx, receiptSet);
	},
});

/** Independently authenticated content-inspection evidence only. */
export const recordInspectionReceiptSet = internalMutation({
	args: { receiptSet: catalogPrivateInspectionReceiptSetValidator },
	handler: async (ctx, { receiptSet }) => {
		await requireCatalogPrivateAssetV2CanaryInspectionReceipt(ctx, receiptSet);
		return await recordCatalogPrivateInspectionReceiptSet(ctx, receiptSet);
	},
});
