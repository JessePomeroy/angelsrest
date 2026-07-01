import { createAdminMutationHandler } from "@jessepomeroy/admin/server";
import { api } from "$convex/api";
import { env as publicEnv } from "$env/dynamic/public";
import { requireAuth } from "$lib/server/adminAuth";

export const POST = createAdminMutationHandler({
	api,
	getConvexUrl: () => publicEnv.PUBLIC_CONVEX_URL,
	requireAuth,
});
