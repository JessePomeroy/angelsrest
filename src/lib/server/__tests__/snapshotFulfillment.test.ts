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
	isPrintSourceDescriptor: (value: unknown) => {
		if (!value || typeof value !== "object" || Array.isArray(value)) return false;
		const source = value as Record<string, unknown>;
		const dimensions = source.dimensions;
		if (!dimensions || typeof dimensions !== "object" || Array.isArray(dimensions)) return false;
		return (
			typeof source.key === "string" &&
			typeof source.hash === "string" &&
			/^[a-f0-9]{64}$/.test(source.hash) &&
			Number.isSafeInteger(source.bytes) &&
			Number(source.bytes) > 0 &&
			(source.mime === "image/jpeg" || source.mime === "image/png") &&
			Object.keys(dimensions).length === 2 &&
			["width", "height"].every((key) => {
				const dimension = (dimensions as Record<string, unknown>)[key];
				return (
					Number.isSafeInteger(dimension) && Number(dimension) > 0 && Number(dimension) <= 100_000
				);
			})
		);
	},
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
	imageSet: (image?: { url?: string }) => (image?.url ? { original: image.url } : null),
	originalUrl: (image?: { url?: string }) => image?.url ?? null,
	parsePaperOption: () => null,
	previewUrl: (image?: { url?: string }) => image?.url ?? null,
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
const framedFinish = {
	...finish,
	border: { inches: 0.25 },
	frame: { subcategoryId: 105001 },
};

beforeEach(() => {
	vi.clearAllMocks();
	mocks.printSource.mockImplementation(
		async ({ key }: { key: string }) => `https://opaque/${key}?sealed=1`,
	);
});

describe("snapshot fulfillment authority", () => {
	it("orients each Convex source independently while preserving order, quantity, border, and frame", async () => {
		mocks.paidFulfillment
			.mockResolvedValueOnce({
				item: print,
				identity: { productKind: "print" },
				commerce: { finish },
				descriptor: {
					kind: "print_sources",
					sources: [
						{
							key: "one",
							hash: "a".repeat(64),
							bytes: 1,
							mime: "image/jpeg",
							dimensions: { width: 4000, height: 6000 },
						},
					],
				},
			})
			.mockResolvedValueOnce({
				item: { ...print, productKey: "set", productKind: "print_set" },
				identity: { productKind: "print_set" },
				commerce: { finish: framedFinish },
				descriptor: {
					kind: "print_sources",
					sources: [
						{
							memberKey: "a",
							key: "set-a",
							hash: "b".repeat(64),
							bytes: 2,
							mime: "image/jpeg",
							dimensions: { width: 6000, height: 4000 },
						},
						{
							memberKey: "b",
							key: "set-b",
							hash: "c".repeat(64),
							bytes: 3,
							mime: "image/png",
							dimensions: { width: 5000, height: 5000 },
						},
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
		expect(items).toEqual([
			{
				imageUrl: "https://opaque/one?sealed=1",
				sourcePolicy: "opaque_capability",
				quantity: 2,
				paperSubcategoryId: 103001,
				width: 8,
				height: 10,
			},
			{
				imageUrl: "https://opaque/set-a?sealed=1",
				sourcePolicy: "opaque_capability",
				quantity: 3,
				paperSubcategoryId: 103001,
				width: 10,
				height: 8,
				borderWidth: 0.25,
				frameSubcategoryId: 105001,
			},
			{
				imageUrl: "https://opaque/set-b?sealed=1",
				sourcePolicy: "opaque_capability",
				quantity: 3,
				paperSubcategoryId: 103001,
				width: 8,
				height: 10,
				borderWidth: 0.25,
				frameSubcategoryId: 105001,
			},
		]);
	});

	it("retains a square physical size regardless of source orientation", async () => {
		mocks.paidFulfillment.mockResolvedValue({
			item: print,
			identity: { productKind: "print" },
			commerce: { finish: { ...finish, size: { width: 10, height: 10 } } },
			descriptor: {
				kind: "print_sources",
				sources: [
					{
						key: "square-output",
						hash: "d".repeat(64),
						bytes: 4,
						mime: "image/jpeg",
						dimensions: { width: 6000, height: 4000 },
					},
				],
			},
		});
		const { buildOrderItemsFromSnapshot } = await import("../snapshotFulfillment");
		const items = await buildOrderItemsFromSnapshot(
			{ schemaVersion: 1, catalogProvider: "convex", items: [print] },
			"cs_test_paid",
			[{ quantity: 1 }] as Stripe.LineItem[],
		);
		expect(items[0]).toMatchObject({ width: 10, height: 10 });
	});

	it("validates every later source before minting any capability", async () => {
		mocks.paidFulfillment
			.mockResolvedValueOnce({
				item: print,
				identity: { productKind: "print" },
				commerce: { finish },
				descriptor: {
					kind: "print_sources",
					sources: [
						{
							key: "valid-first-line",
							hash: "a".repeat(64),
							bytes: 1,
							mime: "image/jpeg",
							dimensions: { width: 4000, height: 6000 },
						},
					],
				},
			})
			.mockResolvedValueOnce({
				item: { ...print, productKey: "two" },
				identity: { productKind: "print" },
				commerce: { finish },
				descriptor: {
					kind: "print_sources",
					sources: [
						{
							key: "valid-second-line",
							hash: "b".repeat(64),
							bytes: 2,
							mime: "image/png",
							dimensions: { width: 6000, height: 4000 },
						},
						{
							key: "invalid-later-source",
							hash: "c".repeat(64),
							bytes: 3,
							mime: "image/jpeg",
							dimensions: { width: 100_001, height: 4000 },
						},
					],
				},
			});
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
		).rejects.toThrow("does not match");
		expect(mocks.paidFulfillment).toHaveBeenCalledTimes(2);
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
			image: {
				url: "https://cdn.sanity.io/exact.jpg?old=1",
				sourceDimensions: { width: 6000, height: 4000 },
			},
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
			expect.stringMatching(
				/_id == \$id && _rev == \$rev[\s\S]*"sourceDimensions": asset->metadata\.dimensions\{width,height\}/,
			),
			{
				id: "product",
				rev: "revision",
			},
		);
		expect(items[0]).toMatchObject({
			quantity: 4,
			sourcePolicy: "sanity_cdn",
			width: 10,
			height: 8,
		});
		expect(mocks.printSource).not.toHaveBeenCalled();
		mocks.fetchSanity.mockResolvedValueOnce({
			_id: "product",
			_rev: "revision",
			_type: "lumaProductV2",
			slug: "exact-print",
			title: "Exact print",
			inStock: true,
			image: { url: "https://cdn.sanity.io/exact.jpg" },
			variants: [{ _key: "variant", enabled: true, paper: "paper", size: "size", retailPrice: 25 }],
		});
		await expect(
			buildOrderItemsFromSnapshot(
				{ schemaVersion: 1, catalogProvider: "sanity", items: [sanityPrint] },
				"cs_test_paid",
				[{ quantity: 1 }] as Stripe.LineItem[],
			),
		).rejects.toThrow("dimensions");
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

describe("Sanity print-set orientation", () => {
	it("orients mixed portrait and landscape members independently", async () => {
		mocks.fetchSanity.mockResolvedValue({
			_id: "mixed-set",
			_rev: "mixed-set-revision",
			_type: "lumaPrintSetV2",
			slug: "mixed-orientation-set",
			title: "Mixed orientation set",
			inStock: true,
			previewImage: { url: "https://cdn.sanity.io/set-preview.jpg" },
			images: [
				{
					url: "https://cdn.sanity.io/set-portrait.jpg",
					sourceDimensions: { width: 4000, height: 6000 },
				},
				{
					url: "https://cdn.sanity.io/set-landscape.jpg",
					sourceDimensions: { width: 6000, height: 4000 },
				},
			],
			variants: [{ _key: "variant", enabled: true, paper: "paper", size: "size", retailPrice: 50 }],
		});
		const snapshotItem = {
			...print,
			productKey: "mixed-set",
			revisionId: "mixed-set-revision",
			productKind: "print_set" as const,
			borderOptionKey: "none",
			frameOptionKey: "none",
		};
		const { buildOrderItemsFromSnapshot } = await import("../snapshotFulfillment");

		const items = await buildOrderItemsFromSnapshot(
			{ schemaVersion: 1, catalogProvider: "sanity", items: [snapshotItem] },
			"cs_test_paid",
			[{ quantity: 2 }] as Stripe.LineItem[],
		);

		expect(items).toEqual([
			{
				imageUrl: "https://cdn.sanity.io/set-portrait.jpg",
				sourcePolicy: "sanity_cdn",
				quantity: 2,
				paperSubcategoryId: 103001,
				width: 8,
				height: 10,
			},
			{
				imageUrl: "https://cdn.sanity.io/set-landscape.jpg",
				sourcePolicy: "sanity_cdn",
				quantity: 2,
				paperSubcategoryId: 103001,
				width: 10,
				height: 8,
			},
		]);
		expect(mocks.printSource).not.toHaveBeenCalled();
	});
});
