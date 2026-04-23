import { error, json } from "@sveltejs/kit";
import { env } from "$env/dynamic/private";
import { requireAuth } from "$lib/server/adminAuth";
import { getGalleryWorkerUrl } from "$lib/server/galleryWorkerUrl";

export async function PUT({ request, url, cookies }) {
	await requireAuth(cookies);
	const secret = env.GALLERY_ADMIN_SECRET;
	if (!secret) throw error(500, "GALLERY_ADMIN_SECRET not configured");

	const key = url.searchParams.get("key");
	if (!key) throw error(400, "Missing key parameter");

	const res = await fetch(`${getGalleryWorkerUrl()}/upload/put?key=${encodeURIComponent(key)}`, {
		method: "PUT",
		headers: {
			"Content-Type": request.headers.get("Content-Type") ?? "application/octet-stream",
			Authorization: `Bearer ${secret}`,
		},
		body: request.body,
		// @ts-expect-error
		duplex: "half",
	});

	if (!res.ok) throw error(res.status, await res.text());
	return json(await res.json());
}
