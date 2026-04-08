import { createPortalTokenHandler, setServerConfig } from "@jessepomeroy/admin";
import { adminServerConfig } from "$lib/config/admin.server";

setServerConfig(adminServerConfig);

export const POST = createPortalTokenHandler();
