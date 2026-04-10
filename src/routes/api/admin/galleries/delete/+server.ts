import { error } from "@sveltejs/kit";
import { createGalleryWorkerProxy } from "$lib/server/galleryWorker";

export const POST = createGalleryWorkerProxy("/upload/delete", {
	validate: (data) => {
		if (!data.r2Key) throw error(400, "r2Key is required");
	},
});
