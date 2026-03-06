import { json, error } from '@sveltejs/kit';
import { adminClient } from '$lib/sanity/adminClient';

/**
 * Update order status
 * PATCH /api/admin/orders/[id]
 */
export async function PATCH({ params, request }) {
	const { id } = params;
	const { status } = await request.json();

	if (!status) {
		throw error(400, 'Status is required');
	}

	try {
		const result = await adminClient
			.patch(id)
			.set({
				status,
				updatedAt: new Date().toISOString()
			})
			.commit();

		return json({ success: true, result });
	} catch (err) {
		console.error('Failed to update order status:', err);
		throw error(500, 'Failed to update order status');
	}
}
