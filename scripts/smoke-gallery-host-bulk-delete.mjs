#!/usr/bin/env node

const DEFAULT_HOST_URL = "https://angelsrest.online";
const DEFAULT_WORKER_URL = "https://gallery-worker.thinkingofview.workers.dev";
const CONFIRM_VALUE = "delete-disposable-gallery-smoke-objects";

const hostUrl = (process.env.GALLERY_HOST_URL || DEFAULT_HOST_URL).replace(/\/$/, "");
const workerUrl = (process.env.GALLERY_WORKER_URL || DEFAULT_WORKER_URL).replace(/\/$/, "");
const adminSecret = process.env.GALLERY_ADMIN_SECRET;
const adminCookie = process.env.GALLERY_ADMIN_COOKIE;
const confirm = process.env.CONFIRM_GALLERY_HOST_BULK_DELETE_SMOKE;
const siteUrl = process.env.GALLERY_SMOKE_SITE_URL || new URL(hostUrl).hostname;

if (confirm !== CONFIRM_VALUE) {
	console.error(`CONFIRM_GALLERY_HOST_BULK_DELETE_SMOKE must be "${CONFIRM_VALUE}".`);
	process.exit(1);
}

if (!adminSecret) {
	console.error(
		"GALLERY_ADMIN_SECRET is required to seed and clean up the disposable Worker object.",
	);
	process.exit(1);
}

if (!adminCookie) {
	console.error(
		"GALLERY_ADMIN_COOKIE is required. Use the full Cookie header from an authenticated admin session.",
	);
	process.exit(1);
}

const id = crypto.randomUUID();
const galleryId = `host-smoke-${id}`;
const filename = "bulk-delete-host-smoke.jpg";
const originalKey = `${siteUrl}/${galleryId}/original/${filename}`;
const previewKey = `${siteUrl}/${galleryId}/preview/${filename}`;
const thumbKey = `${siteUrl}/${galleryId}/thumb/${filename}`;
const expectedDeletedKeys = [originalKey, previewKey, thumbKey];
const workerAuthHeaders = { Authorization: `Bearer ${adminSecret}` };

const seededKeys = new Set();
let deleted = false;

function imageUrl(key) {
	return `${workerUrl}/image/${encodeURIComponent(key)}?smoke=${Date.now()}`;
}

async function assertStatus(label, response, expectedStatus) {
	if (response.status === expectedStatus) return;
	const text = await response.text().catch(() => "");
	throw new Error(
		`${label}: expected ${expectedStatus}, got ${response.status} ${text.slice(0, 200)}`,
	);
}

async function putImageKey(label, key) {
	const response = await fetch(`${workerUrl}/upload/put?key=${encodeURIComponent(key)}`, {
		method: "PUT",
		headers: { ...workerAuthHeaders, "Content-Type": "image/jpeg" },
		body: new Uint8Array([255, 216, 255, 217]),
	});
	await assertStatus(label, response, 200);
	seededKeys.add(key);
}

async function seedGalleryObjects() {
	await putImageKey("PUT original through Worker", originalKey);
	await putImageKey("PUT preview through Worker", previewKey);
	await putImageKey("PUT thumb through Worker", thumbKey);
}

async function processOriginal() {
	const response = await fetch(`${workerUrl}/upload/process`, {
		method: "POST",
		headers: { ...workerAuthHeaders, "Content-Type": "application/json" },
		body: JSON.stringify({ r2Key: originalKey }),
	});
	await assertStatus("process original through Worker", response, 200);
}

async function assertImageAvailable(label, key) {
	await assertStatus(
		label,
		await fetch(imageUrl(key), {
			headers: { "Cache-Control": "no-cache" },
		}),
		200,
	);
}

async function assertImageMissing(label, key) {
	await assertStatus(
		label,
		await fetch(imageUrl(key), {
			headers: { "Cache-Control": "no-cache" },
		}),
		404,
	);
}

async function deleteThroughHostRoute() {
	const response = await fetch(`${hostUrl}/api/admin/galleries/bulk-delete`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Cookie: adminCookie,
		},
		body: JSON.stringify({ keys: [originalKey] }),
	});
	await assertStatus("host bulk-delete route", response, 200);
	const body = await response.json();
	if (body?.success !== true) {
		throw new Error(`host bulk-delete route: expected success=true, got ${JSON.stringify(body)}`);
	}
	if (body.deleted !== expectedDeletedKeys.length) {
		throw new Error(
			`host bulk-delete route: expected deleted=${expectedDeletedKeys.length}, got ${JSON.stringify(body)}`,
		);
	}
	if (body.chunks !== 1) {
		throw new Error(`host bulk-delete route: expected chunks=1, got ${JSON.stringify(body)}`);
	}
	return body;
}

async function cleanupWithWorker() {
	if (seededKeys.size === 0 || deleted) return;
	try {
		await fetch(`${workerUrl}/admin/bulk-delete`, {
			method: "POST",
			headers: { ...workerAuthHeaders, "Content-Type": "application/json" },
			body: JSON.stringify({ keys: Array.from(seededKeys) }),
		});
	} catch {
		// Best-effort cleanup only. Preserve the original smoke failure.
	}
}

try {
	await seedGalleryObjects();
	await assertImageAvailable("GET original before host delete", originalKey);
	await assertImageAvailable("GET preview before host delete", previewKey);
	await assertImageAvailable("GET thumb before host delete", thumbKey);

	const hostDelete = await deleteThroughHostRoute();

	await assertImageMissing("GET original after host delete", originalKey);
	await assertImageMissing("GET preview after host delete", previewKey);
	await assertImageMissing("GET thumb after host delete", thumbKey);
	deleted = true;

	console.log(
		JSON.stringify(
			{
				ok: true,
				hostUrl,
				workerUrl,
				galleryId,
				originalKey,
				deleted: hostDelete.deleted,
				chunks: hostDelete.chunks,
				deletedKeys: expectedDeletedKeys,
				verified404: ["original", "preview", "thumb"],
			},
			null,
			2,
		),
	);
} catch (error) {
	await cleanupWithWorker();
	console.error(error instanceof Error ? error.message : error);
	process.exit(1);
}
