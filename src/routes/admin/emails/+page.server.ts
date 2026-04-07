import { ConvexHttpClient } from "convex/browser";
import { env as publicEnv } from "$env/dynamic/public";
import { api } from "../../../../convex/_generated/api";

const convex = new ConvexHttpClient(publicEnv.PUBLIC_CONVEX_URL || "");

export async function load() {
	const templates = await convex.query(api.emailTemplates.list, {
		siteUrl: "angelsrest.online",
	});
	return { templates };
}
