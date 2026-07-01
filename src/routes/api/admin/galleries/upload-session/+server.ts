import { createGalleryUploadSessionHandler } from "@jessepomeroy/admin";
import type { RequestHandler } from "./$types";
import "$lib/server/adminHandler";

const handler = createGalleryUploadSessionHandler();

export const POST: RequestHandler = handler;
