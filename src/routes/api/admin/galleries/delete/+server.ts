import { error, json } from "@sveltejs/kit";
import { env } from "$env/dynamic/private";
import { requireAuth } from "$lib/server/adminAuth";

const WORKER_URL = "https://gallery-worker.thinkingofview.workers.dev";

export async function POST({ request, cookies }) {
	requireAuth(cookies);
	const secret = env.GALLERY_ADMIN_SECRET;
	if (!secret) throw error(500, "GALLERY_ADMIN_SECRET not configured");

	const { r2Key } = await request.json();
	if (!r2Key) throw error(400, "r2Key is required");

	const res = await fetch(`${WORKER_URL}/upload/delete`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${secret}`,
		},
		body: JSON.stringify({ r2Key }),
	});

	if (!res.ok) throw error(res.status, await res.text());
	return json(await res.json());
}
