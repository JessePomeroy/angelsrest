import type { RequestHandler } from "@sveltejs/kit";
import { error, json } from "@sveltejs/kit";
import { env } from "$env/dynamic/private";
import { requireAuth } from "./adminAuth";
import { getGalleryWorkerUrl } from "./galleryWorkerUrl";

/**
 * Factory for JSON-body proxy routes that forward a request to the gallery
 * Cloudflare Worker. Handles auth, secret lookup, optional payload
 * validation, the fetch call, and error normalization.
 *
 * Does NOT cover the streaming-PUT upload route (`/upload/put`) — that
 * route has a fundamentally different shape (binary body, query-string
 * key, `duplex: "half"`) and stays bespoke.
 */
export function createGalleryWorkerProxy(
	workerPath: string,
	options: {
		validate?: (data: Record<string, unknown>) => void;
	} = {},
): RequestHandler {
	return async ({ request, cookies }) => {
		await requireAuth(cookies);
		const secret = env.GALLERY_ADMIN_SECRET;
		if (!secret) throw error(500, "GALLERY_ADMIN_SECRET not configured");

		const data = await request.json();
		options.validate?.(data);

		const res = await fetch(`${getGalleryWorkerUrl()}${workerPath}`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${secret}`,
			},
			body: JSON.stringify(data),
		});

		if (!res.ok) throw error(res.status, await res.text());
		return json(await res.json());
	};
}
