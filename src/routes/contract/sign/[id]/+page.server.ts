import { error } from "@sveltejs/kit";
import { api } from "$convex/api";
import type { Id } from "$convex/dataModel";
import { getConvex } from "$lib/server/convexClient";

const convex = getConvex();

export async function load({ params }) {
	const contractId = params.id as Id<"contracts">;

	try {
		const contract = await convex.query(api.contracts.get, { contractId });

		if (!contract) {
			throw error(404, "Contract not found");
		}

		return { contract };
	} catch (err) {
		if (err && typeof err === "object" && "status" in err) {
			throw err;
		}
		console.error("Error loading contract:", err);
		throw error(500, "Failed to load contract");
	}
}
