import { api } from "$convex/api";
import { adminConfig } from "$lib/config/admin";
import { adminAuth } from "$lib/server/adminAuth";
import { createAuthenticatedConvexClient } from "$lib/server/convexClient";

async function querySiteAdminAccess(
	client: ReturnType<typeof createAuthenticatedConvexClient>,
	email: string,
) {
	await client.mutation(api.adminAuth.claimAdminAccess, {
		siteUrl: adminConfig.siteUrl,
	});
	return await client.query(api.adminAuth.checkAdminAccess, {
		email,
		siteUrl: adminConfig.siteUrl,
	});
}

/**
 * Resolve stored site membership for an already validated Better Auth session.
 * A fresh client keeps request auth isolated from every other server request.
 */
export async function getSiteAdminAccess(token: string, email: string) {
	if (!token || !email) return null;

	try {
		const client = createAuthenticatedConvexClient(token);
		return await querySiteAdminAccess(client, email);
	} catch {
		return null;
	}
}

/**
 * Authorize one admin request and return its token for per-request Convex authority.
 * Identity validity alone is insufficient without stored site membership.
 */
export async function authorizeSiteAdminRequest(request: Request) {
	try {
		const token = await adminAuth.getTokenFromRequest(request);
		if (!token) return null;

		const client = createAuthenticatedConvexClient(token);

		const identity = await client.query(api.adminAuth.whoami, {});
		if (!identity?.email) return null;

		const access = await querySiteAdminAccess(client, identity.email);
		if (!access.authorized) return null;
		return { convexToken: token };
	} catch {
		return null;
	}
}

/** Authorize shared admin handlers against a valid session and site membership. */
export async function verifySiteAdminRequest(request: Request): Promise<boolean> {
	return (await authorizeSiteAdminRequest(request)) !== null;
}
