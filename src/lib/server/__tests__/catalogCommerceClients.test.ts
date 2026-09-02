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
	materialOptionKey: "archival-matte",
	sizeOptionKey: "8x10",
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
	const item =
		purpose === "paid_download"
			? {
					...snapshotItem,
					productKind: "digital_download" as const,
					materialOptionKey: null,
					sizeOptionKey: null,
				}
			: snapshotItem;
	return {
		version: 1,
		purpose,
		item,
		identity: {
			productId: "product",
			revisionId: "revision",
			productKind: purpose === "paid_download" ? "digital_download" : "print",
			title: "Product",
			slug: "product",
			variantKey: item.variantKey,
		},
		commerce: {
			currency: "usd",
			amountCents: 2_500,
			finish:
				purpose === "paid_download"
					? null
					: {
							materialKey: "archival-matte",
							sizeKey: "8x10",
							borderKey: null,
							frameKey: null,
							paper: { name: "Archival Matte", subcategoryId: 103001 },
							size: { label: "8×10", width: 8, height: 10 },
							border: { inches: 0 },
							frame: { subcategoryId: 0 },
							canvas: null,
						},
		},
		media: [{}],
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
		[
			"an extra finish field",
			(finish: Record<string, unknown>) => {
				finish.extra = true;
			},
		],
		[
			"an unsafe paper ID",
			(finish: Record<string, unknown>) => {
				(finish.paper as Record<string, unknown>).subcategoryId = Number.MAX_SAFE_INTEGER + 1;
			},
		],
		[
			"an unsupported paper ID",
			(finish: Record<string, unknown>) => {
				(finish.paper as Record<string, unknown>).subcategoryId = 103999;
			},
		],
		[
			"a fractional size",
			(finish: Record<string, unknown>) => {
				(finish.size as Record<string, unknown>).width = 8.5;
			},
		],
		[
			"a negative border",
			(finish: Record<string, unknown>) => {
				(finish.border as Record<string, unknown>).inches = -0.25;
			},
		],
		[
			"an unsupported border",
			(finish: Record<string, unknown>) => {
				(finish.border as Record<string, unknown>).inches = 0.75;
			},
		],
		[
			"an unsupported frame ID",
			(finish: Record<string, unknown>) => {
				(finish.frame as Record<string, unknown>).subcategoryId = 105004;
			},
		],
	] as const)("rejects paid fulfillment finish metadata with %s", async (_case, mutate) => {
		const response = structuredClone(paidResponse("paid_fulfillment")) as Record<string, unknown>;
		const commerce = response.commerce as Record<string, unknown>;
		mutate(commerce.finish as Record<string, unknown>);
		const fetch = vi.fn(async () => json(response));
		await expect(
			resolvePaidFulfillment("cs_test_123456789", 0, { origin, bearer: token, fetch }),
		).rejects.toMatchObject({ kind: "rejected", phase: "envelope" });
		expect(fetch).toHaveBeenCalledOnce();
	});

	it("accepts only the catalog-supported canvas IDs, option, and strict six-digit wrap hex", async () => {
		const response = structuredClone(paidResponse("paid_fulfillment")) as Record<string, unknown>;
		const item = response.item as Record<string, unknown>;
		item.materialOptionKey = "canvas-white-1.25";
		const finish = (response.commerce as { finish: Record<string, unknown> }).finish;
		finish.materialKey = "canvas-white-1.25";
		finish.paper = { name: 'Canvas White — 1.25" stretch', subcategoryId: 101002 };
		finish.canvas = {
			color: "white",
			thickness: "1.25",
			subcategoryId: 101002,
			wrapOptionId: 3,
			wrapHex: "#FFFFFF",
		};
		const validFetch = vi.fn(async () => json(response));
		await expect(
			resolvePaidFulfillment("cs_test_123456789", 0, {
				origin,
				bearer: token,
				fetch: validFetch,
			}),
		).resolves.toMatchObject({ commerce: { finish: { canvas: { wrapHex: "#FFFFFF" } } } });

		for (const canvas of [
			{ ...(finish.canvas as object), wrapHex: "FFFFFF" },
			{ ...(finish.canvas as object), wrapHex: "#FFFFFG" },
			{ ...(finish.canvas as object), wrapHex: "#FFFFFF00" },
			{ ...(finish.canvas as object), wrapOptionId: 4 },
			{ ...(finish.canvas as object), subcategoryId: 101004 },
		]) {
			const candidate = structuredClone(response) as Record<string, unknown>;
			const candidateFinish = (candidate.commerce as { finish: Record<string, unknown> }).finish;
			candidateFinish.canvas = canvas;
			const fetch = vi.fn(async () => json(candidate));
			await expect(
				resolvePaidFulfillment("cs_test_123456789", 0, { origin, bearer: token, fetch }),
			).rejects.toMatchObject({ kind: "rejected", phase: "envelope" });
		}
	});

	it("enforces the 100 MB print-source and 16 MiB paid-file descriptor bounds", async () => {
		for (const { purpose, acceptedBytes, rejectedBytes } of [
			{
				purpose: "paid_fulfillment" as const,
				acceptedBytes: 100_000_000,
				rejectedBytes: 100_000_001,
			},
			{
				purpose: "paid_download" as const,
				acceptedBytes: 16 * 1024 * 1024,
				rejectedBytes: 16 * 1024 * 1024 + 1,
			},
		]) {
			const accepted = structuredClone(paidResponse(purpose)) as Record<string, unknown>;
			const acceptedDescriptor = accepted.descriptor as Record<string, unknown>;
			if (purpose === "paid_fulfillment") {
				(
					(acceptedDescriptor.sources as Array<Record<string, unknown>>)[0] as Record<
						string,
						unknown
					>
				).bytes = acceptedBytes;
			} else acceptedDescriptor.bytes = acceptedBytes;
			const acceptedFetch = vi.fn(async () => json(accepted));
			const resolveAccepted =
				purpose === "paid_fulfillment"
					? resolvePaidFulfillment("cs_test_123456789", 0, {
							origin,
							bearer: token,
							fetch: acceptedFetch,
						})
					: resolvePaidDownload("cs_test_123456789", 0, {
							origin,
							bearer: token,
							fetch: acceptedFetch,
						});
			await expect(resolveAccepted).resolves.toBeDefined();

			const rejected = structuredClone(accepted) as Record<string, unknown>;
			const rejectedDescriptor = rejected.descriptor as Record<string, unknown>;
			if (purpose === "paid_fulfillment") {
				(
					(rejectedDescriptor.sources as Array<Record<string, unknown>>)[0] as Record<
						string,
						unknown
					>
				).bytes = rejectedBytes;
			} else rejectedDescriptor.bytes = rejectedBytes;
			const rejectedFetch = vi.fn(async () => json(rejected));
			const resolveRejected =
				purpose === "paid_fulfillment"
					? resolvePaidFulfillment("cs_test_123456789", 0, {
							origin,
							bearer: token,
							fetch: rejectedFetch,
						})
					: resolvePaidDownload("cs_test_123456789", 0, {
							origin,
							bearer: token,
							fetch: rejectedFetch,
						});
			await expect(resolveRejected).rejects.toMatchObject({
				kind: "rejected",
				phase: "envelope",
			});
		}
	});

	it("accepts maximum trimmed print-set resolver envelopes under the 64 KiB decoded cap", async () => {
		const maximumKey = (prefix: string, index: number) => {
			const beginning = `${prefix}-${index}-`;
			return `${beginning}${"x".repeat(120 - beginning.length)}`;
		};
		const item = {
			...snapshotItem,
			productKey: "p".repeat(32),
			revisionId: "r".repeat(32),
			productKind: "print_set" as const,
			variantKey: "v".repeat(120),
		};
		const projectedAsset = {
			assetId: "10000000-0000-4000-8000-000000000001",
			source: { width: 100_000, height: 100_000 },
			derivatives: {
				thumb: { contentType: "image/webp", width: 100_000, height: 100_000 },
				card: { contentType: "image/webp", width: 100_000, height: 100_000 },
				display1280: { contentType: "image/webp", width: 100_000, height: 100_000 },
				display2048: { contentType: "image/webp", width: 100_000, height: 100_000 },
				display2560: { contentType: "image/webp", width: 100_000, height: 100_000 },
			},
		};
		const maximumResponse = {
			version: 1,
			purpose: "checkout",
			item,
			identity: {
				productId: item.productKey,
				revisionId: item.revisionId,
				productKind: item.productKind,
				title: "t".repeat(160),
				slug: "s".repeat(96),
				variantKey: item.variantKey,
			},
			commerce: {
				currency: "usd",
				amountCents: 100_000_000,
				finish: {
					materialKey: "archival-matte",
					sizeKey: "8x10",
					borderKey: null,
					frameKey: null,
					paper: { name: "Archival Matte", subcategoryId: 103001 },
					size: { label: "8×10", width: 8, height: 10 },
					border: { inches: 0 },
					frame: { subcategoryId: 0 },
					canvas: null,
				},
			},
			media: [
				{
					key: maximumKey("cover", 0),
					role: "cover",
					order: 0,
					altText: null,
					asset: projectedAsset,
				},
				...Array.from({ length: 20 }, (_, index) => ({
					key: maximumKey("media", index),
					role: "set_member",
					order: index,
					altText: null,
					asset: projectedAsset,
				})),
			],
		};
		const untrimmedPresentationResponse = {
			...maximumResponse,
			media: maximumResponse.media.map((entry) => ({
				...entry,
				altText: "界".repeat(1_000),
			})),
		};
		expect(Buffer.byteLength(JSON.stringify(untrimmedPresentationResponse))).toBeGreaterThan(
			64 * 1024,
		);
		const body = JSON.stringify(maximumResponse);
		const decodedBytes = Buffer.byteLength(body);
		expect(decodedBytes).toBeGreaterThan(8 * 1024);
		expect(decodedBytes).toBeLessThanOrEqual(64 * 1024);
		const checkoutFetch = vi.fn(
			async () =>
				new Response(body, {
					headers: {
						"content-type": "application/json",
						"content-length": String(decodedBytes),
					},
				}),
		);
		await expect(
			resolveCatalogCheckout(item, { origin, bearer: token, fetch: checkoutFetch }),
		).resolves.toEqual(maximumResponse);
		expect(checkoutFetch).toHaveBeenCalledOnce();

		const privateObjectKey = `sites/${"s".repeat(253)}/catalog/print-sources/${"a".repeat(160)}/original`;
		const maximumPaidResponse = {
			...maximumResponse,
			purpose: "paid_fulfillment",
			current: {
				kindEnabled: true,
				publishedRevision: false,
				slugMatches: false,
				available: false,
				variantEnabled: false,
			},
			descriptor: {
				kind: "print_sources",
				sources: Array.from({ length: 20 }, (_, index) => ({
					memberKey: maximumKey("member", index),
					relationKey: maximumKey("source", index),
					key: privateObjectKey,
					mime: "image/jpeg",
					bytes: 100_000_000,
					hash: "f".repeat(64),
					dimensions: { width: 100_000, height: 100_000 },
				})),
			},
		};
		const paidBody = JSON.stringify(maximumPaidResponse);
		const paidDecodedBytes = Buffer.byteLength(paidBody);
		expect(paidDecodedBytes).toBeGreaterThan(24 * 1024);
		expect(paidDecodedBytes).toBeLessThanOrEqual(64 * 1024);
		const paidFetch = vi.fn(
			async () =>
				new Response(paidBody, {
					headers: {
						"content-type": "application/json",
						"content-length": String(paidDecodedBytes),
					},
				}),
		);
		await expect(
			resolvePaidFulfillment("cs_test_123456789", 0, {
				origin,
				bearer: token,
				fetch: paidFetch,
			}),
		).resolves.toMatchObject({ descriptor: { kind: "print_sources", sources: { length: 20 } } });
		expect(paidFetch).toHaveBeenCalledOnce();
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

	it("treats only the exact commerce-resolver rejection 404 as permanent", async () => {
		const fetch = vi.fn(async () => json({ error: "rejected" }, 404));
		await expect(
			resolveCatalogCheckout(snapshotItem, { origin, bearer: token, fetch }),
		).rejects.toMatchObject({ kind: "rejected", phase: "status" });
		expect(fetch).toHaveBeenCalledOnce();
	});

	it.each([
		["already-refunded conflict", 409, "refunded"],
		["explicit unavailability", 503, "unavailable"],
		["missing authentication", 401, "unavailable"],
		["rejected authentication", 403, "unavailable"],
		["proxy authentication", 407, "unavailable"],
		["invalid request protocol", 400, "unavailable"],
		["unsupported media protocol", 415, "unavailable"],
		["upgrade protocol", 426, "unavailable"],
		["HTTP-version protocol", 505, "unavailable"],
		["rate limit", 429, "unavailable"],
		["unexpected client response", 418, "unavailable"],
		["unexpected validation response", 422, "unavailable"],
		["unexpected server response", 500, "unavailable"],
		["unexpected gateway response", 502, "unavailable"],
		["unexpected vendor response", 599, "unavailable"],
	] as const)("classifies resolver %s status %i as %s", async (_case, status, kind) => {
		const fetch = vi.fn(async () => json({}, status));
		await expect(
			resolveCatalogCheckout(snapshotItem, { origin, bearer: token, fetch }),
		).rejects.toMatchObject({ kind, phase: "status" });
		expect(fetch).toHaveBeenCalledOnce();
	});

	it("keeps a capability issuer 404 unavailable even with the resolver rejection body", async () => {
		const fetch = vi.fn(async () => json({ error: "rejected" }, 404));
		await expect(
			issuePaidFile(
				{
					key: "private/key",
					hash: "c".repeat(64),
					bytes: 10,
					mime: "application/zip",
				},
				{ origin, bearer: token, fetch },
			),
		).rejects.toMatchObject({ kind: "unavailable", phase: "status" });
		expect(fetch).toHaveBeenCalledOnce();
	});

	it("keeps malformed, missing, hidden, and over-limit resolver 404 bodies unavailable and redacted", async () => {
		const privateDetail = "private catalog rejection detail";
		const responses = [
			new Response('{"error":', {
				status: 404,
				headers: { "content-type": "application/json" },
			}),
			new Response(null, {
				status: 404,
				headers: { "content-type": "application/json" },
			}),
			json({ error: "rejected", detail: privateDetail }, 404),
			new Response(JSON.stringify({ error: "rejected", padding: "x".repeat(64 * 1024) }), {
				status: 404,
				headers: { "content-type": "application/json" },
			}),
		];
		for (const response of responses) {
			const fetch = vi.fn(async () => response);
			const outcome = await resolveCatalogCheckout(snapshotItem, {
				origin,
				bearer: token,
				fetch,
			}).then(
				() => null,
				(error: unknown) => error,
			);
			expect(outcome).toMatchObject({ kind: "unavailable", phase: "status" });
			expect(String(outcome)).not.toContain(privateDetail);
			expect(fetch).toHaveBeenCalledOnce();
		}
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
		const validPrintExpiry = new Date(now + 23.5 * 60 * 60 * 1000).toISOString();
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
				expiresAt: validPrintExpiry,
			},
			{
				url: capability("paid_file"),
				expiresAt: validPrintExpiry,
			},
			{
				url: capability("print_source", "png"),
				expiresAt: validPrintExpiry,
			},
			{
				url: capability("print_source").replace(sealedCapability, `${sealedCapability}=`),
				expiresAt: validPrintExpiry,
			},
			{
				url: `${capability("print_source")}?download=1`,
				expiresAt: validPrintExpiry,
			},
			{
				url: `${capability("print_source")}#fragment`,
				expiresAt: validPrintExpiry,
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
