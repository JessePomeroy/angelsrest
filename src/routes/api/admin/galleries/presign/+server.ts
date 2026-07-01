import { createGalleryPresignHandler } from "@jessepomeroy/admin/server";
import type { RequestHandler } from "./$types";
import "$lib/server/adminHandler";

const handler = createGalleryPresignHandler();

export const POST: RequestHandler = handler;
