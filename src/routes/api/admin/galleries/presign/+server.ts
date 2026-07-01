import { createGalleryPresignHandler } from "@jessepomeroy/admin";
import type { RequestHandler } from "./$types";

const handler = createGalleryPresignHandler();

export const POST: RequestHandler = handler;
