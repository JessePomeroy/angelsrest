import { createCmsMediaDeleteHandler } from "@jessepomeroy/admin/server";
import type { RequestHandler } from "./$types";
import "$lib/server/adminHandler";

const handler = createCmsMediaDeleteHandler();

export const POST: RequestHandler = handler;
