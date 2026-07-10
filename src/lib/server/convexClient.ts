import { ConvexHttpClient } from "convex/browser";
import { env as publicEnv } from "$env/dynamic/public";

let _client: ConvexHttpClient | null = null;

export function getConvex(): ConvexHttpClient {
	if (!_client) {
		_client = new ConvexHttpClient(publicEnv.PUBLIC_CONVEX_URL || "");
	}
	return _client;
}

/**
 * Create an authenticated client for exactly one server request.
 * `setAuth` mutates the client, so authenticated callers must never use the
 * process-wide unauthenticated singleton above.
 */
export function createAuthenticatedConvexClient(token: string): ConvexHttpClient {
	const client = new ConvexHttpClient(publicEnv.PUBLIC_CONVEX_URL || "");
	client.setAuth(token);
	return client;
}
