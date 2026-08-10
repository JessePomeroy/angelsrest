import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	verify: vi.fn(),
	resolve: vi.fn(),
	env: {
		CHECKOUT_SNAPSHOT_MODE: "handle-v2",
		CHECKOUT_CATALOG_PROVIDER: "convex",
	},
}));

vi.mock("$env/dynamic/private", () => ({ env: mocks.env }));
vi.mock("$lib/server/siteAdminAuthorization", () => ({
	verifySiteAdminRequest: mocks.verify,
}));
vi.mock("$lib/sanity/client", () => ({ client: { fetch: vi.fn() } }));
vi.mock("$lib/server/checkoutCommerce", () => ({
	parseCheckoutCatalogProvider: (value: unknown) => value,
	resolveCheckoutCommerce: mocks.resolve,
}));

import { POST } from "./+server";

const selection = {
	productId: "archival-print",
	isPrintSet: false,
	paperSlug: "archival-matte",
	sizeSlug: "8x10",
	borderWidth: null,
	frame: null,
};
const item = {
	unitPriceCents: 4200,
	productCategory: "prints",
	publicImage: "https://media.example/image.webp",
	legacyFulfillment: {
		isDigital: false,
		isPrintSet: false,
		paper: { name: "Archival Matte", subcategoryId: 1, width: 8, height: 10 },
		imageUrls: [],
	},
};

function request(body: unknown = selection) {
	return new Request("https://example.test/api/admin/commerce/catalog-sentinel", {
		method: "POST",
		body: JSON.stringify(body),
	});
}

describe("deployed Checkout catalog sentinel", () => {
	beforeEach(() => {
		mocks.verify.mockReset().mockResolvedValue(true);
		mocks.resolve
			.mockReset()
			.mockResolvedValueOnce({ provider: "convex", items: [item] })
			.mockResolvedValueOnce({ provider: "sanity", items: [item] })
			.mockResolvedValueOnce({ provider: "convex", items: [item] });
	});

	it("requires stored site membership before any resolver read", async () => {
		mocks.verify.mockResolvedValue(false);
		await expect(POST({ request: request() })).rejects.toMatchObject({ status: 401 });
		expect(mocks.resolve).not.toHaveBeenCalled();
	});

	it("returns only normalized active and parity classes", async () => {
		const response = await POST({ request: request() });
		const text = await response.text();
		expect(JSON.parse(text)).toEqual({
			version: 1,
			checkoutCatalogProvider: "convex",
			activeResolutionProvider: "convex",
			checkoutSnapshotMode: "handle-v2",
			parity: "match",
			resolution: "resolved",
		});
		expect(text).not.toContain("archival-print");
		expect(text).not.toContain("4200");
	});

	it("rejects extra selection authority before any read", async () => {
		await expect(POST({ request: request({ ...selection, extra: true }) })).rejects.toMatchObject({
			status: 400,
		});
		expect(mocks.resolve).not.toHaveBeenCalled();
	});
});
