import { galleryZipDownloadUrl } from "./downloadUrls";

export type GalleryDownloadImage = {
	downloadUrl: string | null;
	filename: string;
	r2Key: string;
};

export type GalleryDownloadPlan =
	| { type: "empty"; message: string }
	| { type: "single"; image: GalleryDownloadImage }
	| {
			type: "zip";
			action: string;
			fields: {
				token: string;
				galleryName: string;
				imageKeys: string;
			};
	  };

export function createGalleryDownloadPlan({
	images,
	emptyMessage,
	galleryName,
	token,
	workerUrl,
}: {
	images: GalleryDownloadImage[];
	emptyMessage: string;
	galleryName: string;
	token: string;
	workerUrl: string;
}): GalleryDownloadPlan {
	if (images.length === 0) {
		return { type: "empty", message: emptyMessage };
	}

	if (images.length === 1) {
		return { type: "single", image: images[0] };
	}

	return {
		type: "zip",
		action: galleryZipDownloadUrl(workerUrl),
		fields: {
			token,
			galleryName,
			imageKeys: JSON.stringify(images.map((img) => img.r2Key)),
		},
	};
}
