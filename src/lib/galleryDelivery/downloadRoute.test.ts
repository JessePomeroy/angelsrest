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

	it("uses browser ZIP for oversized multi-file downloads when file save is available", () => {
		expect(
			chooseGalleryDownloadRoute({
				chooseLocation: false,
				folderDownloadsSupported: true,
				planType: "tooLarge",
				targetCount: 592,
				zipFileDownloadsSupported: true,
			}),
		).toBe("browserZip");
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

	it("reports unsupported oversized downloads when no chosen-location primitive is available", () => {
		expect(
			chooseGalleryDownloadRoute({
				chooseLocation: false,
				folderDownloadsSupported: false,
				planType: "tooLarge",
				targetCount: 592,
				zipFileDownloadsSupported: false,
			}),
		).toBe("unsupportedTooLarge");
	});
});
