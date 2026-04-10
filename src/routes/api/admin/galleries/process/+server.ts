import { createGalleryWorkerProxy } from "$lib/server/galleryWorker";

export const POST = createGalleryWorkerProxy("/upload/process");
