import { brotliCompressSync, deflateSync, gzipSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import {
	CatalogBoundaryError,
	issuePaidFile,
	issuePrintSource,
	resolveCatalogCheckout,
	resolvePaidDownload,
	resolvePaidFulfillment,
} from "$lib/server/catalogCommerceClients";

const token = "a".repeat(32);
const origin = "https://private.example";
const sealedCapability = Buffer.alloc(64, 7).toString("base64url");
function capability(purpose: "paid_file" | "print_source", extension?: "jpg" | "png" | "zip") {
	const segment = purpose === "print_source" ? "print-source" : "paid-file";
	const suffix = extension ?? (purpose === "print_source" ? "jpg" : "zip");
	return `${origin}/v1/catalog-assets/fulfillment/${segment}/${sealedCapability}.${suffix}`;
}
function json(value: unknown, status = 200) {
	const body = JSON.stringify(value);
	return new Response(body, {
		status,
		headers: {
			"content-type": "application/json",
			"content-length": String(Buffer.byteLength(body)),
		},
	});
}
function fetchDecodedJson(value: unknown, encoding: "br" | "deflate" | "gzip") {
	const body = JSON.stringify(value);
	const encoded =
		encoding === "gzip"
			? gzipSync(body)
			: encoding === "br"
				? brotliCompressSync(body)
				: deflateSync(body);
	return new Response(body, {
		headers: {
			"content-type": "application/json",
			"content-encoding": encoding,
			"content-length": String(encoded.byteLength),
		},
	});
}
const snapshotItem = {
	productKey: "product",
	revisionId: "revision",
	productKind: "print" as const,
	variantKey: "variant",
	materialOptionKey: "paper",
	sizeOptionKey: "size",
	borderOptionKey: null,
	frameOptionKey: null,
};
const checkoutResponse = {
	version: 1,
	purpose: "checkout",
	item: snapshotItem,
	identity: {},
	commerce: {},
	media: [],
};

function paidResponse(purpose: "paid_fulfillment" | "paid_download") {
	return {
		version: 1,
		purpose,
		item: snapshotItem,
		identity: { productKind: purpose === "paid_download" ? "digital_download" : "print" },
		commerce: {
			finish:
				purpose === "paid_download"
					? null
					: {
							paper: { subcategoryId: 1 },
							size: { width: 8, height: 10 },
							border: { inches: 0 },
							frame: { subcategoryId: 0 },
							canvas: null,
						},
		},
		media: [],
		current: {
			kindEnabled: true,
			publishedRevision: true,
			slugMatches: true,
			available: true,
			variantEnabled: true,
		},
		descriptor:
			purpose === "paid_download"
				? {
						kind: "paid_zip",
						relationKey: "paid",
						key: "paid/key",
						hash: "b".repeat(64),
						bytes: 12,
						mime: "application/zip",
						filename: "paid.zip",
						version: null,
					}
				: {
						kind: "print_sources",
						sources: [
							{
								memberKey: null,
								relationKey: "print",
								key: "print/key",
								hash: "b".repeat(64),
								bytes: 12,
								mime: "image/jpeg",
								dimensions: { width: 10, height: 10 },
							},
						],
					},
	};
}

describe("fixed-purpose catalog clients", () => {
	it("dispatches each Convex purpose to its exact path and bearer", async () => {
		const fetch = vi.fn(async (_url: URL | RequestInfo, init?: RequestInit) => {
			const body = JSON.parse(String(init?.body));
			const purpose = body.item
				? "checkout"
				: body.itemIndex === 1
					? "paid_download"
					: "paid_fulfillment";
			return json(purpose === "checkout" ? checkoutResponse : paidResponse(purpose));
		});
		const config = { origin, bearer: token, fetch };
		await resolveCatalogCheckout(snapshotItem, config);
		await resolvePaidFulfillment("cs_test_123456789", 0, config);
		await resolvePaidDownload("cs_test_123456789", 1, config);
		expect(fetch.mock.calls.map(([url]) => url)).toEqual([
			`${origin}/commerce/catalog/checkout/resolve`,
			`${origin}/commerce/catalog/paid-fulfillment/resolve`,
			`${origin}/commerce/catalog/paid-download/resolve`,
		]);
		for (const [, init] of fetch.mock.calls) {
			expect(init?.headers).toEqual({
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
			});
			expect(init?.signal).toBeInstanceOf(AbortSignal);
		}
	});

	it.each([
		["zero", { width: 0, height: 10 }, "image/jpeg"],
		["negative", { width: 10, height: -1 }, "image/jpeg"],
		["fractional", { width: 10.5, height: 10 }, "image/jpeg"],
		["oversized", { width: 100_001, height: 10 }, "image/jpeg"],
		["wrongly typed", { width: "10", height: 10 }, "image/jpeg"],
		["non-print MIME", { width: 10, height: 10 }, "image/webp"],
	] as const)("rejects %s paid print-source metadata at the resolver boundary", async (_case, dimensions, mime) => {
		const response = structuredClone(paidResponse("paid_fulfillment")) as Record<string, unknown>;
		const descriptor = response.descriptor as { sources: Array<Record<string, unknown>> };
		const source = descriptor.sources[0];
		if (!source) throw new Error("Paid response fixture lost its print source");
		source.dimensions = dimensions;
		source.mime = mime;
		const fetch = vi.fn(async () => json(response));
		await expect(
			resolvePaidFulfillment("cs_test_123456789", 0, { origin, bearer: token, fetch }),
		).rejects.toMatchObject({ kind: "rejected", phase: "envelope" });
		expect(fetch).toHaveBeenCalledOnce();
	});

	it.each([
		"gzip",
		"br",
		"deflate",
	] as const)("accepts a Fetch-decoded %s JSON body whose content length describes encoded bytes", async (encoding) => {
		const fetch = vi.fn(async () => fetchDecodedJson(checkoutResponse, encoding));
		await expect(
			resolveCatalogCheckout(snapshotItem, { origin, bearer: token, fetch }),
		).resolves.toEqual(checkoutResponse);
		expect(fetch).toHaveBeenCalledOnce();
	});

	it("bounds Fetch-decoded compressed bytes instead of encoded content length", async () => {
		const fetch = vi.fn(
			async () =>
				new Response(JSON.stringify(checkoutResponse), {
					headers: {
						"content-type": "application/json",
						"content-encoding": "gzip",
						"content-length": String(64 * 1024 + 1),
					},
				}),
		);
		await expect(
			resolveCatalogCheckout(snapshotItem, { origin, bearer: token, fetch }),
		).resolves.toEqual(checkoutResponse);
		expect(fetch).toHaveBeenCalledOnce();
	});

	it("rejects unencoded length mismatch and unknown or compound encodings without retry", async () => {
		const body = JSON.stringify(checkoutResponse);
		const responses = [
			new Response(body, {
				headers: {
					"content-type": "application/json",
					"content-length": String(Buffer.byteLength(body) - 1),
				},
			}),
			new Response(body, {
				headers: { "content-type": "application/json", "content-encoding": "zstd" },
			}),
			new Response(body, {
				headers: { "content-type": "application/json", "content-encoding": "gzip, br" },
			}),
		];
		for (const response of responses) {
			const fetch = vi.fn(async () => response);
			await expect(
				resolveCatalogCheckout(snapshotItem, { origin, bearer: token, fetch }),
			).rejects.toMatchObject({ kind: "rejected" });
			expect(fetch).toHaveBeenCalledOnce();
		}
	});

	it("keeps identity content-length equality without retry", async () => {
		const body = JSON.stringify(checkoutResponse);
		for (const [declared, expected] of [
			[String(Buffer.byteLength(body)), "resolved"],
			[String(Buffer.byteLength(body) - 1), "rejected"],
		] as const) {
			const fetch = vi.fn(
				async () =>
					new Response(body, {
						headers: {
							"content-type": "application/json",
							"content-encoding": "identity",
							"content-length": declared,
						},
					}),
			);
			const resolution = resolveCatalogCheckout(snapshotItem, { origin, bearer: token, fetch });
			if (expected === "resolved") await expect(resolution).resolves.toEqual(checkoutResponse);
			else
				await expect(resolution).rejects.toMatchObject({
					kind: "rejected",
					phase: "declared_length",
				});
			expect(fetch).toHaveBeenCalledOnce();
		}
	});

	it.each([
		["rejects", () => Promise.reject(new Error("private cancellation detail"))],
		["does not settle", () => new Promise<void>(() => {})],
	] as const)("preserves decoded overflow rejection when stream cancellation %s", async (_case, cancel) => {
		const fetch = vi.fn(
			async () =>
				new Response(
					new ReadableStream({
						start(controller) {
							controller.enqueue(new Uint8Array(64 * 1024 + 1));
						},
						cancel,
					}),
					{
						headers: {
							"content-type": "application/json",
							"content-encoding": "gzip",
							"content-length": "100",
						},
					},
				),
		);
		await expect(
			resolveCatalogCheckout(snapshotItem, { origin, bearer: token, fetch }),
		).rejects.toMatchObject({ kind: "rejected", phase: "stream" });
		expect(fetch).toHaveBeenCalledOnce();
	});

	it("classifies body stream failures as unavailable without retry", async () => {
		const fetch = vi.fn(
			async () =>
				new Response(
					new ReadableStream({
						start(controller) {
							controller.error(new Error("private transport detail"));
						},
					}),
					{ headers: { "content-type": "application/json" } },
				),
		);
		await expect(
			resolveCatalogCheckout(snapshotItem, { origin, bearer: token, fetch }),
		).rejects.toMatchObject({ kind: "unavailable", phase: "stream" });
		expect(fetch).toHaveBeenCalledOnce();
	});

	it("composes a caller abort with the fixed five-second checkout bound without retry", async () => {
		const controller = new AbortController();
		const fetch = vi.fn(async (_url: URL | RequestInfo, _init?: RequestInit) =>
			json(checkoutResponse),
		);
		await resolveCatalogCheckout(snapshotItem, {
			origin,
			bearer: token,
			fetch,
			signal: controller.signal,
		});
		const requestSignal = fetch.mock.calls[0]?.[1]?.signal;
		controller.abort();
		expect(requestSignal?.aborted).toBe(true);
		expect(fetch).toHaveBeenCalledOnce();
	});

	it("issues exact descriptors on disjoint Worker routes and returns opaque URLs unchanged", async () => {
		const printCapability = capability("print_source");
		const paidCapability = capability("paid_file");
		const now = Date.now();
		const fetch = vi.fn(async (url: URL | RequestInfo, _init?: RequestInit) =>
			json({
				version: 1,
				url: String(url).includes("print-source") ? printCapability : paidCapability,
				expiresAt: new Date(
					now + (String(url).includes("print-source") ? 24 * 60 * 60 * 1000 : 5 * 60 * 1000),
				).toISOString(),
			}),
		);
		const descriptor = {
			key: "private/key",
			hash: "c".repeat(64),
			bytes: 10,
			mime: "image/jpeg" as const,
			dimensions: { width: 6000, height: 4000 },
			relationKey: "must-not-cross",
		};
		expect(await issuePrintSource(descriptor, { origin, bearer: token, fetch })).toBe(
			printCapability,
		);
		expect(
			await issuePaidFile(
				{ ...descriptor, mime: "application/zip" },
				{
					origin,
					bearer: "b".repeat(32),
					fetch,
				},
			),
		).toBe(paidCapability);
		expect(fetch.mock.calls.map(([url]) => url)).toEqual([
			`${origin}/v1/catalog-assets/fulfillment/print-source/capabilities`,
			`${origin}/v1/catalog-assets/fulfillment/paid-file/capabilities`,
		]);
		expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual({
			version: 1,
			key: descriptor.key,
			hash: descriptor.hash,
			bytes: descriptor.bytes,
			mime: descriptor.mime,
		});
	});

	it("validates print dimensions and MIME before requesting a capability", async () => {
		const valid = {
			key: "private/key",
			hash: "c".repeat(64),
			bytes: 10,
			mime: "image/jpeg" as const,
			dimensions: { width: 6000, height: 4000 },
		};
		const candidates = [
			{ ...valid, dimensions: { width: 0, height: 4000 } },
			{ ...valid, dimensions: { width: -1, height: 4000 } },
			{ ...valid, dimensions: { width: 1.5, height: 4000 } },
			{ ...valid, dimensions: { width: 100_001, height: 4000 } },
			{ ...valid, dimensions: { width: 6000, height: Number.NaN } },
			{ ...valid, dimensions: { width: 6000, height: 4000, depth: 8 } },
			{ ...valid, mime: "image/webp" },
		];
		const fetch = vi.fn();
		for (const candidate of candidates) {
			await expect(
				issuePrintSource(candidate as unknown as Parameters<typeof issuePrintSource>[0], {
					origin,
					bearer: token,
					fetch,
				}),
			).rejects.toMatchObject({ kind: "rejected", phase: "envelope" });
		}
		expect(fetch).not.toHaveBeenCalled();
	});

	it("rejects stale, wrong-origin, wrong-purpose, noncanonical, and decorated capabilities", async () => {
		const descriptor = {
			key: "private/key",
			hash: "c".repeat(64),
			bytes: 10,
			mime: "image/jpeg" as const,
			dimensions: { width: 6000, height: 4000 },
		};
		const now = Date.now();
		const candidates = [
			{ url: capability("print_source"), expiresAt: new Date(now - 1).toISOString() },
			{
				url: capability("print_source"),
				expiresAt: new Date(now + 22 * 60 * 60 * 1000).toISOString(),
			},
			{
				url: capability("print_source"),
				expiresAt: new Date(now + 24 * 60 * 60 * 1000 + 120_000).toISOString(),
			},
			{
				url: capability("print_source").replace(origin, "https://other.example"),
				expiresAt: new Date(now + 60_000).toISOString(),
			},
			{
				url: capability("paid_file"),
				expiresAt: new Date(now + 60_000).toISOString(),
			},
			{
				url: capability("print_source", "png"),
				expiresAt: new Date(now + 60_000).toISOString(),
			},
			{
				url: capability("print_source").replace(sealedCapability, `${sealedCapability}=`),
				expiresAt: new Date(now + 60_000).toISOString(),
			},
			{
				url: `${capability("print_source")}?download=1`,
				expiresAt: new Date(now + 60_000).toISOString(),
			},
			{
				url: `${capability("print_source")}#fragment`,
				expiresAt: new Date(now + 60_000).toISOString(),
			},
		];
		for (const [index, candidate] of candidates.entries()) {
			const fetch = vi.fn(async () => json({ version: 1, ...candidate }));
			const outcome = await issuePrintSource(descriptor, { origin, bearer: token, fetch })
				.then(() => ({ kind: "accepted" as const }))
				.catch((error: unknown) => ({ kind: "rejected" as const, error }));
			if (outcome.kind === "accepted") {
				throw new Error(`Capability candidate ${index} was accepted`);
			}
			expect(outcome.error).toMatchObject({ kind: "rejected", phase: "envelope" });
			expect(fetch).toHaveBeenCalledOnce();
		}
	});

	it("accepts the 24-hour print and 15-minute paid-file lifetime contracts", async () => {
		for (const { issue, url, lifetime } of [
			{
				url: capability("print_source", "png"),
				lifetime: 24 * 60 * 60 * 1000,
				issue: (fetch: typeof globalThis.fetch) =>
					issuePrintSource(
						{
							key: "private/key",
							hash: "c".repeat(64),
							bytes: 10,
							mime: "image/png",
							dimensions: { width: 6000, height: 4000 },
						},
						{ origin, bearer: token, fetch },
					),
			},
			{
				url: capability("paid_file"),
				lifetime: 15 * 60 * 1000,
				issue: (fetch: typeof globalThis.fetch) =>
					issuePaidFile(
						{
							key: "private/key",
							hash: "c".repeat(64),
							bytes: 10,
							mime: "application/zip",
						},
						{ origin, bearer: token, fetch },
					),
			},
		]) {
			const expiresAt = new Date(Date.now() + lifetime).toISOString();
			const fetch = vi.fn(async () => json({ version: 1, url, expiresAt }));
			await expect(issue(fetch)).resolves.toBe(url);
		}
	});

	it("defaults unavailable, rejects non-exact origins and bounded responses, and never retries", async () => {
		await expect(resolveCatalogCheckout(snapshotItem, {})).rejects.toMatchObject({
			kind: "unavailable",
		});
		await expect(
			resolveCatalogCheckout(snapshotItem, { origin: `${origin}/`, bearer: token }),
		).rejects.toBeInstanceOf(CatalogBoundaryError);
		const fetch = vi.fn(
			async (_url: URL | RequestInfo, _init?: RequestInit) =>
				new Response("{}", {
					headers: { "content-type": "application/json", "content-length": String(70_000) },
				}),
		);
		await expect(
			resolveCatalogCheckout(snapshotItem, { origin, bearer: token, fetch }),
		).rejects.toMatchObject({ kind: "rejected" });
		expect(fetch).toHaveBeenCalledTimes(1);
	});
});
