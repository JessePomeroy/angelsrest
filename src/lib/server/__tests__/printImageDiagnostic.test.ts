import { createHash } from "node:crypto";
import sharp from "sharp";
import { beforeAll, expect, test, vi } from "vitest";

vi.mock("$lib/server/catalogCommerceClients", () => ({
	issueTenantPrintSourceCapability: vi.fn(),
}));
vi.mock("$lib/server/runtimeConfig", () => ({ getLumaPrintsRuntimeConfig: vi.fn() }));

import { diagnosePreparedPrintImage, readPrintDiagnosticBytes } from "../printImageDiagnostic";

const url =
	"https://cms-media-worker.thinkingofview.workers.dev/v1/catalog-assets/fulfillment/print-source/privateToken.jpg";
let bytes: Buffer;
beforeAll(async () => {
	bytes = await sharp({ create: { width: 12, height: 8, channels: 3, background: "white" } })
		.jpeg()
		.toBuffer();
});

function fixture(providerStatus = 200, providerOverride: Record<string, unknown> = {}) {
	const source = {
		descriptor: {
			key: "sites/angelsrest.online/catalog/print-sources/private-artifact/original",
			hash: createHash("sha256").update(bytes).digest("hex"),
			bytes: bytes.length,
			mime: "image/jpeg" as const,
			dimensions: { width: 12, height: 8 },
		},
		product: { subcategoryId: 103007, orderItemOptions: [39] },
		printWidth: 6,
		printHeight: 4,
	};
	const headers = { "content-type": "image/jpeg", "content-length": String(bytes.length) };
	const request = vi
		.fn<typeof fetch>()
		.mockResolvedValueOnce(new Response(null, { headers }))
		.mockResolvedValueOnce(new Response(new Uint8Array(bytes), { headers }))
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
