import { createCmsMediaProcessHandler } from "@jessepomeroy/admin/server";
import type { RequestHandler } from "./$types";
import "$lib/server/adminHandler";

const handler = createCmsMediaProcessHandler();

export const POST: RequestHandler = handler;
