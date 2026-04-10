import { error, json } from "@sveltejs/kit";
import { env } from "$env/dynamic/private";
import { requireAuth } from "$lib/server/adminAuth";

const WORKER_URL = "https://gallery-worker.thinkingofview.workers.dev";

export async function POST({ request, cookies }) {
	requireAuth(cookies);
	const secret = env.GALLERY_ADMIN_SECRET;
	if (!secret) throw error(500, "GALLERY_ADMIN_SECRET not configured");

	const data = await request.json();

	const res = await fetch(`${WORKER_URL}/upload/process`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${secret}`,
		},
		body: JSON.stringify(data),
	});

	if (!res.ok) throw error(res.status, await res.text());
	return json(await res.json());
}
