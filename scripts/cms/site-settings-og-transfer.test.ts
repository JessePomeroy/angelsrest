import { describe, expect, test } from "vitest";
import {
	checkpointSiteSettingsOgConfirmedMissing,
	checkpointSiteSettingsOgPutAttempted,
	checkpointSiteSettingsOgRegistered,
	createInitialSiteSettingsOgCheckpoint,
	createSiteSettingsOgReceipt,
	isConfirmedSiteSettingsOgSourceMissing,
	parseSiteSettingsOgCheckpoint,
	parseSiteSettingsOgReceipt,
	SITE_SETTINGS_OG_SOURCE,
} from "./site-settings-og-transfer-helper";

const SOURCE_SHA256 = "f".repeat(64);
const MEDIA_ASSET_ID = "nh744cpb0en9t6nx89xpjdn8ts8arc2m";
const WORKER_ASSET_ID = "7e11be6a-7e30-4317-aad5-08f4c00333b4";
const REISSUED_WORKER_ASSET_ID = "cf6e8162-a988-476d-b23f-50cb678272f9";

function registered(workerAssetId = REISSUED_WORKER_ASSET_ID) {
	return {
		mediaAssetId: MEDIA_ASSET_ID,
		workerAssetId,
		createdAt: 1_787_528_000_000,
		derivatives: {
			thumb: {
				key: `sites/angelsrest.online/web/${workerAssetId}/thumb.webp`,
				contentType: "image/webp" as const,
				width: 320,
				height: 320,
			},
			card: {
				key: `sites/angelsrest.online/web/${workerAssetId}/card.webp`,
				contentType: "image/webp" as const,
				width: 640,
				height: 640,
			},
		},
	};
}

describe("Site Settings OG transfer evidence", () => {
	test("binds the sealed source, one missing-source reissue, target, and receipt digest", () => {
		expect(SITE_SETTINGS_OG_SOURCE).toMatchObject({
			assetRef: "image-0ccd0a41f44c6387c01425cd93579ac5a4a9f341-1848x1848-png",
			assetRev: "Wjt6hHDPdnIIxNbTJB4JTp",
			sha1: "0ccd0a41f44c6387c01425cd93579ac5a4a9f341",
			sizeBytes: 35_666,
			width: 1_848,
			height: 1_848,
			crop: null,
			hotspot: null,
		});

		const initial = createInitialSiteSettingsOgCheckpoint(SOURCE_SHA256);
		expect(parseSiteSettingsOgCheckpoint(initial)).toEqual(initial);
		const putAttempted = checkpointSiteSettingsOgPutAttempted(SOURCE_SHA256, WORKER_ASSET_ID, 1);
		expect(isConfirmedSiteSettingsOgSourceMissing(404, "Uploaded object not found")).toBe(true);
		expect(isConfirmedSiteSettingsOgSourceMissing(404, "unexpected")).toBe(false);
		const reset = checkpointSiteSettingsOgConfirmedMissing(putAttempted);
		expect(parseSiteSettingsOgCheckpoint(reset)).toEqual(reset);
		const reissued = checkpointSiteSettingsOgPutAttempted(
			SOURCE_SHA256,
			REISSUED_WORKER_ASSET_ID,
			2,
		);
		expect(() => checkpointSiteSettingsOgConfirmedMissing(reissued)).toThrow(
			/bounded capability reissue/i,
		);

		const target = registered();
		const complete = checkpointSiteSettingsOgRegistered(SOURCE_SHA256, target, 2);
		expect(parseSiteSettingsOgCheckpoint(complete)).toEqual(complete);
		const receipt = createSiteSettingsOgReceipt(SOURCE_SHA256, target);
		expect(parseSiteSettingsOgReceipt(receipt)).toEqual(receipt);
		expect(receipt).toMatchObject({
			sourceAssetRef: SITE_SETTINGS_OG_SOURCE.assetRef,
			sourceSha1: SITE_SETTINGS_OG_SOURCE.sha1,
			sourceSha256: SOURCE_SHA256,
			mediaAssetId: MEDIA_ASSET_ID,
			workerAssetId: REISSUED_WORKER_ASSET_ID,
			targetStatus: "ready",
		});
		expect(() => parseSiteSettingsOgReceipt({ ...receipt, receiptDigest: "0".repeat(64) })).toThrow(
			/receipt is invalid/i,
		);
	});
});
