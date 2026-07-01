import { createGalleryUploadSessionHandler } from "@jessepomeroy/admin";
import type { RequestHandler } from "./$types";

const handler = createGalleryUploadSessionHandler();

export const POST: RequestHandler = handler;
