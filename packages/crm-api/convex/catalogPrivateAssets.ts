import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
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

/** Bounded operator backfill for one exact terminal V1 receipt set. */
export const backfillTargetAuthorities = internalMutation({
	args: { siteUrl: v.string(), receiptSetId: v.string() },
	handler: async (ctx, { siteUrl, receiptSetId }) =>
		await backfillPrivateCatalogTargetAuthorities(ctx, siteUrl, receiptSetId),
});

/** Server-to-server storage evidence only; not part of the public/admin API. */
export const recordStorageReceiptSet = internalMutation({
	args: { receiptSet: catalogPrivateStorageReceiptSetValidator },
	handler: async (ctx, { receiptSet }) =>
		await recordCatalogPrivateStorageReceiptSet(ctx, receiptSet),
});

/** Independently authenticated content-inspection evidence only. */
export const recordInspectionReceiptSet = internalMutation({
	args: { receiptSet: catalogPrivateInspectionReceiptSetValidator },
	handler: async (ctx, { receiptSet }) =>
		await recordCatalogPrivateInspectionReceiptSet(ctx, receiptSet),
});
