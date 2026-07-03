import type { GalleryDownloadPlan } from "./downloadPlan";

export type GalleryDownloadRoute = "browserZip" | "folder" | "default" | "unsupportedTooLarge";

export function chooseGalleryDownloadRoute({
	chooseLocation,
	folderDownloadsSupported,
	planType,
	targetCount,
	zipFileDownloadsSupported,
}: {
	chooseLocation: boolean;
	folderDownloadsSupported: boolean;
	planType: GalleryDownloadPlan["type"];
	targetCount: number;
	zipFileDownloadsSupported: boolean;
}): GalleryDownloadRoute {
	if (chooseLocation && folderDownloadsSupported) return "folder";
	if (planType === "tooLarge" && targetCount > 1 && zipFileDownloadsSupported) return "browserZip";
	if (chooseLocation && targetCount > 1 && zipFileDownloadsSupported) return "browserZip";
	if (planType === "tooLarge" && folderDownloadsSupported) return "folder";
	if (planType === "tooLarge") return "unsupportedTooLarge";
	return "default";
}
