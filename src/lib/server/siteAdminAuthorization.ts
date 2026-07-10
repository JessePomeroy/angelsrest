import { ConvexHttpClient } from "convex/browser";
import { api } from "$convex/api";
import { env as publicEnv } from "$env/dynamic/public";
import { adminConfig } from "$lib/config/admin";
import { adminAuth } from "$lib/server/adminAuth";

function createAuthenticatedClient(token: string): ConvexHttpClient | null {
	const convexUrl = publicEnv.PUBLIC_CONVEX_URL;
	if (!convexUrl) return null;

	const client = new ConvexHttpClient(convexUrl);
	client.setAuth(token);
	return client;
}

async function querySiteAdminAccess(client: ConvexHttpClient, email: string) {
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
	const client = createAuthenticatedClient(token);
	if (!client) return null;

	try {
		return await querySiteAdminAccess(client, email);
	} catch {
		return null;
	}
}

/**
 * Authorize shared admin server handlers against stored tenant membership.
 * Identity validity alone is insufficient for gallery/R2 side effects.
 */
export async function verifySiteAdminRequest(request: Request): Promise<boolean> {
	try {
		const token = await adminAuth.getTokenFromRequest(request);
		if (!token) return false;

		const client = createAuthenticatedClient(token);
		if (!client) return false;

		const identity = await client.query(api.adminAuth.whoami, {});
		if (!identity?.email) return false;

		const access = await querySiteAdminAccess(client, identity.email);
		return access.authorized;
	} catch {
		return false;
	}
}
