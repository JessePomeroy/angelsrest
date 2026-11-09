import { createPortalTokenHandler } from "@jessepomeroy/admin/server";
import "$lib/server/adminHandler";
import type { RequestHandler } from "./$types";

export const POST: RequestHandler = createPortalTokenHandler();
