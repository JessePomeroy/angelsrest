/**
 * Admin Orders API - Update Order 🔄
 *
 * This is an API endpoint that the admin page calls to update an order.
 * It's at: PATCH /api/admin/orders/[id]
 *
 * The [id] is a dynamic parameter - it gets the order's Sanity document ID
 */

import { error, json } from "@sveltejs/kit";
import { adminClient } from "$lib/sanity/adminClient";

/**
 * PATCH handler - updates an existing order
 *
 * @param {Object} params - URL parameters (includes the order ID)
 * @param {Object} request - The incoming request with JSON body
 */
export async function PATCH({ params, request }) {
	// Get the order ID from the URL (e.g., /api/admin/orders/abc123 -> "abc123")
	const { id } = params;

	// Read the JSON body to get what fields to update
	const { status, notes } = await request.json();

	// Basic validation
	if (!status && !notes) {
		throw error(400, "At least one field (status or notes) is required");
	}

	try {
		/**
		 * Using the admin client with write token
		 *
		 * .patch(id)  → Select the document to update
		 * .set({...}) → Set new values for fields
		 * .commit()   → Actually execute the update in Sanity
		 */
		const result = await adminClient
			.patch(id)
			.set({
				// Update status if provided
				...(status && { status }),
				// Update notes if provided
				...(notes !== undefined && { notes }),
				// Always update the timestamp
				updatedAt: new Date().toISOString(),
			})
			.commit();

		return json({ success: true, result });
	} catch (err) {
		console.error("Failed to update order:", err);
		throw error(500, "Failed to update order");
	}
}
