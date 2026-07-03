import { galleryFileLabel, isBrowserPreviewableGalleryFile } from "./fileTypes";

type GalleryDisplayInput = {
	filename: string;
	r2Key: string;
};

export type GalleryPreviewSource = "self" | "sidecar" | "none";

export type GalleryDisplayImage<T extends GalleryDisplayInput> = T & {
	thumbUrl: string;
	previewUrl: string;
	canPreview: boolean;
	fileLabel: string;
	previewSource: GalleryPreviewSource;
};

function galleryImageUrl(workerUrl: string, r2Key: string, derivative: "thumb" | "preview") {
	const normalizedWorkerUrl = workerUrl.replace(/\/+$/, "");
	const derivativeKey = r2Key.replace("/original/", `/${derivative}/`);
	return `${normalizedWorkerUrl}/image/${encodeURIComponent(derivativeKey)}`;
}

function pairKeyForImage(image: GalleryDisplayInput) {
	const path = image.r2Key || image.filename;
	const slashIndex = path.lastIndexOf("/");
	const directory = slashIndex >= 0 ? path.slice(0, slashIndex + 1) : "";
	const filename = slashIndex >= 0 ? path.slice(slashIndex + 1) : path;
	const dotIndex = filename.lastIndexOf(".");
	const stem = dotIndex >= 0 ? filename.slice(0, dotIndex) : filename;

	return `${directory}${stem}`.trim().toLowerCase();
}

export function resolveGalleryDisplayImages<T extends GalleryDisplayInput>(
	images: T[],
	workerUrl: string,
): Array<GalleryDisplayImage<T>> {
	const sidecarsByPairKey = new Map<string, T>();

	for (const image of images) {
		if (!isBrowserPreviewableGalleryFile(image.filename)) continue;
		const pairKey = pairKeyForImage(image);
		if (!sidecarsByPairKey.has(pairKey)) {
			sidecarsByPairKey.set(pairKey, image);
		}
	}

	return images.map((image) => {
		const isOriginalPreviewable = isBrowserPreviewableGalleryFile(image.filename);
		const sidecar = isOriginalPreviewable ? image : sidecarsByPairKey.get(pairKeyForImage(image));
		const previewSource: GalleryPreviewSource = isOriginalPreviewable
			? "self"
			: sidecar
				? "sidecar"
				: "none";
		const previewKey = sidecar?.r2Key ?? image.r2Key;

		return {
			...image,
			thumbUrl: galleryImageUrl(workerUrl, previewKey, "thumb"),
			previewUrl: galleryImageUrl(workerUrl, previewKey, "preview"),
			canPreview: previewSource !== "none",
			fileLabel: galleryFileLabel(image.filename),
			previewSource,
		};
	});
}
