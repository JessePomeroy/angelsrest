import { handleDownload } from "@gallery-worker/routes/download";
import { handleImage } from "@gallery-worker/routes/image";
import { handlePresign, handleProcess, handlePut } from "@gallery-worker/routes/upload";
import {
	mockR2Bucket,
	mockR2Get,
	mockR2Object,
	mockR2ObjectBody,
	mockR2Put,
	TEST_ADMIN_TENANT_SECRETS,
	TEST_ANGELS_ADMIN_SECRET,
	TEST_REFLECTING_ADMIN_SECRET,
} from "@gallery-worker-tests/support/testEnv";
import {
	createGalleryPresignHandler,
	createGalleryProcessHandler,
	createGalleryUploadSessionHandler,
	setServerConfig,
} from "@jessepomeroy/admin/server";
import { afterEach, expect, test, vi } from "vitest";

afterEach(() => vi.unstubAllGlobals());

function request(path, body, authenticated = true) {
	return new Request(`https://host.example/api/admin/galleries/${path}`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			...(authenticated ? { Cookie: "fixture-session=valid" } : {}),
		},
		body: JSON.stringify(body),
	});
}

test.each([
	["angelsrest.online", TEST_ANGELS_ADMIN_SECRET, "all-files"],
	["zippymiggy.com", TEST_REFLECTING_ADMIN_SECRET, "media"],
])("the packed Admin and Worker agree on %s upload authority and download-only storage", async (siteUrl, secret, policy) => {
	const objects = new Map();
	const bucket = mockR2Bucket({
		put: mockR2Put(async (key, value, options) => {
			if (objects.has(key) && options?.onlyIf?.get("If-None-Match") === "*") return null;
			const bytes = await new Response(value).arrayBuffer();
			const metadata = mockR2Object({
				key,
				size: bytes.byteLength,
				contentType: options?.httpMetadata?.contentType,
			});
			objects.set(key, { bytes, metadata });
			return metadata;
		}),
		head: vi.fn(async (key) => objects.get(key)?.metadata ?? null),
		get: mockR2Get(async (key) => {
			const value = objects.get(key);
			return value
				? mockR2ObjectBody({
						...value.metadata,
						contentType: value.metadata.httpMetadata.contentType,
						body: new Uint8Array(value.bytes),
					})
				: null;
		}),
	});
	const env = {
		ADMIN_TENANT_SECRETS: TEST_ADMIN_TENANT_SECRETS,
		CONVEX_URL: "https://convex.example",
		GALLERY_BUCKET: bucket,
	};
	setServerConfig({
		siteUrl,
		siteName: "fixture",
		fromEmail: "fixture@example.invalid",
		isCreator: policy === "all-files",
		api: {},
		convexUrl: env.CONVEX_URL,
		resendApiKey: "fixture-only",
		galleryWorkerUrl: "https://worker.example",
		galleryAdminSecret: secret,
		verifyAdmin: async (input) => input.headers.get("Cookie") === "fixture-session=valid",
		...(policy === "all-files" ? { resolveGalleryUploadPolicy: async () => policy } : {}),
	});
	vi.stubGlobal(
		"FixedLengthStream",
		class extends TransformStream {
			constructor(expectedBytes) {
				let receivedBytes = 0;
				super({
					transform(chunk, controller) {
						receivedBytes += chunk.byteLength;
						if (receivedBytes > expectedBytes) throw new Error("Upload exceeded declared size");
						controller.enqueue(chunk);
					},
					flush() {
						if (receivedBytes !== expectedBytes) throw new Error("Upload size mismatch");
					},
				});
			}
		},
	);
	const transport = vi.fn(async (url, init) => {
		if (url === "https://worker.example/upload/presign")
			return handlePresign(new Request(url, init), env);
		if (url === "https://worker.example/upload/process")
			return handleProcess(new Request(url, init), env);
		if (url === "https://convex.example/api/query")
			return Response.json({
				status: "success",
				value: {
					expired: false,
					token: { type: "gallery", siteUrl, documentId: "gallery-1" },
					document: { downloadEnabled: true },
				},
			});
		throw new Error(`Unexpected contract request: ${url}`);
	});
	vi.stubGlobal("fetch", transport);
	const session = await createGalleryUploadSessionHandler()({
		request: request("upload-session", { siteUrl, galleryId: "gallery-1" }),
	});
	const { uploadSessionToken } = await session.json();
	const bytes = "fictional project archive bytes";
	const input = {
		siteUrl,
		galleryId: "gallery-1",
		filename: "project.zip",
		contentType: "application/octet-stream",
		sizeBytes: bytes.length,
		uploadSessionToken,
		uploadPolicy: "all-files",
	};

	if (policy === "media") {
		await expect(
			createGalleryPresignHandler()({ request: request("presign", input) }),
		).rejects.toMatchObject({ status: 400 });
		expect(transport).not.toHaveBeenCalled();
		input.filename = "ceremony.mkv";
		input.contentType = "video/x-matroska";
	}
	const presign = await createGalleryPresignHandler()({
		request: request("presign", input, false),
	});
	expect(presign.status).toBe(200);
	const { r2Key, uploadUrl, uploadToken } = await presign.json();
	const upload = await handlePut(
		new Request(new URL(uploadUrl, "https://worker.example"), {
			method: "PUT",
			body: bytes,
			headers: {
				"X-Gallery-Upload-Token": uploadToken,
				"Content-Type": input.contentType,
				"Content-Length": String(bytes.length),
			},
		}),
		env,
	);
	expect(upload.status).toBe(200);
	const processed = await createGalleryProcessHandler()({
		request: request("process", { r2Key, uploadSessionToken }, false),
	});
	expect(processed.status).toBe(200);
	const inline = await handleImage(
		new Request(
			`https://worker.example/image/${encodeURIComponent(r2Key)}?token=fixture&accessGrant=grant`,
		),
		env,
		r2Key,
	);
	expect(inline.status).toBe(415);
	const download = await handleDownload(
		new Request(
			`https://worker.example/download/${encodeURIComponent(r2Key)}?token=fixture&accessGrant=grant`,
		),
		env,
		r2Key,
	);
	expect(download.status).toBe(200);
	expect(download.headers.get("Content-Disposition")).toContain(`filename="${input.filename}"`);
	expect(download.headers.get("X-Content-Type-Options")).toBe("nosniff");
	expect(await download.text()).toBe(bytes);
});
