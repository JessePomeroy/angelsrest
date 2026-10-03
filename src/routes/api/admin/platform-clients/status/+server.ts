import { json } from "@sveltejs/kit";
import { api } from "$convex/api";
import {
	clientSetupError,
	clientSetupHeaders,
	prepareClientSetupRequest,
} from "$lib/server/platformClientSetup";
import type { RequestHandler } from "./$types";

export const POST: RequestHandler = async (event) => {
	try {
		const { client, statusInput } = await prepareClientSetupRequest(event);
		const status = await client.query(api.platform.getClientSetupStatus, statusInput);
		return json(status, { headers: clientSetupHeaders });
	} catch (cause) {
		return clientSetupError(cause);
	}
};
