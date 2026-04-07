import { error, json } from "@sveltejs/kit";
import { ConvexHttpClient } from "convex/browser";
import { env as publicEnv } from "$env/dynamic/public";
import { api } from "../../../../../../convex/_generated/api";

const convex = new ConvexHttpClient(publicEnv.PUBLIC_CONVEX_URL!);

export async function PATCH({ params, request }) {
	const { id } = params;
	const { status, notes } = await request.json();

	if (status === undefined && notes === undefined) {
		throw error(400, "At least one field (status or notes) is required");
	}

	try {
		await convex.mutation(api.orders.updateStatus, {
			orderId: id as any,
			...(status && { status }),
			...(notes !== undefined && { notes }),
		});

		return json({ success: true });
	} catch (err) {
		console.error("Failed to update order:", err);
		throw error(500, "Failed to update order");
	}
}
