import { client } from "$lib/sanity/client";

/**
 * Fetch all orders from Sanity, newest first
 */
export async function load() {
	const query = `*[_type == "order"] | order(createdAt desc) {
		_id,
		orderNumber,
		createdAt,
		customerEmail,
		customerName,
		total,
		status,
		currency,
		items[]{
			productName,
			quantity,
			price
		},
		shippingAddress{
			line1,
			line2,
			city,
			state,
			postalCode,
			country
		},
		notes
	}`;

	const orders = await client.fetch(query);

	return {
		orders
	};
}
