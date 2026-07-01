import { createGalleryPresignHandler } from "@jessepomeroy/admin";
import type { RequestHandler } from "./$types";
import "$lib/server/adminHandler";

const handler = createGalleryPresignHandler();

export const POST: RequestHandler = handler;
