import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	fetchSanity: vi.fn(),
	paidFulfillment: vi.fn(),
	printSource: vi.fn(),
}));
vi.mock("$lib/sanity/client", () => ({
	client: { withConfig: () => ({ fetch: mocks.fetchSanity }) },
}));
vi.mock("$lib/server/catalogCommerceClients", () => ({
	resolvePaidFulfillment: mocks.paidFulfillment,
	issuePrintSource: mocks.printSource,
}));
vi.mock("$lib/shop/printCatalog", () => ({
	FRAMED_BORDER_INCHES: 0.25,
	getPaper: () => ({ slug: "matte", subcategoryId: 103001, name: "Matte" }),
	getSize: () => ({ width: 8, height: 10 }),
	getBorder: () => ({ inches: 0 }),
	getFrame: () => ({ subcategoryId: 0 }),
	isCanvasPaper: () => false,
	parseCanvasSlug: () => null,
}));
vi.mock("$lib/utils/images", () => ({
	originalUrl: (image?: { url?: string }) => image?.url ?? null,
	parsePaperOption: () => null,
}));

const print = {
	productKey: "product",
	revisionId: "revision",
	productKind: "print" as const,
	variantKey: "variant",
	materialOptionKey: "paper",
	sizeOptionKey: "size",
	borderOptionKey: null,
	frameOptionKey: null,
};
const finish = {
	paper: { subcategoryId: 103001 },
	size: { width: 8, height: 10 },
	border: { inches: 0 },
	frame: { subcategoryId: 0 },
	canvas: null,
};

beforeEach(() => {
	vi.clearAllMocks();
	mocks.printSource.mockImplementation(
		async ({ key }: { key: string }) => `https://opaque/${key}?sealed=1`,
	);
});

describe("snapshot fulfillment authority", () => {
	it("resolves Convex paid ordinals, expands sets deterministically, and preserves Stripe quantity", async () => {
		mocks.paidFulfillment
			.mockResolvedValueOnce({
				item: print,
				identity: { productKind: "print" },
				commerce: { finish },
				descriptor: {
					kind: "print_sources",
					sources: [{ key: "one", hash: "a".repeat(64), bytes: 1, mime: "image/jpeg" }],
				},
			})
			.mockResolvedValueOnce({
				item: { ...print, productKey: "set", productKind: "print_set" },
				identity: { productKind: "print_set" },
				commerce: { finish },
				descriptor: {
					kind: "print_sources",
					sources: [
						{ memberKey: "a", key: "set-a", hash: "b".repeat(64), bytes: 2, mime: "image/jpeg" },
						{ memberKey: "b", key: "set-b", hash: "c".repeat(64), bytes: 3, mime: "image/png" },
					],
				},
			});
		const { buildOrderItemsFromSnapshot } = await import("../snapshotFulfillment");
		const items = await buildOrderItemsFromSnapshot(
			{
				schemaVersion: 1,
				catalogProvider: "convex",
				items: [print, { ...print, productKey: "set", productKind: "print_set" }],
			},
			"cs_test_paid",
			[{ quantity: 2 }, { quantity: 3 }] as Stripe.LineItem[],
		);
		expect(mocks.paidFulfillment.mock.calls).toEqual([
			["cs_test_paid", 0],
			["cs_test_paid", 1],
		]);
		expect(mocks.printSource.mock.calls.map(([value]) => value.key)).toEqual([
			"one",
			"set-a",
			"set-b",
		]);
		expect(
			items.map(({ imageUrl, quantity, sourcePolicy }) => ({ imageUrl, quantity, sourcePolicy })),
		).toEqual([
			{ imageUrl: "https://opaque/one?sealed=1", quantity: 2, sourcePolicy: "opaque_capability" },
			{ imageUrl: "https://opaque/set-a?sealed=1", quantity: 3, sourcePolicy: "opaque_capability" },
			{ imageUrl: "https://opaque/set-b?sealed=1", quantity: 3, sourcePolicy: "opaque_capability" },
		]);
	});

	it.each([
		undefined,
		null,
		0,
		-1,
		1.5,
		Number.NaN,
	])("rejects non-exact paid quantity %s before resolving", async (quantity) => {
		const { buildOrderItemsFromSnapshot } = await import("../snapshotFulfillment");
		await expect(
			buildOrderItemsFromSnapshot(
				{ schemaVersion: 1, catalogProvider: "convex", items: [print] },
				"cs_test_paid",
				[{ quantity }] as Stripe.LineItem[],
			),
		).rejects.toThrow("quantity");
		expect(mocks.paidFulfillment).not.toHaveBeenCalled();
	});

	it("finishes every resolver guard before minting any capability", async () => {
		mocks.paidFulfillment
			.mockResolvedValueOnce({
				item: print,
				identity: { productKind: "print" },
				commerce: { finish },
				descriptor: { kind: "print_sources", sources: [] },
			})
			.mockRejectedValueOnce(new Error("refunded race"));
		const { buildOrderItemsFromSnapshot } = await import("../snapshotFulfillment");
		await expect(
			buildOrderItemsFromSnapshot(
				{
					schemaVersion: 1,
					catalogProvider: "convex",
					items: [print, { ...print, productKey: "two" }],
				},
				"cs_test_paid",
				[{ quantity: 1 }, { quantity: 1 }] as Stripe.LineItem[],
			),
		).rejects.toThrow("refunded race");
		expect(mocks.printSource).not.toHaveBeenCalled();
	});

	it("keeps non-print provider guards before resolver and capability calls", async () => {
		const { buildOrderItemsFromSnapshot } = await import("../snapshotFulfillment");
		const items = await buildOrderItemsFromSnapshot(
			{
				schemaVersion: 1,
				catalogProvider: "convex",
				items: [
					{ ...print, productKind: "digital_download" },
					{ ...print, productKind: "merchandise" },
				],
			},
			"cs_test_paid",
			[],
		);
		expect(items).toEqual([]);
		expect(mocks.paidFulfillment).not.toHaveBeenCalled();
		expect(mocks.printSource).not.toHaveBeenCalled();
	});

	it("exact-resolves the persisted Sanity id/revision/selectors and mints no capability", async () => {
		mocks.fetchSanity.mockResolvedValue({
			_id: "product",
			_rev: "revision",
			_type: "lumaProductV2",
			slug: "exact-print",
			title: "Exact print",
			inStock: true,
			image: { url: "https://cdn.sanity.io/exact.jpg?old=1" },
			variants: [{ _key: "variant", enabled: true, paper: "paper", size: "size", retailPrice: 25 }],
		});
		const { buildOrderItemsFromSnapshot } = await import("../snapshotFulfillment");
		const sanityPrint = { ...print, borderOptionKey: "none", frameOptionKey: "none" };
		const items = await buildOrderItemsFromSnapshot(
			{
				schemaVersion: 1,
				catalogProvider: "sanity",
				items: [sanityPrint],
			},
			"cs_test_paid",
			[{ quantity: 4 }] as Stripe.LineItem[],
		);
		expect(mocks.fetchSanity).toHaveBeenCalledWith(
			expect.stringContaining("_id == $id && _rev == $rev"),
			{
				id: "product",
				rev: "revision",
			},
		);
		expect(items[0]).toMatchObject({ quantity: 4, sourcePolicy: "sanity_cdn" });
		expect(mocks.printSource).not.toHaveBeenCalled();
		mocks.fetchSanity.mockResolvedValueOnce(null);
		await expect(
			buildOrderItemsFromSnapshot(
				{
					schemaVersion: 1,
					catalogProvider: "sanity",
					items: [sanityPrint],
				},
				"cs_test_paid",
				[{ quantity: 1 }] as Stripe.LineItem[],
			),
		).rejects.toThrow("unavailable");
	});
});
