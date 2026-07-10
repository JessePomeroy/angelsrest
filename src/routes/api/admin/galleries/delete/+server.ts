import { createGalleryDeleteHandler } from "@jessepomeroy/admin/server";
import type { RequestHandler } from "./$types";
import "$lib/server/adminHandler";

const handler = createGalleryDeleteHandler();

export const POST: RequestHandler = handler;
