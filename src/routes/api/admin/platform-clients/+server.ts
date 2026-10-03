import { json } from "@sveltejs/kit";
import { ConvexError } from "convex/values";
import { api } from "$convex/api";
import {
	clientSetupError,
	clientSetupHeaders,
	prepareClientSetupRequest,
} from "$lib/server/platformClientSetup";
import { createTemporaryPassword } from "$lib/server/temporaryPassword";
import { PLATFORM_CLIENT_LOGIN_UNVERIFIED } from "../../../../../packages/crm-api/convex/helpers/platformClientInput";
import type { RequestHandler } from "./$types";

export const POST: RequestHandler = async (event) => {
	try {
		const { client, input, statusInput } = await prepareClientSetupRequest(event);
		const status = await client.query(api.platform.getClientSetupStatus, statusInput);
		if (status.kind !== "absent")
			return json({ kind: "observed", status }, { headers: clientSetupHeaders });
		const { password, passwordHash } = await createTemporaryPassword();
		try {
			const result = await client.mutation(api.platform.createClientWithAdmin, {
				...input,
				passwordHash,
			});
			return json(
				{
					kind: "created",
					email: input.email,
					temporaryPassword: result.passwordCreated ? password : null,
				},
				{ headers: clientSetupHeaders },
			);
		} catch (cause) {
			if (cause instanceof ConvexError && cause.data === PLATFORM_CLIENT_LOGIN_UNVERIFIED) {
				return json(
					{ error: PLATFORM_CLIENT_LOGIN_UNVERIFIED },
					{ status: 409, headers: clientSetupHeaders },
				);
			}
			// A timeout or duplicate race may follow a committed write. Read once; never replay it here.
			const observed = await client.query(api.platform.getClientSetupStatus, statusInput);
			return json({ kind: "observed", status: observed }, { headers: clientSetupHeaders });
		}
	} catch (cause) {
		return clientSetupError(cause);
	}
};
