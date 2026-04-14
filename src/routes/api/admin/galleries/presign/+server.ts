import { error } from "@sveltejs/kit";
import { createGalleryWorkerProxy } from "$lib/server/galleryWorker";

export const POST = createGalleryWorkerProxy("/upload/presign", {
	validate: (data) => {
		if (!data.siteUrl || !data.galleryId || !data.filename || !data.contentType) {
			throw error(400, "Missing required fields");
		}
	},
});
