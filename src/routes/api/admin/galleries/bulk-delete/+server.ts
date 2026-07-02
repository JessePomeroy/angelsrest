import { createGalleryBulkDeleteHandler } from "@jessepomeroy/admin/server";
import type { RequestHandler } from "./$types";
import "$lib/server/adminHandler";

const handler = createGalleryBulkDeleteHandler();

export const POST: RequestHandler = handler;
