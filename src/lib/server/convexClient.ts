import { ConvexHttpClient } from "convex/browser";
import { getConvexUrl } from "$lib/server/runtimeConfig";

let _client: ConvexHttpClient | null = null;

export function getConvex(): ConvexHttpClient {
	if (!_client) {
		_client = new ConvexHttpClient(getConvexUrl());
	}
	return _client;
}

/**
 * Create an authenticated client for exactly one server request.
 * `setAuth` mutates the client, so authenticated callers must never use the
 * process-wide unauthenticated singleton above.
 */
export function createAuthenticatedConvexClient(token: string): ConvexHttpClient {
	const client = new ConvexHttpClient(getConvexUrl());
	client.setAuth(token);
	return client;
}
