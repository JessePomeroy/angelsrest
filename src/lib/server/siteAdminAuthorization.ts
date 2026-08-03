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
 * Authorize one admin request and return its token for per-request Convex authority.
 * Identity validity alone is insufficient without stored site membership.
 */
export async function authorizeSiteAdminRequest(request: Request) {
	try {
		const token = await adminAuth.getTokenFromRequest(request);
		if (!token) return null;

		const client = createAuthenticatedClient(token);
		if (!client) return null;

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
