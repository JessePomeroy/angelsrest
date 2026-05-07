import { createPortalTokenHandler } from "@jessepomeroy/admin";
import { withAdminAuth } from "$lib/server/adminHandler";
import type { RequestHandler } from "./$types";

const handler = createPortalTokenHandler();

export const POST: RequestHandler = withAdminAuth(handler);
