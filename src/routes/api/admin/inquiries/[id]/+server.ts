import { error, json } from "@sveltejs/kit";
import { adminClient } from "$lib/sanity/adminClient";
import type { RequestHandler } from "./$types";

export const PATCH: RequestHandler = async ({ params, request }) => {
	const { id } = params;
	const body = await request.json();

	if (!body.status) {
		throw error(400, "Missing status field");
	}

	const validStatuses = ["new", "read", "replied"];
	if (!validStatuses.includes(body.status)) {
		throw error(
			400,
			`Invalid status. Must be one of: ${validStatuses.join(", ")}`,
		);
	}

	try {
		const result = await adminClient
			.patch(id)
			.set({ status: body.status })
			.commit();

		return json({ success: true, status: result.status });
	} catch (err) {
		console.error("Failed to update inquiry:", err);
		throw error(500, "Failed to update inquiry status");
	}
};
