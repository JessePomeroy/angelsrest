import { error, json } from "@sveltejs/kit";
import { api } from "$convex/api";
import type { Id } from "$convex/dataModel";
import { getConvex } from "$lib/server/convexClient";

const convex = getConvex();

export async function PATCH({ params, request }) {
	const { id } = params;
	const { status, notes } = await request.json();

	if (status === undefined && notes === undefined) {
		throw error(400, "At least one field (status or notes) is required");
	}

	try {
		await convex.mutation(api.orders.updateStatus, {
			orderId: id as Id<"orders">,
			...(status && { status }),
			...(notes !== undefined && { notes }),
		});

		return json({ success: true });
	} catch (err) {
		console.error("Failed to update order:", err);
		throw error(500, "Failed to update order");
	}
}
