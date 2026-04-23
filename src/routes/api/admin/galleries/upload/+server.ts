import { createGalleryUploadHandler, setServerConfig } from "@jessepomeroy/admin";
import { adminServerConfig } from "$lib/config/admin.server";
import { requireAuth } from "$lib/server/adminAuth";
import type { RequestHandler } from "./$types";

setServerConfig(adminServerConfig);

const handler = createGalleryUploadHandler();

export const PUT: RequestHandler = async (event) => {
	await requireAuth(event.cookies);
	return handler(event);
};
