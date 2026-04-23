import { error, json } from "@sveltejs/kit";
import { env } from "$env/dynamic/private";
import { requireAuth } from "$lib/server/adminAuth";
import { getGalleryWorkerUrl } from "$lib/server/galleryWorkerUrl";

// Audit M20: front-door caps on upload body. The worker enforces the same
// limits server-side; duplicating them here saves a worker round-trip on
// obvious abuse and bounds SvelteKit-side memory exposure.
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50 MB

export async function PUT({ request, url, cookies }) {
	await requireAuth(cookies);
	const secret = env.GALLERY_ADMIN_SECRET;
	if (!secret) throw error(500, "GALLERY_ADMIN_SECRET not configured");

	const key = url.searchParams.get("key");
	if (!key) throw error(400, "Missing key parameter");

	// Reject obvious abuse before we open a streaming proxy to the worker.
	const contentLengthHeader = request.headers.get("Content-Length");
	const contentLength = contentLengthHeader ? Number(contentLengthHeader) : NaN;
	if (Number.isFinite(contentLength) && contentLength > MAX_UPLOAD_BYTES) {
		throw error(413, `Upload too large: max ${MAX_UPLOAD_BYTES} bytes (50 MB)`);
	}

	const contentType = request.headers.get("Content-Type") ?? "";
	if (!contentType.startsWith("image/")) {
		throw error(415, "Unsupported media type: Content-Type must start with image/");
	}

	const res = await fetch(`${getGalleryWorkerUrl()}/upload/put?key=${encodeURIComponent(key)}`, {
		method: "PUT",
		headers: {
			"Content-Type": contentType,
			Authorization: `Bearer ${secret}`,
		},
		body: request.body,
		// @ts-expect-error
		duplex: "half",
	});

	if (!res.ok) throw error(res.status, await res.text());
	return json(await res.json());
}
