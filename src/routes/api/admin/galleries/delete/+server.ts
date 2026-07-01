import { createGalleryDeleteHandler } from "@jessepomeroy/admin";
import type { RequestHandler } from "./$types";

const handler = createGalleryDeleteHandler();

export const POST: RequestHandler = handler;
