/**
 * Admin Orders Page - Server-Side Data Loading 📥
 *
 * This file runs on the server when someone visits /admin/orders
 * It fetches all orders from Sanity and sends them to the page
 */

import { client } from "$lib/sanity/client";

/**
 * Load function - runs when the page is visited
 * Returns data that will be passed to the +page.svelte component
 *
 * 💡 This uses a GROQ query to fetch data from Sanity
 * GROQ (Graph-Relational Object Queries) is Sanity's query language
 */
export async function load() {
	/**
	 * GROQ Query Breakdown:
	 *
	 * *[_type == "order"]     → Find all documents where _type equals "order"
	 * | order(createdAt desc)   → Sort them by createdAt, newest first
	 * { ...fields }            → Only return these specific fields
	 *
	 * This is like SQL: SELECT * FROM order ORDER BY createdAt DESC
	 */
	const query = `*[_type == "order"] | order(createdAt desc) {
		_id,                      // Unique Sanity document ID
		orderNumber,               // Our human-readable order number (ORD-001)
		createdAt,                 // When the order was created
		customerEmail,              // Customer's email
		customerName,               // Customer's name
		total,                     // Order total in cents
		status,                    // Fulfillment status
		currency,                  // Currency code (usd, eur, etc.)
		items[]{                   // Array of items purchased
			productName,
			quantity,
			price
		},
		shippingAddress{           // Nested object for shipping info
			line1,
			line2,
			city,
			state,
			postalCode,
			country
		},
		notes                      // Our internal notes
	}`;

	// Fetch from Sanity using the read-only client
	// (we don't need write access here, just reading)
	const orders = await client.fetch(query);

	// Send orders to the frontend
	return {
		orders,
	};
}
