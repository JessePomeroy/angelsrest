import { error, json } from "@sveltejs/kit";
import { ConvexHttpClient } from "convex/browser";
import { env as publicEnv } from "$env/dynamic/public";
import { api } from "../../../../../../convex/_generated/api";

const convex = new ConvexHttpClient(publicEnv.PUBLIC_CONVEX_URL!);

export async function PATCH({ params, request }) {
	const { id } = params;
	const data = await request.json();

	try {
		await convex.mutation(api.crm.updateClient, {
			clientId: id as any,
			...data,
		});
		return json({ success: true });
	} catch (err) {
		console.error("Failed to update client:", err);
		throw error(500, "Failed to update client");
	}
}

export async function DELETE({ params }) {
	const { id } = params;

	try {
		await convex.mutation(api.crm.deleteClient, {
			clientId: id as any,
		});
		return json({ success: true });
	} catch (err) {
		console.error("Failed to delete client:", err);
		throw error(500, "Failed to delete client");
	}
}
