import { createCatalogPrivateDeleteHandler } from "@jessepomeroy/admin/server";
import type { RequestHandler } from "./$types";
import "$lib/server/adminHandler";

export const config = { runtime: "nodejs24.x", maxDuration: 60 };
export const POST: RequestHandler = createCatalogPrivateDeleteHandler();
