import { ConvexHttpClient } from "convex/browser";
import { env as publicEnv } from "$env/dynamic/public";
import { api } from "../../../../convex/_generated/api";

const convex = new ConvexHttpClient(publicEnv.PUBLIC_CONVEX_URL || "");

export async function load() {
	const [contracts, clients, templates] = await Promise.all([
		convex.query(api.contracts.list, { siteUrl: "angelsrest.online" }),
		convex.query(api.crm.listClients, { siteUrl: "angelsrest.online" }),
		convex.query(api.contracts.listTemplates, {
			siteUrl: "angelsrest.online",
		}),
	]);
	return { contracts, clients, templates };
}
