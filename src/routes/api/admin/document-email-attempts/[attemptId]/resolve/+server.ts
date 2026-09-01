import "$lib/server/adminHandler";
import { createDocumentEmailRecoveryResolveHandler } from "@jessepomeroy/admin/server";

export const POST = createDocumentEmailRecoveryResolveHandler();
