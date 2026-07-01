import { createGalleryProcessHandler } from "@jessepomeroy/admin";
import type { RequestHandler } from "./$types";
import "$lib/server/adminHandler";

const handler = createGalleryProcessHandler();

export const POST: RequestHandler = handler;
