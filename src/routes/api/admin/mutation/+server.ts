import { createAdminMutationHandler } from "@jessepomeroy/admin/server";
import { ConvexHttpClient } from "convex/browser";
import { getFunctionName } from "convex/server";
import { ConvexError } from "convex/values";
import { api } from "$convex/api";
import { requireAuth } from "$lib/server/adminAuth";
import { getConvexUrl } from "$lib/server/runtimeConfig";
import { PLATFORM_CLIENT_SITE_IN_USE } from "../../../../../packages/crm-api/convex/helpers/platformClientInput";

export const POST = createAdminMutationHandler({
	api,
	getConvexUrl,
	requireAuth,
	createClient(convexUrl) {
		const client = new ConvexHttpClient(convexUrl);
		const mutate = client.mutation.bind(client);
		client.mutation = async (...args) => {
			try {
				return await mutate(...args);
			} catch (error) {
				// The shared proxy forwards only message; production Convex keeps this code in data.
				if (
					getFunctionName(args[0]) === "platform:createClient" &&
					error instanceof ConvexError &&
					error.data === PLATFORM_CLIENT_SITE_IN_USE
				) {
					throw new Error(PLATFORM_CLIENT_SITE_IN_USE);
				}
				throw error;
			}
		};
		return client;
	},
});
