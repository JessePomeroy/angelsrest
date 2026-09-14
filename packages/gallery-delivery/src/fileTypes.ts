const BROWSER_PREVIEW_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const BROWSER_VIDEO_EXTENSIONS = new Set([".m4v", ".mov", ".mp4", ".webm"]);

export function galleryFileExtension(filename: string): string {
	const cleanName = filename.trim().toLowerCase();
	const dotIndex = cleanName.lastIndexOf(".");
	return dotIndex >= 0 ? cleanName.slice(dotIndex) : "";
}

export function isBrowserPreviewableGalleryFile(filename: string): boolean {
	return BROWSER_PREVIEW_EXTENSIONS.has(galleryFileExtension(filename));
}

export function isBrowserPreviewableGalleryVideo(filename: string): boolean {
	return BROWSER_VIDEO_EXTENSIONS.has(galleryFileExtension(filename));
}

export function galleryFileLabel(filename: string): string {
	return galleryFileExtension(filename).replace(".", "") || "file";
}
