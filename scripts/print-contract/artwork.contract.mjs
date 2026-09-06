import { createHash } from "node:crypto";
import {
	handleCreateCatalogPrivateUploadCapability,
	handlePutCatalogPrivateSource,
} from "@print-worker/catalogPrivateUploadRoutes";
import { handleCmsFulfillmentRequest } from "@print-worker/fulfillmentCapabilities";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	issueTenantPrintSourceCapability,
	storePrintArtifact,
} from "../../src/lib/server/catalogCommerceClients";
import { adminSecret, issuerSecret, origin, tenant, uploadSecret } from "./env.mjs";

// The only fake is the storage/runtime boundary, not either side of the HTTP protocol.
function storage() {
	const objects = new Map();
	return {
		objects,
		async head(key) {
			return objects.get(key) ?? null;
		},
		async put(key, stream, options) {
			expect(options.onlyIf.get("If-None-Match")).toBe("*");
			if (objects.has(key)) return null;
			const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
			const hash = createHash("sha256").update(bytes).digest("hex");
			if (hash !== Buffer.from(options.sha256).toString("hex"))
				throw new Error("Checksum mismatch");
			const object = {
				key,
				size: bytes.length,
				etag: hash,
				httpEtag: `"${hash}"`,
				uploaded: new Date(),
				httpMetadata: options.httpMetadata,
				customMetadata: options.customMetadata,
				checksums: { sha256: options.sha256 },
				bytes,
			};
			objects.set(key, object);
			return object;
		},
		async get(key, options) {
			const object = objects.get(key);
			if (!object || options.onlyIf.etagMatches !== object.etag) return null;
			return { ...object, body: new Response(object.bytes).body };
		},
	};
}

class FixedLengthStream extends TransformStream {
	constructor(expected) {
		let seen = 0;
		super({
			transform(chunk, controller) {
				seen += chunk.byteLength;
				if (seen > expected) throw new Error("Upload too long");
				controller.enqueue(chunk);
			},
			flush() {
				if (seen !== expected) throw new Error("Upload too short");
			},
		});
	}
}

describe("host ↔ Worker print artwork contract (no network)", () => {
	let bucket;
	let workerEnv;
	let requests;
	let rendered;
	beforeEach(async () => {
		bucket = storage();
		requests = [];
		const registry = (secret) => JSON.stringify({ [tenant]: [secret] });
		workerEnv = {
			CMS_MEDIA_PRIVATE_BUCKET: bucket,
			CMS_MEDIA_TENANT_SECRETS: registry(adminSecret),
			CATALOG_PRINT_ARTIFACT_UPLOAD_SECRETS: registry(uploadSecret),
			CATALOG_PRIVATE_FULFILLMENT_PRINT_SOURCE_ISSUER_SECRETS: registry(issuerSecret),
			CATALOG_PRIVATE_FULFILLMENT_PAID_DOWNLOAD_ISSUER_SECRETS: registry(
				"fixture-paid-issuer-0123456789abcdef",
			),
			CATALOG_PRIVATE_FULFILLMENT_SEALING_ROOTS: JSON.stringify({
				current: Buffer.alloc(32, 17).toString("base64url"),
				previous: null,
			}),
		};
		vi.stubGlobal("FixedLengthStream", FixedLengthStream);
		vi.stubGlobal("fetch", async (input, init) => {
			const request = new Request(input, init);
			const url = new URL(request.url);
			// No fallback to real fetch: an unexpected origin/path fails the proof.
			expect(url.origin).toBe(origin);
			requests.push(`${request.method} ${url.pathname}`);
			if (url.pathname === "/v1/catalog-assets/uploads/capabilities" && request.method === "POST") {
				return handleCreateCatalogPrivateUploadCapability(request, workerEnv);
			}
			if (url.pathname === "/v1/catalog-assets/uploads/source" && request.method === "PUT") {
				return handlePutCatalogPrivateSource(request, workerEnv);
			}
			if (url.pathname.startsWith("/v1/catalog-assets/fulfillment/print-source/")) {
				return handleCmsFulfillmentRequest(request, workerEnv);
			}
			throw new Error("Unexpected contract request");
		});
		const bytes = await sharp({
			create: { width: 600, height: 400, channels: 3, background: "#345678" },
		})
			.jpeg()
			.toBuffer();
		rendered = {
			bytes,
			hash: createHash("sha256").update(bytes).digest("hex"),
			width: 600,
			height: 400,
		};
	});
	afterEach(() => vi.unstubAllGlobals());

	it("stores exact JPEG bytes, issues a usable 24-hour URL, and resumes without rewriting", async () => {
		const descriptor = await storePrintArtifact(tenant, rendered);
		const capability = await issueTenantPrintSourceCapability(descriptor, tenant);
		expect(capability.expiresAt - Date.now()).toBeGreaterThan(23 * 60 * 60 * 1000);
		const head = await fetch(capability.url, { method: "HEAD" });
		expect(head.status).toBe(200);
		expect(head.headers.get("content-type")).toBe("image/jpeg");
		expect(Number(head.headers.get("content-length"))).toBe(rendered.bytes.length);
		expect(await head.text()).toBe("");
		const response = await fetch(capability.url);
		expect(response.status).toBe(200);
		const bytes = Buffer.from(await response.arrayBuffer());
		expect(bytes.equals(rendered.bytes)).toBe(true);
		expect(await sharp(bytes).metadata()).toMatchObject({
			format: "jpeg",
			width: 600,
			height: 400,
		});
		expect(await storePrintArtifact(tenant, rendered)).toEqual(descriptor);
		expect(requests.filter((request) => request.startsWith("PUT "))).toHaveLength(1);
		expect(bucket.objects.size).toBe(1);
	});

	it("fails closed for a different tenant or a wrong byte hash", async () => {
		await expect(
			storePrintArtifact("another.example", rendered, { origin, bearer: uploadSecret }),
		).rejects.toThrow();
		expect(requests).toEqual(["POST /v1/catalog-assets/uploads/capabilities"]);
		await expect(
			storePrintArtifact(tenant, { ...rendered, hash: "ab".repeat(32) }),
		).rejects.toThrow();
		expect(requests.filter((request) => request.startsWith("PUT "))).toHaveLength(1);
		expect(bucket.objects.size).toBe(0);
	});

	it("does not turn an upload credential into a provider URL issuer", async () => {
		const descriptor = await storePrintArtifact(tenant, rendered);
		workerEnv.CATALOG_PRIVATE_FULFILLMENT_PRINT_SOURCE_ISSUER_SECRETS = JSON.stringify({
			[tenant]: [uploadSecret],
		});
		await expect(issueTenantPrintSourceCapability(descriptor, tenant)).rejects.toThrow();
	});
});
