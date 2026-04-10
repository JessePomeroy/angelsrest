import { createQuoteSendHandler, setServerConfig } from "@jessepomeroy/admin";
import { adminServerConfig } from "$lib/config/admin.server";
import { requireAuth } from "$lib/server/adminAuth";
import type { RequestHandler } from "./$types";

setServerConfig(adminServerConfig);

const handler = createQuoteSendHandler();

export const POST: RequestHandler = (event) => {
	requireAuth(event.cookies);
	return handler(event);
};
