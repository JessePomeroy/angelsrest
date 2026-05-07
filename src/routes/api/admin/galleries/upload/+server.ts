import { createGalleryUploadHandler } from "@jessepomeroy/admin";
import { withAdminAuth } from "$lib/server/adminHandler";
import type { RequestHandler } from "./$types";

const handler = createGalleryUploadHandler();

export const PUT: RequestHandler = withAdminAuth(handler);
