import { createGalleryProcessHandler } from "@jessepomeroy/admin";
import type { RequestHandler } from "./$types";

const handler = createGalleryProcessHandler();

export const POST: RequestHandler = handler;
