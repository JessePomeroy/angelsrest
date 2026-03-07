import { json } from '@sveltejs/kit';
import { client } from '$lib/sanity/client';

/**
 * Order lookup API
 * 
 * GET /api/orders/lookup?email=...&order=...
 * Returns order details if email and order number match
 */

export async function GET({ url }) {
	const email = url.searchParams.get('email');
	const orderNumber = url.searchParams.get('order');

	if (!email || !orderNumber) {
		return json({ error: 'Email and order number required' }, { status: 400 });
	}

	try {
		const query = `*[_type == "order" && customerEmail == $email && orderNumber == $orderNumber][0]{
			orderNumber,
			status,
			createdAt,
			total,
			currency,
			customerName,
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
				postalCode
			}
		}`;

		const order = await client.fetch(query, { email, orderNumber });

		if (!order) {
			return json({ error: 'Order not found' }, { status: 404 });
		}

		return json({ order });
	} catch (err) {
		console.error('Order lookup error:', err);
		return json({ error: 'Failed to look up order' }, { status: 500 });
	}
}
