import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const exactCatalog = {
	outcome: "exact" as const,
	sanityCount: 33,
	convexCount: 33,
	distribution: "exact" as const,
	publicAdapterValidation: "exact" as const,
	commerceParity: "match" as const,
	presentationParity: "match" as const,
	presentationMismatchCounts: {
		copy: 0,
		mediaStructure: 0,
		altText: 0,
		dimensions: 0,
	},
	sanityPrintSetCoverFallbackCount: 0,
	transferEquivalentDimensionCount: 0,
	associationParity: "match" as const,
	productIndexOrder: "match" as const,
	printSetOrder: "match" as const,
};

const healthyRuntime = {
	outcome: "healthy" as const,
	publishedProductCount: 33,
	productIndexCount: 31,
	printSetIndexCount: 2,
	collectionIndexCount: 0,
};

const mocks = vi.hoisted(() => ({
	verify: vi.fn(),
	read: vi.fn(),
	readRuntime: vi.fn(),
	env: {
		WEBHOOK_SECRET: "server-only-secret",
		SHOP_CATALOG_PROVIDER: "convex" as string | undefined,
	},
}));

vi.mock("$env/dynamic/private", () => ({ env: mocks.env }));
vi.mock("$lib/server/siteAdminAuthorization", () => ({
	verifySiteAdminRequest: mocks.verify,
}));
vi.mock("$lib/server/catalogShop.server", () => ({
	parseCatalogProviderMode: (value: unknown) =>
		value === "sanity" || value === "shadow" || value === "convex" ? value : "sanity",
	readShopCatalogSentinel: mocks.read,
}));
vi.mock("$lib/server/convexShop.server", () => ({
	readConvexShopRuntimeSentinel: mocks.readRuntime,
}));

import { r4ReadPurposes, r4ReadSignatureMessage } from "$lib/server/r4ReadAuthorization";
import { GET } from "./+server";

const endpoint = "https://example.test/api/admin/commerce/shop-catalog-sentinel";

describe("deployed public Shop catalog sentinel", () => {
	beforeEach(() => {
		mocks.verify.mockReset().mockResolvedValue(true);
		mocks.read.mockReset().mockResolvedValue(exactCatalog);
		mocks.readRuntime.mockReset().mockResolvedValue(healthyRuntime);
		mocks.env.SHOP_CATALOG_PROVIDER = "convex";
	});

	it("requires membership or the distinct empty-body machine signature before reads", async () => {
		mocks.verify.mockResolvedValue(false);
		await expect(GET({ request: new Request(endpoint) })).rejects.toMatchObject({ status: 401 });
		expect(mocks.read).not.toHaveBeenCalled();
		expect(mocks.readRuntime).not.toHaveBeenCalled();

		const timestamp = String(Math.floor(Date.now() / 1_000));
		const unsigned = new Request(endpoint);
		const signature = createHmac("sha256", mocks.env.WEBHOOK_SECRET)
			.update(r4ReadSignatureMessage(unsigned, r4ReadPurposes.shopCatalogSentinel, "", timestamp))
			.digest("hex");
		const response = await GET({
			request: new Request(endpoint, {
				headers: { "x-r4-timestamp": timestamp, "x-r4-signature": signature },
			}),
		});
		expect(response.status).toBe(200);
		expect(mocks.read).toHaveBeenCalledOnce();
		expect(mocks.readRuntime).toHaveBeenCalledOnce();
	});

	it("reports the authoritative Convex-only runtime and nests legacy parity diagnostics", async () => {
		const response = await GET({ request: new Request(endpoint) });
		const text = await response.text();
		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(JSON.parse(text)).toEqual({
			version: 2,
			outcome: "healthy",
			shopCatalogProvider: "convex",
			activePublishedProvider: "convex",
			scope: {
				classification: "convex_only",
				authority: "published_non_preview_product_graph",
				productIndex: "convex",
				productDetail: "convex",
				printSetIndex: "convex",
				printSetDetail: "convex",
				printCollectionDetail: "retired_404",
				collections: "none",
				preview: "ignored",
			},
			runtime: healthyRuntime,
			diagnostics: {
				legacyProviderConfiguration: {
					provider: "convex",
					configuration: "exact",
				},
				legacySanityParity: exactCatalog,
			},
		});
		expect(text).not.toMatch(/slug|title|description|assetId|secret|private/i);
	});

	it("keeps the retired provider flag diagnostic and never lets it steer the live runtime", async () => {
		for (const [value, provider, classification] of [
			["sanity", "sanity", "exact"],
			["shadow", "shadow", "exact"],
			[undefined, "sanity", "absent"],
			["invalid", "sanity", "invalid"],
		] as const) {
			mocks.env.SHOP_CATALOG_PROVIDER = value;
			const response = await GET({ request: new Request(endpoint) });
			expect(response.status).toBe(200);
			await expect(response.json()).resolves.toMatchObject({
				outcome: "healthy",
				shopCatalogProvider: "convex",
				activePublishedProvider: "convex",
				scope: { classification: "convex_only" },
				diagnostics: {
					legacyProviderConfiguration: { provider, configuration: classification },
				},
			});
		}
	});

	it("keeps Sanity parity mismatch and outage diagnostic without failing live Shop health", async () => {
		mocks.read.mockResolvedValueOnce({
			...exactCatalog,
			outcome: "mismatch",
			presentationParity: "mismatch",
			presentationMismatchCounts: {
				copy: 0,
				mediaStructure: 0,
				altText: 1,
				dimensions: 1,
			},
			sanityPrintSetCoverFallbackCount: 2,
			transferEquivalentDimensionCount: 1,
		});
		const mismatch = await GET({ request: new Request(endpoint) });
		expect(mismatch.status).toBe(200);
		await expect(mismatch.json()).resolves.toMatchObject({
			outcome: "healthy",
			diagnostics: {
				legacySanityParity: {
					outcome: "mismatch",
					presentationParity: "mismatch",
					presentationMismatchCounts: { altText: 1, dimensions: 1 },
					sanityPrintSetCoverFallbackCount: 2,
					transferEquivalentDimensionCount: 1,
				},
			},
		});

		mocks.read.mockRejectedValueOnce(new Error("raw secret slug private-id stack"));
		const unavailable = await GET({ request: new Request(endpoint) });
		const text = await unavailable.text();
		expect(unavailable.status).toBe(200);
		expect(JSON.parse(text)).toMatchObject({
			outcome: "healthy",
			diagnostics: {
				legacySanityParity: {
					outcome: "unavailable",
					sanityCount: null,
					convexCount: null,
					publicAdapterValidation: "unavailable",
					presentationMismatchCounts: null,
					sanityPrintSetCoverFallbackCount: null,
					transferEquivalentDimensionCount: null,
				},
			},
		});
		expect(text).not.toMatch(/raw secret|slug|private-id|stack/i);
	});

	it("gives the legacy parity diagnostic only a short bounded budget", async () => {
		vi.useFakeTimers();
		try {
			mocks.read.mockImplementationOnce(
				({ deadlineMs }: { deadlineMs: number }) =>
					new Promise((_, reject) => {
						setTimeout(() => reject(new Error("diagnostic timed out")), deadlineMs);
					}),
			);
			const responsePromise = GET({ request: new Request(endpoint) });
			await vi.advanceTimersByTimeAsync(0);
			expect(mocks.read).toHaveBeenCalledWith({ deadlineMs: 750 });
			await vi.advanceTimersByTimeAsync(750);
			const response = await responsePromise;
			expect(response.status).toBe(200);
			await expect(response.json()).resolves.toMatchObject({
				outcome: "healthy",
				diagnostics: { legacySanityParity: { outcome: "unavailable" } },
			});
		} finally {
			vi.useRealTimers();
		}
	});

	it("returns a sanitized 503 only when the authoritative Convex runtime is unavailable", async () => {
		mocks.readRuntime.mockRejectedValueOnce(new Error("raw secret slug private-id stack"));
		const response = await GET({ request: new Request(endpoint) });
		const text = await response.text();
		expect(response.status).toBe(503);
		expect(JSON.parse(text)).toMatchObject({
			outcome: "unavailable",
			runtime: {
				outcome: "unavailable",
				publishedProductCount: null,
				productIndexCount: null,
				printSetIndexCount: null,
				collectionIndexCount: 0,
			},
		});
		expect(text).not.toMatch(/raw secret|slug|private-id|stack/i);
	});
});
