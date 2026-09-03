import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const healthyRuntime = {
	outcome: "healthy" as const,
	publishedProductCount: 33,
	productIndexCount: 31,
	printSetIndexCount: 2,
	collectionIndexCount: 0,
};

const mocks = vi.hoisted(() => ({
	verify: vi.fn(),
	readRuntime: vi.fn(),
	env: { WEBHOOK_SECRET: "server-only-secret" },
}));

vi.mock("$env/dynamic/private", () => ({ env: mocks.env }));
vi.mock("$lib/server/siteAdminAuthorization", () => ({
	verifySiteAdminRequest: mocks.verify,
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
		mocks.readRuntime.mockReset().mockResolvedValue(healthyRuntime);
	});

	it("requires membership or the distinct empty-body machine signature before reads", async () => {
		mocks.verify.mockResolvedValue(false);
		await expect(GET({ request: new Request(endpoint) })).rejects.toMatchObject({ status: 401 });
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
		expect(mocks.readRuntime).toHaveBeenCalledOnce();
	});

	it("reports only the authoritative Convex runtime", async () => {
		const response = await GET({ request: new Request(endpoint) });
		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toBe("no-store");
		await expect(response.json()).resolves.toEqual({
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
				preview: "unsupported",
			},
			runtime: healthyRuntime,
		});
	});

	it("returns a sanitized 503 when the Convex runtime is unavailable", async () => {
		mocks.readRuntime.mockRejectedValueOnce(new Error("raw secret slug private-id stack"));
		const response = await GET({ request: new Request(endpoint) });
		const text = await response.text();
		expect(response.status).toBe(503);
		expect(JSON.parse(text)).toMatchObject({
			outcome: "unavailable",
			runtime: { outcome: "unavailable", publishedProductCount: null },
		});
		expect(text).not.toMatch(/raw secret|slug|private-id|stack/i);
	});
});
