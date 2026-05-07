import { createGalleryPresignHandler } from "@jessepomeroy/admin";
import { withAdminAuth } from "$lib/server/adminHandler";
import type { RequestHandler } from "./$types";

const handler = createGalleryPresignHandler();

export const POST: RequestHandler = withAdminAuth(handler);
