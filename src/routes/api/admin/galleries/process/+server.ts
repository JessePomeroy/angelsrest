import { createGalleryProcessHandler } from "@jessepomeroy/admin";
import { withAdminAuth } from "$lib/server/adminHandler";
import type { RequestHandler } from "./$types";

const handler = createGalleryProcessHandler();

export const POST: RequestHandler = withAdminAuth(handler);
