import { createGalleryPresignHandler, setServerConfig } from "@jessepomeroy/admin";
import { adminServerConfig } from "$lib/config/admin.server";
import { requireAuth } from "$lib/server/adminAuth";
import type { RequestHandler } from "./$types";

setServerConfig(adminServerConfig);

const handler = createGalleryPresignHandler();

export const POST: RequestHandler = async (event) => {
	await requireAuth(event.cookies);
	return handler(event);
};
