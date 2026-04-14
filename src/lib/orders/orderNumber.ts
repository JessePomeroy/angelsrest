import { adminClient } from "$lib/sanity/adminClient";

/**
 * Generate a sequential order number
 *
 * Queries Sanity for existing orders, finds the highest order number,
 * and returns the next one in sequence (e.g., ORD-001, ORD-002)
 *
 * Note: This isn't perfectly atomic - for very high volume, you'd want
 * a different approach. For a small art business, this is fine.
 */
export async function getNextOrderNumber(): Promise<string> {
	try {
		// Query for the highest order number
		const query = `*[_type == "order"] | order(orderNumber desc) [0].orderNumber`;
		const lastOrderNumber = await adminClient.fetch<string>(query);

		if (!lastOrderNumber) {
			// First order
			return "ORD-001";
		}

		// Extract the numeric part and increment
		const match = lastOrderNumber.match(/ORD-(\d+)/);
		if (match) {
			const num = parseInt(match[1], 10) + 1;
			// Pad with zeros (001, 002, etc.)
			return `ORD-${num.toString().padStart(3, "0")}`;
		}

		// If somehow the format is wrong, default to a new sequence
		return "ORD-001";
	} catch (err) {
		console.error("Error generating order number:", err);
		// Fallback: use timestamp-based number
		const timestamp = Date.now().toString().slice(-6);
		return `ORD-${timestamp}`;
	}
}

/**
 * Check if an order already exists for a Stripe session
 * Used for idempotency - prevents duplicate orders if webhook fires multiple times
 */
export async function orderExistsForSession(stripeSessionId: string): Promise<boolean> {
	try {
		const query = `count(*[_type == "order" && stripeSessionId == $sessionId]) > 0`;
		const exists = await adminClient.fetch<boolean>(query, {
			sessionId: stripeSessionId,
		});
		return exists;
	} catch (err) {
		console.error("Error checking for existing order:", err);
		return false;
	}
}
