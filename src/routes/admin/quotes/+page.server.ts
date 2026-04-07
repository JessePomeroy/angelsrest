import { ConvexHttpClient } from "convex/browser";
import { env as publicEnv } from "$env/dynamic/public";
import { api } from "../../../../convex/_generated/api";

const convex = new ConvexHttpClient(publicEnv.PUBLIC_CONVEX_URL || "");

export async function load() {
	const [quotes, clients, nextNumber, presets] = await Promise.all([
		convex.query(api.quotes.list, { siteUrl: "angelsrest.online" }),
		convex.query(api.crm.listClients, { siteUrl: "angelsrest.online" }),
		convex.query(api.quotes.getNextNumber, { siteUrl: "angelsrest.online" }),
		convex.query(api.quotes.listPresets, { siteUrl: "angelsrest.online" }),
	]);
	return { quotes, clients, nextNumber, presets };
}
