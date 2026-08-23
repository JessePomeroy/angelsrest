import { describe, expect, test } from "vitest";
import {
	ABOUT_CONTACT_PORTRAIT_SOURCE,
	checkpointAboutContactPortraitConfirmedMissing,
	checkpointAboutContactPortraitPutAttempted,
	checkpointAboutContactPortraitRegistered,
	createAboutContactPortraitReceipt,
	isConfirmedAboutContactPortraitSourceMissing,
	parseAboutContactPortraitCheckpoint,
	parseAboutContactPortraitReceipt,
} from "./aboutContactPortraitTransfer";

const MEDIA_ASSET_ID = "nh744cpb0en9t6nx89xpjdn8ts8arc2m";
const WORKER_ASSET_ID = "7e11be6a-7e30-4317-aad5-08f4c00333b4";
const REISSUED_WORKER_ASSET_ID = "cf6e8162-a988-476d-b23f-50cb678272f9";

describe("About and Contact portrait transfer evidence", () => {
	test("binds evidence and permits exactly one confirmed-missing capability reissue", () => {
		const putAttempted = checkpointAboutContactPortraitPutAttempted(WORKER_ASSET_ID, 1);
		expect(parseAboutContactPortraitCheckpoint(putAttempted)).toEqual(putAttempted);
		expect(isConfirmedAboutContactPortraitSourceMissing(404, "Uploaded object not found")).toBe(
			true,
		);
		expect(isConfirmedAboutContactPortraitSourceMissing(404, "unexpected")).toBe(false);

		const reset = checkpointAboutContactPortraitConfirmedMissing(putAttempted);
		expect(parseAboutContactPortraitCheckpoint(reset)).toEqual(reset);
		const reissued = checkpointAboutContactPortraitPutAttempted(REISSUED_WORKER_ASSET_ID, 2);
		expect(() => checkpointAboutContactPortraitConfirmedMissing(reissued)).toThrow(
			/bounded capability reissue/i,
		);

		const registered = checkpointAboutContactPortraitRegistered(
			{ mediaAssetId: MEDIA_ASSET_ID, workerAssetId: REISSUED_WORKER_ASSET_ID },
			2,
		);
		expect(parseAboutContactPortraitCheckpoint(registered)).toEqual(registered);

		const receipt = createAboutContactPortraitReceipt({
			mediaAssetId: MEDIA_ASSET_ID,
			workerAssetId: REISSUED_WORKER_ASSET_ID,
		});
		expect(parseAboutContactPortraitReceipt(receipt)).toEqual(receipt);
		expect(receipt).toMatchObject({
			sourceSha256: ABOUT_CONTACT_PORTRAIT_SOURCE.sha256,
			sourceWidth: 1_440,
			sourceHeight: 2_160,
			mediaAssetId: MEDIA_ASSET_ID,
			workerAssetId: REISSUED_WORKER_ASSET_ID,
		});
		expect(() => parseAboutContactPortraitReceipt({ ...receipt, sourceWidth: 1_439 })).toThrow(
			/receipt is invalid/i,
		);
		expect(() =>
			parseAboutContactPortraitReceipt({ ...receipt, receiptDigest: "0".repeat(64) }),
		).toThrow(/receipt is invalid/i);
	});
});
