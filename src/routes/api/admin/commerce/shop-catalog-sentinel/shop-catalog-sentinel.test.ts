import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const exactCatalog = {
	outcome: "exact" as const,
	sanityCount: 33,
	convexCount: 33,
	distribution: "exact" as const,
	commerceParity: "match" as const,
	presentationParity: "match" as const,
	associationParity: "match" as const,
	productIndexOrder: "match" as const,
	printSetOrder: "match" as const,
};

const mocks = vi.hoisted(() => ({
	verify: vi.fn(),
	read: vi.fn(),
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

import { r4ReadPurposes, r4ReadSignatureMessage } from "$lib/server/r4ReadAuthorization";
import { GET } from "./+server";

const endpoint = "https://example.test/api/admin/commerce/shop-catalog-sentinel";

describe("deployed public Shop catalog sentinel", () => {
	beforeEach(() => {
		mocks.verify.mockReset().mockResolvedValue(true);
		mocks.read.mockReset().mockResolvedValue(exactCatalog);
		mocks.env.SHOP_CATALOG_PROVIDER = "convex";
	});

	it("requires membership or the distinct empty-body machine signature before reads", async () => {
		mocks.verify.mockResolvedValue(false);
		await expect(GET({ request: new Request(endpoint) })).rejects.toMatchObject({ status: 401 });
		expect(mocks.read).not.toHaveBeenCalled();

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
	});

	it("returns only exact normalized hybrid-scope and 33-product classes", async () => {
		const response = await GET({ request: new Request(endpoint) });
		const text = await response.text();
		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(JSON.parse(text)).toEqual({
			version: 1,
			outcome: "exact",
			shopCatalogProvider: "convex",
			shopCatalogConfiguration: "exact",
			activePublishedProvider: "convex",
			scope: {
				classification: "hybrid",
				authority: "published_non_preview_product_graph",
				productIndex: "convex",
				productDetail: "convex",
				printSetIndex: "convex",
				printSetDetail: "convex",
				printCollectionDetail: "sanity",
				collections: "sanity",
				preview: "sanity",
			},
			catalog: exactCatalog,
		});
		expect(text).not.toMatch(/slug|title|description|altText|assetId|secret|private/i);
	});

	it("reports Sanity-only effective scope for explicit Sanity and shadow", async () => {
		for (const provider of ["sanity", "shadow"]) {
			mocks.env.SHOP_CATALOG_PROVIDER = provider;
			const response = await GET({ request: new Request(endpoint) });
			await expect(response.json()).resolves.toMatchObject({
				shopCatalogProvider: provider,
				activePublishedProvider: "sanity",
				scope: {
					classification: "sanity_only",
					authority: "published_non_preview_product_graph",
					productIndex: "sanity",
					productDetail: "sanity",
					printSetIndex: "sanity",
					printSetDetail: "sanity",
					printCollectionDetail: "sanity",
					collections: "sanity",
					preview: "sanity",
				},
			});
		}
	});

	it("makes absent or invalid configuration a mismatch without hiding the Sanity default", async () => {
		for (const [value, classification] of [
			[undefined, "absent"],
			["invalid", "invalid"],
		] as const) {
			mocks.env.SHOP_CATALOG_PROVIDER = value;
			const response = await GET({ request: new Request(endpoint) });
			expect(response.status).toBe(409);
			await expect(response.json()).resolves.toMatchObject({
				outcome: "mismatch",
				shopCatalogProvider: "sanity",
				shopCatalogConfiguration: classification,
				activePublishedProvider: "sanity",
			});
		}
	});

	it("returns normalized 409 mismatch and 503 unavailable classes", async () => {
		mocks.read.mockResolvedValueOnce({
			...exactCatalog,
			outcome: "mismatch",
			presentationParity: "mismatch",
		});
		const mismatch = await GET({ request: new Request(endpoint) });
		expect(mismatch.status).toBe(409);
		await expect(mismatch.json()).resolves.toMatchObject({
			outcome: "mismatch",
			catalog: { presentationParity: "mismatch" },
		});

		mocks.read.mockRejectedValueOnce(new Error("raw secret slug private-id stack"));
		const unavailable = await GET({ request: new Request(endpoint) });
		const text = await unavailable.text();
		expect(unavailable.status).toBe(503);
		expect(JSON.parse(text)).toMatchObject({
			outcome: "unavailable",
			catalog: { outcome: "unavailable", sanityCount: null, convexCount: null },
		});
		expect(text).not.toMatch(/raw secret|slug|private-id|stack/i);
	});
});
