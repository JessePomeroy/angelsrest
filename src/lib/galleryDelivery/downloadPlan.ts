import { DEFAULT_MAX_ON_DEMAND_ZIP_BYTES } from "./downloadPolicy";
import { galleryPrepareZipDownloadUrl, galleryZipDownloadUrl } from "./downloadUrls";

export type GalleryDownloadImage = {
	downloadUrl: string | null;
	filename: string;
	r2Key: string;
	sizeBytes?: number;
};

export type GalleryDownloadPlan =
	| { type: "empty"; message: string }
	| { type: "single"; image: GalleryDownloadImage }
	| {
			type: "tooLarge";
			totalBytes: number;
			maxBytes: number;
			prepare: {
				action: string;
				body: {
					token: string;
					galleryName: string;
					imageKeys: string[];
				};
			};
	  }
	| {
			type: "zip";
			action: string;
			fields: {
				token: string;
				galleryName: string;
				imageKeys: string;
			};
	  };

export type GalleryZipDownloadPlan = Extract<GalleryDownloadPlan, { type: "zip" }>;

export function createGalleryDownloadPlan({
	images,
	emptyMessage,
	galleryName,
	token,
	workerUrl,
	maxZipBytes = DEFAULT_MAX_ON_DEMAND_ZIP_BYTES,
}: {
	images: GalleryDownloadImage[];
	emptyMessage: string;
	galleryName: string;
	token: string;
	workerUrl: string;
	maxZipBytes?: number;
}): GalleryDownloadPlan {
	if (images.length === 0) {
		return { type: "empty", message: emptyMessage };
	}

	if (images.length === 1) {
		return { type: "single", image: images[0] };
	}

	const totalBytes = images.reduce((sum, image) => sum + (image.sizeBytes ?? 0), 0);
	if (totalBytes > maxZipBytes) {
		return {
			type: "tooLarge",
			totalBytes,
			maxBytes: maxZipBytes,
			prepare: {
				action: galleryPrepareZipDownloadUrl(workerUrl),
				body: {
					token,
					galleryName,
					imageKeys: images.map((img) => img.r2Key),
				},
			},
		};
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

export function submitGalleryZipDownloadForm({
	plan,
	document,
	setTimeout,
	cleanupDelayMs = 60_000,
}: {
	plan: GalleryZipDownloadPlan;
	document: Document;
	setTimeout: (callback: () => void, delay: number) => unknown;
	cleanupDelayMs?: number;
}) {
	const form = document.createElement("form");
	form.method = "POST";
	form.action = plan.action;
	form.hidden = true;

	for (const [name, value] of Object.entries(plan.fields)) {
		const input = document.createElement("input");
		input.type = "hidden";
		input.name = name;
		input.value = value;
		form.appendChild(input);
	}

	document.body.appendChild(form);
	form.submit();
	setTimeout(() => {
		form.remove();
	}, cleanupDelayMs);
}
