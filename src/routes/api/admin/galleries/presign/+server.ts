import {
	createGalleryPresignHandler,
	setServerConfig,
} from "@jessepomeroy/admin";
import { adminServerConfig } from "$lib/config/admin.server";

setServerConfig(adminServerConfig);

export const POST = createGalleryPresignHandler();
