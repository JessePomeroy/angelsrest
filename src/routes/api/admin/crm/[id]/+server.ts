import { error, json } from "@sveltejs/kit";
import { api } from "$convex/api";
import type { Id } from "$convex/dataModel";
import { getConvex } from "$lib/server/convexClient";

const convex = getConvex();

export async function PATCH({ params, request }) {
	const { id } = params;
	const data = await request.json();

	try {
		await convex.mutation(api.crm.updateClient, {
			clientId: id as Id<"photographyClients">,
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
			clientId: id as Id<"photographyClients">,
		});
		return json({ success: true });
	} catch (err) {
		console.error("Failed to delete client:", err);
		throw error(500, "Failed to delete client");
	}
}
