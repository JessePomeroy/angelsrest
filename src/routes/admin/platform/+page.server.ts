import { api } from "$convex/api";
import { getConvex } from "$lib/server/convexClient";

const convex = getConvex();

export async function load() {
	const clients = await convex.query(api.platform.listAll);
	return { clients };
}
