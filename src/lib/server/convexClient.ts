import { ConvexHttpClient } from "convex/browser";
import { env as publicEnv } from "$env/dynamic/public";

let _client: ConvexHttpClient | null = null;

export function getConvex(): ConvexHttpClient {
	if (!_client) {
		_client = new ConvexHttpClient(publicEnv.PUBLIC_CONVEX_URL || "");
	}
	return _client;
}
