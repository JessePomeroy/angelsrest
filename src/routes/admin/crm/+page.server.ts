import { ConvexHttpClient } from "convex/browser";
import { env as publicEnv } from "$env/dynamic/public";
import { api } from "../../../../convex/_generated/api";

const convex = new ConvexHttpClient(publicEnv.PUBLIC_CONVEX_URL || "");

export async function load() {
	const [clients, stats] = await Promise.all([
		convex.query(api.crm.listClients, { siteUrl: "angelsrest.online" }),
		convex.query(api.crm.getStats, { siteUrl: "angelsrest.online" }),
	]);
	return { clients, stats };
}
