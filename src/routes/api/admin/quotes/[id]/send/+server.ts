import { createQuoteSendHandler } from "@jessepomeroy/admin";
import { withAdminAuth } from "$lib/server/adminHandler";
import type { RequestHandler } from "./$types";

const handler = createQuoteSendHandler();

export const POST: RequestHandler = withAdminAuth(handler);
