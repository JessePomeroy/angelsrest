import { createContractSendHandler } from "@jessepomeroy/admin";
import { withAdminAuth } from "$lib/server/adminHandler";
import type { RequestHandler } from "./$types";

const handler = createContractSendHandler();

export const POST: RequestHandler = withAdminAuth(handler);
