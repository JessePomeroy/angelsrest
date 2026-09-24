import { error, isHttpError, json } from "@sveltejs/kit";
import { ConvexError } from "convex/values";
import { api } from "$convex/api";
import { adminConfig } from "$lib/config/admin";
import { requireAuthWithIdentity } from "$lib/server/adminAuth";
import { createAuthenticatedConvexClient } from "$lib/server/convexClient";
import { getSiteAdminAccess } from "$lib/server/siteAdminAuthorization";
import { createTemporaryPassword } from "$lib/server/temporaryPassword";
import {
	normalizePlatformClientInput,
	PLATFORM_CLIENT_LOGIN_UNVERIFIED,
	PLATFORM_CLIENT_SITE_IN_USE,
} from "../../../../../packages/crm-api/convex/helpers/platformClientInput";
import type { RequestHandler } from "./$types";

export const POST: RequestHandler = async ({ cookies, request, url }) => {
	const headers = { "cache-control": "private, no-store", "referrer-policy": "no-referrer" };
	try {
		if (request.headers.get("origin") !== url.origin) error(403, "Request origin is not allowed.");
		const { token, identity } = await requireAuthWithIdentity(cookies);
		if (!identity.email || !(await getSiteAdminAccess(token, identity.email))?.authorized) {
			error(403, "Platform administrator access is required.");
		}
		// Only the hub's authenticated operator can reach this host endpoint;
		// the mutation independently enforces stored creator membership.
		if (adminConfig.siteUrl !== "angelsrest.online")
			error(403, "Client creation belongs to the hub.");
		const body: unknown = await request.json().catch(() => null);
		if (
			!body ||
			typeof body !== "object" ||
			!("name" in body) ||
			typeof body.name !== "string" ||
			!("email" in body) ||
			typeof body.email !== "string" ||
			!("siteUrl" in body) ||
			typeof body.siteUrl !== "string" ||
			!("tier" in body) ||
			(body.tier !== "basic" && body.tier !== "full")
		) {
			error(400, "Check the client details.");
		}
		let input: ReturnType<typeof normalizePlatformClientInput>;
		try {
			input = normalizePlatformClientInput({
				name: body.name,
				email: body.email,
				siteUrl: body.siteUrl,
				adminEmails: [body.email],
			});
		} catch {
			error(400, "Check the client details.");
		}
		const { password, passwordHash } = await createTemporaryPassword();
		const result = await createAuthenticatedConvexClient(token).mutation(
			api.platform.createClientWithAdmin,
			{
				name: input.name,
				email: input.email,
				siteUrl: input.siteUrl,
				tier: body.tier,
				passwordHash,
			},
		);
		return json(
			{ email: input.email, temporaryPassword: result.passwordCreated ? password : null },
			{ headers },
		);
	} catch (cause) {
		if (cause instanceof ConvexError && cause.data === PLATFORM_CLIENT_LOGIN_UNVERIFIED) {
			return json({ error: PLATFORM_CLIENT_LOGIN_UNVERIFIED }, { status: 409, headers });
		}
		if (cause instanceof ConvexError && cause.data === PLATFORM_CLIENT_SITE_IN_USE) {
			return json({ error: PLATFORM_CLIENT_SITE_IN_USE }, { status: 409, headers });
		}
		if (isHttpError(cause))
			return json({ error: cause.body.message }, { status: cause.status, headers });
		// Never log credentials, submitted details or provider exception bodies.
		return json(
			{
				error:
					"We could not confirm the client was added. Check the platform list before trying again.",
			},
			{ status: 500, headers },
		);
	}
};
