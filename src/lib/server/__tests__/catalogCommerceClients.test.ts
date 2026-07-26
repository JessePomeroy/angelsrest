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
			return json(
				purpose === "checkout"
					? {
							version: 1,
							purpose,
							item: snapshotItem,
							identity: {},
							commerce: {},
							media: [],
						}
					: paidResponse(purpose),
			);
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

	it("composes a caller abort with the fixed five-second checkout bound without retry", async () => {
		const controller = new AbortController();
		const fetch = vi.fn(async (_url: URL | RequestInfo, _init?: RequestInit) => {
			return json({
				version: 1,
				purpose: "checkout",
				item: snapshotItem,
				identity: {},
				commerce: {},
				media: [],
			});
		});
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
		const capability = "https://opaque.example/a_b-C?sealed=1";
		const fetch = vi.fn(async (_url: URL | RequestInfo, _init?: RequestInit) =>
			json({ version: 1, url: capability, expiresAt: "2026-01-01T00:00:00.000Z" }),
		);
		const descriptor = {
			key: "private/key",
			hash: "c".repeat(64),
			bytes: 10,
			mime: "image/jpeg",
			relationKey: "must-not-cross",
		};
		expect(await issuePrintSource(descriptor, { origin, bearer: token, fetch })).toBe(capability);
		expect(
			await issuePaidFile(
				{ ...descriptor, mime: "application/zip" },
				{
					origin,
					bearer: "b".repeat(32),
					fetch,
				},
			),
		).toBe(capability);
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
