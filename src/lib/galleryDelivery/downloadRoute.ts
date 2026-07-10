import type { GalleryDownloadPlan } from "./downloadPlan";

export type GalleryDownloadRoute = "browserZip" | "folder" | "default" | "preparedZip";

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
	if (planType === "tooLarge") return "preparedZip";
	if (chooseLocation && folderDownloadsSupported) return "folder";
	if (chooseLocation && targetCount > 1 && zipFileDownloadsSupported) return "browserZip";
	return "default";
}
