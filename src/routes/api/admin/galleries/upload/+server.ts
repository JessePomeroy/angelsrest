import { createGalleryUploadHandler } from "@jessepomeroy/admin";
import type { RequestHandler } from "./$types";

const handler = createGalleryUploadHandler();

export const PUT: RequestHandler = handler;
