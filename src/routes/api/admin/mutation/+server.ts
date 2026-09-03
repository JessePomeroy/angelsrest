import { createAdminMutationHandler } from "@jessepomeroy/admin/server";
import { api } from "$convex/api";
import { requireAuth } from "$lib/server/adminAuth";
import { getConvexUrl } from "$lib/server/runtimeConfig";

export const POST = createAdminMutationHandler({
	api,
	getConvexUrl,
	requireAuth,
});
