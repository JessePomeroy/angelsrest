import { createGalleryImageHandler } from "@jessepomeroy/admin/server";
import "$lib/server/adminHandler";
import type { RequestHandler } from "./$types";

const handler = createGalleryImageHandler();

export const GET: RequestHandler = handler;
