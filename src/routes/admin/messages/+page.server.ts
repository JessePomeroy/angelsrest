import { ConvexHttpClient } from "convex/browser";
import { env as publicEnv } from "$env/dynamic/public";
import { api } from "../../../../convex/_generated/api";

const convex = new ConvexHttpClient(publicEnv.PUBLIC_CONVEX_URL || "");

export async function load() {
	const threads = await convex.query(api.messages.allThreads);
	return { threads };
}
