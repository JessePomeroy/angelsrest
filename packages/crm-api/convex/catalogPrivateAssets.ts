import { internalMutation } from "./_generated/server";
import {
	catalogPrivateInspectionReceiptSetValidator,
	catalogPrivateStorageReceiptSetValidator,
} from "./helpers/catalogPrivateAssetReceiptContract";
import {
	recordCatalogPrivateInspectionReceiptSet,
	recordCatalogPrivateStorageReceiptSet,
} from "./helpers/catalogPrivateAssetRegistry";

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
