import { createGalleryUploadHandler } from "@jessepomeroy/admin";
import type { RequestHandler } from "./$types";
import "$lib/server/adminHandler";

const handler = createGalleryUploadHandler();

export const PUT: RequestHandler = handler;
