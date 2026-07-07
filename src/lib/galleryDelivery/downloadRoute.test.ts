import { describe, expect, it } from "vitest";
import { chooseGalleryDownloadRoute } from "./downloadRoute";

describe("gallery download route decisions", () => {
	it("preserves folder-save when the user chooses a location and folder access is available", () => {
		expect(
			chooseGalleryDownloadRoute({
				chooseLocation: true,
				folderDownloadsSupported: true,
				planType: "zip",
				targetCount: 2,
				zipFileDownloadsSupported: true,
			}),
		).toBe("folder");
	});

	it("uses prepared ZIP artifacts for oversized multi-file downloads", () => {
		expect(
			chooseGalleryDownloadRoute({
				chooseLocation: false,
				folderDownloadsSupported: true,
				planType: "tooLarge",
				targetCount: 592,
				zipFileDownloadsSupported: true,
			}),
		).toBe("preparedZip");
	});

	it("uses browser ZIP for chosen-location multi-file downloads when only file save is available", () => {
		expect(
			chooseGalleryDownloadRoute({
				chooseLocation: true,
				folderDownloadsSupported: false,
				planType: "zip",
				targetCount: 2,
				zipFileDownloadsSupported: true,
			}),
		).toBe("browserZip");
	});

	it("does not route single-image chosen-location downloads into unsupported folder save", () => {
		expect(
			chooseGalleryDownloadRoute({
				chooseLocation: true,
				folderDownloadsSupported: false,
				planType: "single",
				targetCount: 1,
				zipFileDownloadsSupported: true,
			}),
		).toBe("default");
	});

	it("uses prepared ZIP artifacts for oversized downloads even without browser save primitives", () => {
		expect(
			chooseGalleryDownloadRoute({
				chooseLocation: false,
				folderDownloadsSupported: false,
				planType: "tooLarge",
				targetCount: 592,
				zipFileDownloadsSupported: false,
			}),
		).toBe("preparedZip");
	});
});
