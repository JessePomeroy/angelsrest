import { createHash } from "node:crypto";
import sharp from "sharp";
import { beforeAll, expect, test, vi } from "vitest";

vi.mock("$lib/server/catalogCommerceClients", () => ({
	issueTenantPrintSourceCapability: vi.fn(),
}));
vi.mock("$lib/server/runtimeConfig", () => ({ getLumaPrintsRuntimeConfig: vi.fn() }));

import { diagnosePreparedPrintImage, readPrintDiagnosticBytes } from "../printImageDiagnostic";
import { diagnosePreparedPrintImageInSandbox } from "../printImageSandboxDiagnostic";

const url =
	"https://cms-media-worker.thinkingofview.workers.dev/v1/catalog-assets/fulfillment/print-source/privateToken.jpg";
let bytes: Buffer;
beforeAll(async () => {
	bytes = await sharp({ create: { width: 12, height: 8, channels: 3, background: "white" } })
		.jpeg()
		.toBuffer();
});

function fixture(
	providerStatus = 200,
	providerOverride: Record<string, unknown> = {},
	imageBytes: Uint8Array = bytes,
) {
	const source = {
		descriptor: {
			key: "sites/angelsrest.online/catalog/print-sources/private-artifact/original",
			hash: createHash("sha256").update(imageBytes).digest("hex"),
			bytes: imageBytes.length,
			mime: "image/jpeg" as const,
			dimensions: { width: 12, height: 8 },
		},
		product: { subcategoryId: 103007, orderItemOptions: [39] },
		printWidth: 6,
		printHeight: 4,
	};
	const headers = { "content-type": "image/jpeg", "content-length": String(imageBytes.length) };
	const request = vi
		.fn<typeof fetch>()
		.mockResolvedValueOnce(new Response(null, { headers }))
		.mockResolvedValueOnce(new Response(new Uint8Array(imageBytes), { headers }))
		.mockResolvedValueOnce(
			Response.json(
				{
					message: `never return ${url} or private provider text`,
					imageUrl: url,
					actualImageWidth: 12,
					actualImageHeight: 8,
					recommendedWidth: 1800,
					recommendedHeight: 1200,
					...providerOverride,
				},
				{ status: providerStatus },
			),
		);
	const dependencies = {
		issue: vi.fn().mockResolvedValue({ url, expiresAt: Date.now() + 86_400_000 }),
		fetch: request,
		configuration: vi.fn().mockReturnValue({
			baseUrl: "https://us.api.lumaprints.com",
			apiKey: "private-key",
			apiSecret: "private-secret",
			storeId: 1,
		}),
	};
	return { source, dependencies, request, headers };
}

function jpegMarker(marker: number) {
	const offset = bytes.indexOf(Buffer.from([0xff, marker]));
	expect(offset).toBeGreaterThan(0);
	return offset;
}

function replaceHeaderValue(offset: number, value: number) {
	const changed = Buffer.from(bytes);
	changed.writeUInt16BE(value, offset);
	return changed;
}

test.each([
	"progressive",
	"oriented",
	"grayscale",
])("checks raw dimensions of a %s JPEG without changing its pixels", async (kind) => {
	let image = sharp(bytes);
	if (kind === "oriented") image = image.withMetadata({ orientation: 6 });
	if (kind === "grayscale") image = image.greyscale();
	const encoded = await image.jpeg({ progressive: kind === "progressive" }).toBuffer();
	const { source, dependencies, request } = fixture(200, {}, encoded);
	const report = await diagnosePreparedPrintImage(source, dependencies);
	expect(report).toMatchObject({
		outcome: "passed",
		image: { width: 12, height: 8, matches: true },
		provider: { dimensionComparison: "exact" },
	});
	expect(request).toHaveBeenCalledTimes(3);
});

test("rejects non-JPEG bytes even with matching hashes and JPEG HTTP headers", async () => {
	const png = await sharp(bytes).png().toBuffer();
	const { source, dependencies, request } = fixture(200, {}, png);
	expect(await diagnosePreparedPrintImage(source, dependencies)).toMatchObject({
		outcome: "failed",
		stage: "image",
		code: "image_metadata_mismatch",
	});
	expect(request).toHaveBeenCalledTimes(2);
});

test("skips marker-like bytes inside a JPEG comment instead of treating them as headers", async () => {
	const comment = Buffer.from([0xff, 0xfe, 0, 6, 0xff, 0xc0, 0xff, 0xda]);
	const encoded = Buffer.concat([bytes.subarray(0, 2), comment, bytes.subarray(2)]);
	const { source, dependencies, request } = fixture(200, {}, encoded);
	expect(await diagnosePreparedPrintImage(source, dependencies)).toMatchObject({
		outcome: "passed",
		image: { width: 12, height: 8, matches: true },
	});
	expect(request).toHaveBeenCalledTimes(3);
});

test.each([
	["unknown data", () => Buffer.from("not a JPEG")],
	["truncated signature", () => bytes.subarray(0, 2)],
	[
		"premature end marker",
		() => Buffer.concat([bytes.subarray(0, 2), Buffer.from([0xff, 0xd9, 0, 2]), bytes.subarray(2)]),
	],
	[
		"duplicate start marker",
		() => Buffer.concat([bytes.subarray(0, 2), Buffer.from([0xff, 0xd8, 0, 2]), bytes.subarray(2)]),
	],
	[
		"restart marker before the scan",
		() => Buffer.concat([bytes.subarray(0, 2), Buffer.from([0xff, 0xd0, 0, 2]), bytes.subarray(2)]),
	],
	["truncated frame", () => bytes.subarray(0, jpegMarker(0xc0) + 9)],
	[
		"truncated frame with end marker",
		() => Buffer.concat([bytes.subarray(0, jpegMarker(0xc0) + 9), Buffer.from([0xff, 0xd9])]),
	],
	["short frame length", () => replaceHeaderValue(jpegMarker(0xc0) + 2, 2)],
	["oversized frame length", () => replaceHeaderValue(jpegMarker(0xc0) + 2, 0xffff)],
	["missing scan", () => bytes.subarray(0, jpegMarker(0xda))],
	["truncated scan", () => bytes.subarray(0, jpegMarker(0xda) + 5)],
	["short scan length", () => replaceHeaderValue(jpegMarker(0xda) + 2, 2)],
	["zero segment length", () => replaceHeaderValue(4, 0)],
	["zero width", () => replaceHeaderValue(jpegMarker(0xc0) + 7, 0)],
	["zero height", () => replaceHeaderValue(jpegMarker(0xc0) + 5, 0)],
] as const)("rejects %s before any provider request", async (_name, corrupt) => {
	const { source, dependencies, request } = fixture(200, {}, corrupt());
	expect(await diagnosePreparedPrintImage(source, dependencies)).toMatchObject({
		outcome: "failed",
		stage: "image",
		code: "image_metadata_mismatch",
	});
	expect(request).toHaveBeenCalledTimes(2);
});

test.each([4000, 4001])("enforces the 40-million-pixel limit at 10000×%s", async (height) => {
	// Metadata reads do not decode pixels; patching a small fixture avoids a huge allocation.
	const large = replaceHeaderValue(jpegMarker(0xc0) + 7, 10_000);
	large.writeUInt16BE(height, jpegMarker(0xc0) + 5);
	const { source, dependencies, request } = fixture(
		200,
		{ actualImageWidth: 10_000, actualImageHeight: height },
		large,
	);
	source.descriptor.dimensions = { width: 10_000, height };
	const report = await diagnosePreparedPrintImage(source, dependencies);
	if (height === 4000) {
		expect(report.outcome).toBe("passed");
		expect(request).toHaveBeenCalledTimes(3);
	} else {
		expect(report).toMatchObject({ outcome: "failed", stage: "image" });
		expect(request).toHaveBeenCalledTimes(2);
	}
});

test("rejects dimensions that disagree with the saved descriptor", async () => {
	const { source, dependencies, request } = fixture();
	source.descriptor.dimensions.width = 13;
	expect(await diagnosePreparedPrintImage(source, dependencies)).toMatchObject({
		outcome: "failed",
		stage: "image",
		image: { width: 12, height: 8, matches: false },
	});
	expect(request).toHaveBeenCalledTimes(2);
});

test("hashes the full download, including bytes beyond the image header", async () => {
	const changed = Buffer.from(bytes);
	changed[changed.length - 3] ^= 1;
	const { source, dependencies, request } = fixture(200, {}, changed);
	source.descriptor.hash = createHash("sha256").update(bytes).digest("hex");
	expect(await diagnosePreparedPrintImage(source, dependencies)).toMatchObject({
		outcome: "failed",
		stage: "download",
	});
	expect(request).toHaveBeenCalledTimes(2);
});

test.each([0, 10_000_001])("rejects an invalid declared byte count: %s", async (size) => {
	const { source, dependencies, request } = fixture();
	source.descriptor.bytes = size;
	expect(await diagnosePreparedPrintImage(source, dependencies)).toMatchObject({
		outcome: "failed",
		stage: "configuration",
	});
	expect(dependencies.issue).not.toHaveBeenCalled();
	expect(request).not.toHaveBeenCalled();
});

test("validates the exact prepared JPEG through anonymous HEAD/GET and only the non-order endpoint", async () => {
	const { source, dependencies, request } = fixture();
	const report = await diagnosePreparedPrintImage(source, dependencies);
	expect(report).toMatchObject({
		outcome: "passed",
		code: "provider_image_validated",
		head: { status: 200, matches: true },
		download: { bytes: bytes.length, matches: true },
		image: { width: 12, height: 8, matches: true },
		provider: { status: 200, urlMatches: true, dimensionComparison: "exact", matches: true },
	});
	expect(dependencies.issue).toHaveBeenCalledExactlyOnceWith(
		source.descriptor,
		"angelsrest.online",
	);
	expect(request).toHaveBeenCalledTimes(3);
	for (const [address, options] of request.mock.calls.slice(0, 2)) {
		expect(address).toBe(url);
		expect(options?.redirect).toBe("error");
		expect(new Headers(options?.headers).has("authorization")).toBe(false);
		expect(new Headers(options?.headers).has("cookie")).toBe(false);
	}
	const [endpoint, options] = request.mock.calls[2];
	expect(endpoint).toBe("https://us.api.lumaprints.com/api/v1/images/checkImageConfig");
	expect(options?.method).toBe("POST");
	expect(options?.body).toBe(
		JSON.stringify({
			subcategoryId: 103007,
			printWidth: 6,
			printHeight: 4,
			orderItemOptions: [39],
			imageUrl: url,
		}),
	);
	expect(JSON.stringify(report)).not.toMatch(/private|https:|Authorization|imageUrl|sha256/);
});

test("checks the exact short-filename capability through the same provider path", async () => {
	const shortUrl = url.replace(/\.jpg$/, "/print.jpg");
	const { source, dependencies, request } = fixture(200, { imageUrl: shortUrl });
	dependencies.issue.mockResolvedValue({ url: shortUrl, expiresAt: Date.now() + 86_400_000 });
	const report = await diagnosePreparedPrintImage(source, dependencies);
	expect(report).toMatchObject({ outcome: "passed", provider: { urlMatches: true } });
	expect(request.mock.calls.slice(0, 2).map(([address]) => address)).toEqual([shortUrl, shortUrl]);
	expect(JSON.parse(String(request.mock.calls[2]?.[1]?.body)).imageUrl).toBe(shortUrl);
	expect(JSON.stringify(report)).not.toMatch(/privateToken|https:/);
});

test("separates the echoed URL from transposed dimensions without calling HTTP 200 a rejection", async () => {
	const { source, dependencies, request } = fixture(200, {
		actualImageWidth: 8,
		actualImageHeight: 12,
		recommendedWidth: 1200,
		recommendedHeight: 1800,
	});
	const report = await diagnosePreparedPrintImage(source, dependencies);
	expect(report).toMatchObject({
		outcome: "unverified",
		code: "provider_response_unverified",
		provider: {
			status: 200,
			urlMatches: true,
			dimensionComparison: "transposed",
			matches: false,
		},
	});
	expect(request).toHaveBeenCalledTimes(3);
	expect(JSON.stringify(report)).not.toMatch(/private|https:|Authorization|imageUrl|sha256/);
});

test("separately identifies a wrong URL even when the pixel dimensions match", async () => {
	const { source, dependencies, request } = fixture(200, {
		imageUrl: "https://private.example/other.jpg",
	});
	const report = await diagnosePreparedPrintImage(source, dependencies);
	expect(report).toMatchObject({
		outcome: "unverified",
		provider: { status: 200, urlMatches: false, dimensionComparison: "exact", matches: false },
	});
	expect(request).toHaveBeenCalledTimes(3);
	expect(JSON.stringify(report)).not.toMatch(/private|https:/);
});

test.each([
	[{ actualImageWidth: 13, actualImageHeight: 9 }, "different"],
	[{ actualImageWidth: "12" }, "unavailable"],
	[{ actualImageHeight: null }, "unavailable"],
])("keeps unexpected dimensions unverified: %s", async (providerOverride, comparison) => {
	const { source, dependencies, request } = fixture(200, providerOverride);
	expect(await diagnosePreparedPrintImage(source, dependencies)).toMatchObject({
		outcome: "unverified",
		provider: { status: 200, urlMatches: true, dimensionComparison: comparison, matches: false },
	});
	expect(request).toHaveBeenCalledTimes(3);
});

test("a non-JSON HTTP 200 is unverified rather than proof of image acceptance", async () => {
	const { source, dependencies, request, headers } = fixture();
	request
		.mockReset()
		.mockResolvedValueOnce(new Response(null, { headers }))
		.mockResolvedValueOnce(new Response(new Uint8Array(bytes), { headers }))
		.mockResolvedValueOnce(
			new Response("private unexpected provider page", {
				headers: { "Content-Type": "text/html" },
			}),
		);
	const report = await diagnosePreparedPrintImage(source, dependencies);
	expect(report).toMatchObject({
		outcome: "unverified",
		code: "provider_response_unverified",
		provider: { status: 200 },
	});
	expect(report.provider?.matches).toBeUndefined();
	expect(request).toHaveBeenCalledTimes(3);
	expect(JSON.stringify(report)).not.toContain("private");
});

test.each([
	400, 406, 500,
])("reports HTTP %s without exposing the provider's response text or retrying", async (status) => {
	const { source, dependencies, request } = fixture(status);
	const report = await diagnosePreparedPrintImage(source, dependencies);
	expect(report.outcome).toBe("failed");
	expect(report.provider?.status).toBe(status);
	expect(request).toHaveBeenCalledTimes(3);
	expect(JSON.stringify(report)).not.toMatch(/private|https:/);
});

test("a changed hash stops before the provider call", async () => {
	const { source, dependencies, request } = fixture();
	source.descriptor.hash = "0".repeat(64);
	expect(await diagnosePreparedPrintImage(source, dependencies)).toMatchObject({
		outcome: "failed",
		stage: "download",
	});
	expect(request).toHaveBeenCalledTimes(2);
});

test("a redirected or challenged image is not followed or sent to LumaPrints", async () => {
	const { source, dependencies, request } = fixture();
	request
		.mockReset()
		.mockResolvedValue(
			new Response(null, { status: 302, headers: { location: "https://private.example" } }),
		);
	expect(await diagnosePreparedPrintImage(source, dependencies)).toMatchObject({
		outcome: "failed",
		stage: "head",
	});
	expect(request).toHaveBeenCalledTimes(1);
	expect(request.mock.calls[0][1]?.redirect).toBe("error");
});

test("unexpected exceptions cannot expose capabilities or credentials", async () => {
	const { source, dependencies, request } = fixture();
	request.mockReset().mockRejectedValue(new Error(`private-key private-secret ${url}`));
	expect(JSON.stringify(await diagnosePreparedPrintImage(source, dependencies))).not.toMatch(
		/private|https:/,
	);
});

test("sandbox or stale/foreign capabilities cannot reach the image checker", async () => {
	const { source, dependencies, request } = fixture();
	dependencies.configuration.mockReturnValue({ baseUrl: "https://us.api-sandbox.lumaprints.com" });
	expect((await diagnosePreparedPrintImage(source, dependencies)).outcome).toBe("failed");
	expect(dependencies.issue).not.toHaveBeenCalled();
	dependencies.configuration.mockReturnValue({ baseUrl: "https://us.api.lumaprints.com" });
	for (const capability of [
		{ url, expiresAt: Date.now() + 1000 },
		{ url: "https://other.example/private.jpg", expiresAt: Date.now() + 86_400_000 },
	]) {
		dependencies.issue.mockResolvedValue(capability);
		expect((await diagnosePreparedPrintImage(source, dependencies)).outcome).toBe("failed");
	}
	expect(request).not.toHaveBeenCalled();
});

test("bounded reads reject a body that exceeds its saved size", async () => {
	await expect(readPrintDiagnosticBytes(new Response("oversized").body, 2)).rejects.toThrow(
		"body_limit",
	);
});

const externalId = "ar-sandbox-prepared-12345678-1234-4234-8234-123456789abc";
function sandboxFixture(providerOverride: Record<string, unknown> = {}) {
	const result = fixture(200, providerOverride);
	result.dependencies.configuration.mockReturnValue({
		baseUrl: "https://us.api-sandbox.lumaprints.com",
		apiKey: "sandbox-key",
		apiSecret: "sandbox-secret",
		storeId: 84630,
	});
	return result;
}

test("sandbox image-only mode never submits an order or uses the production API", async () => {
	const { source, dependencies, request } = sandboxFixture();
	const report = await diagnosePreparedPrintImageInSandbox(source, undefined, dependencies);
	expect(report).toMatchObject({
		environment: "sandbox",
		image: { outcome: "passed" },
		order: { outcome: "not_submitted" },
	});
	expect(request).toHaveBeenCalledTimes(3);
	expect(request.mock.calls[2][0]).toBe(
		"https://us.api-sandbox.lumaprints.com/api/v1/images/checkImageConfig",
	);
	expect(JSON.stringify(report)).not.toMatch(/private|sandbox-key|sandbox-secret|https:/);
});

test.each([
	false,
	true,
])("explicit sandbox submission uses the exact checked JPEG, synthetic recipient, and no retry (transposed=%s)", async (transposed) => {
	const { source, dependencies, request } = sandboxFixture(
		transposed ? { actualImageWidth: 8, actualImageHeight: 12 } : {},
	);
	request.mockResolvedValueOnce(
		Response.json({ orderNumber: 10000339499, message: `private ${url}` }, { status: 201 }),
	);
	const report = await diagnosePreparedPrintImageInSandbox(source, externalId, dependencies);
	expect(report).toMatchObject({
		image: { outcome: transposed ? "unverified" : "passed" },
		order: {
			outcome: "queued",
			status: 201,
			orderNumber: "10000339499",
			imageUrlSha256: createHash("sha256").update(url).digest("hex"),
		},
	});
	expect(request).toHaveBeenCalledTimes(4);
	const [endpoint, options] = request.mock.calls[3];
	expect(endpoint).toBe("https://us.api-sandbox.lumaprints.com/api/v1/orders");
	expect(options?.redirect).toBe("error");
	expect(JSON.parse(String(options?.body))).toMatchObject({
		externalId,
		storeId: 84630,
		recipient: { firstName: "Sandbox", lastName: "Test", addressLine1: "955 E Ball Rd" },
		orderItems: [
			{
				quantity: 1,
				subcategoryId: 103007,
				width: 6,
				height: 4,
				file: { imageUrl: url },
				orderItemOptions: [39],
			},
		],
	});
	expect(dependencies.issue).toHaveBeenCalledTimes(1);
	expect(JSON.stringify(report)).not.toMatch(/private|sandbox-key|sandbox-secret|https:/);
});

test.each([
	{ imageUrl: "https://other.example/private.jpg" },
	{ actualImageHeight: 9 },
	{ actualImageWidth: null },
])("sandbox never submits after an unverifiable image: %s", async (providerOverride) => {
	const { source, dependencies, request } = sandboxFixture(providerOverride);
	expect(
		(await diagnosePreparedPrintImageInSandbox(source, externalId, dependencies)).order.outcome,
	).toBe("not_submitted");
	expect(request).toHaveBeenCalledTimes(3);
});

test("sandbox fails closed for live configuration, an invalid test ID, and absent credentials", async () => {
	const { source, dependencies, request } = fixture();
	expect(
		(await diagnosePreparedPrintImageInSandbox(source, externalId, dependencies)).order.outcome,
	).toBe("not_submitted");
	expect(
		(await diagnosePreparedPrintImageInSandbox(source, "cs_live_never", dependencies)).order
			.outcome,
	).toBe("not_submitted");
	dependencies.configuration.mockImplementation(() => {
		throw new Error("private credentials missing");
	});
	expect(
		(await diagnosePreparedPrintImageInSandbox(source, externalId, dependencies)).order.outcome,
	).toBe("not_submitted");
	expect(dependencies.issue).not.toHaveBeenCalled();
	expect(request).not.toHaveBeenCalled();
});

test.each([
	[400, "rejected"],
	[406, "rejected"],
	[429, "unknown"],
	[500, "unknown"],
	[201, "unknown"],
])("sandbox preserves uncertain/rejected status %s and never retries", async (status, outcome) => {
	const { source, dependencies, request } = sandboxFixture();
	request.mockResolvedValueOnce(
		Response.json({ message: `private ${url}` }, { status: Number(status) }),
	);
	const report = await diagnosePreparedPrintImageInSandbox(source, externalId, dependencies);
	expect(report.order).toMatchObject({ outcome, status });
	expect(request).toHaveBeenCalledTimes(4);
	expect(JSON.stringify(report)).not.toMatch(/private|https:/);
});

test("sandbox POST transport failure stays unknown and is never retried", async () => {
	const { source, dependencies, request } = sandboxFixture();
	request.mockRejectedValueOnce(new Error(`private ${url}`));
	expect(
		(await diagnosePreparedPrintImageInSandbox(source, externalId, dependencies)).order.outcome,
	).toBe("unknown");
	expect(request).toHaveBeenCalledTimes(4);
});
