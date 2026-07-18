import { createCmsMediaCapabilityHandler } from "@jessepomeroy/admin/server";
import type { RequestHandler } from "./$types";
import "$lib/server/adminHandler";

const handler = createCmsMediaCapabilityHandler();

export const POST: RequestHandler = handler;
