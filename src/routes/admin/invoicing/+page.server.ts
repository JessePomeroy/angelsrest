import { ConvexHttpClient } from "convex/browser";
import { env as publicEnv } from "$env/dynamic/public";
import { api } from "../../../../convex/_generated/api";

const convex = new ConvexHttpClient(publicEnv.PUBLIC_CONVEX_URL || "");

export async function load() {
	const [invoices, clients, nextNumber] = await Promise.all([
		convex.query(api.invoices.list, { siteUrl: "angelsrest.online" }),
		convex.query(api.crm.listClients, { siteUrl: "angelsrest.online" }),
		convex.query(api.invoices.getNextNumber, {
			siteUrl: "angelsrest.online",
		}),
	]);
	return { invoices, clients, nextNumber };
}
