import { api } from "$convex/api";
import { getConvex } from "$lib/server/convexClient";

const convex = getConvex();

export async function load() {
	const threads = await convex.query(api.messages.allThreads);
	return { threads };
}
