import { beforeEach, describe, expect, it, vi } from "vitest";

const selectDefaultClient = vi.hoisted(() => vi.fn());

vi.mock("$lib/sanity/client.server", () => ({ getSanityClient: selectDefaultClient }));
vi.mock("$lib/utils/images", () => {
	const id = (image: unknown) => (image as { id: string }).id;
	return {
		previewUrl: (image: unknown) => (image ? `preview:${id(image)}` : null),
		thumbnailUrl: (image: unknown) => (image ? `thumb:${id(image)}` : null),
		displayUrl: (image: unknown) => (image ? `display:${id(image)}` : null),
		originalUrl: (image: unknown) => (image ? `original:${id(image)}` : null),
		imageSet: (image: unknown) =>
			image
				? {
						full: `display:${id(image)}`,
						thumb: `thumb:${id(image)}`,
						original: `original:${id(image)}`,
						alt: (image as { alt?: string }).alt || "",
					}
				: null,
	};
});

import {
	createSanityShopAdapter,
	type SanityShopClient,
	sanityShop,
} from "$lib/server/sanityShop.server";

function fakeSanity(...responses: unknown[]) {
	const fetch = vi.fn(async (_query: string, _params?: Record<string, unknown>) =>
		responses.shift(),
	);
	return {
		client: { fetch: fetch as unknown as SanityShopClient["fetch"] },
		fetch,
	};
}

const image = (id: string, alt?: string) => ({ id, alt });
const v2Product = (overrides: Record<string, unknown> = {}) => ({
	title: "V2 product",
	image: image("hero"),
	variants: [],
	...overrides,
});

beforeEach(() => {
	selectDefaultClient.mockReset();
});

describe("Sanity Shop adapter", () => {
	it("fetches the index sequentially and stably partitions the V2+V1 merge", async () => {
		const { client, fetch } = fakeSanity(
			[
				{
					title: "V2 featured",
					slug: "v2-featured",
					previewImage: image("v2-featured"),
					category: "prints",
					featured: true,
					inStock: true,
					startingPrice: 20,
				},
				{
					title: "V2 regular",
					slug: "v2-regular",
					previewImage: image("v2-regular"),
					category: "prints",
					inStock: true,
				},
			],
			[
				{
					title: "V1 featured",
					slug: "v1-featured",
					previewImage: image("v1-featured"),
					category: "digital",
					featured: true,
					inStock: true,
					price: 8,
				},
				{
					title: "V1 regular",
					slug: "v1-regular",
					previewImage: image("v1-regular"),
					category: "postcard",
					inStock: true,
					price: 4,
				},
			],
			[{ title: "Collection", slug: "collection", previewImage: image("collection") }],
			[
				{
					title: "Set",
					slug: "set",
					images: [image("set-1")],
					previewImage: image("set-preview"),
					startingPrice: 60,
				},
			],
		);

		const result = await createSanityShopAdapter(() => client).loadIndex(false);

		expect(fetch.mock.calls.map(([query]) => query)).toEqual([
			expect.stringContaining('_type == "lumaProductV2" && inStock == true'),
			expect.stringContaining('_type == "product" && inStock == true'),
			expect.stringContaining('_type == "printCollection" && !defined(parent)'),
			expect.stringContaining('_type == "lumaPrintSetV2" && inStock == true'),
		]);
		expect(result.products.map(({ slug }) => slug)).toEqual([
			"v2-featured",
			"v1-featured",
			"v2-regular",
			"v1-regular",
		]);
		expect(result.products[0]).toMatchObject({
			startingPrice: 20,
			price: 20,
			preview: "preview:v2-featured",
		});
		expect(result.collections[0]).toMatchObject({
			previewImage: "preview:collection",
			alt: "",
		});
		expect(result.printSets[0]).toMatchObject({
			preview1: "thumb:set-1",
			preview2: undefined,
			previewImage: "preview:set-preview",
			startingPrice: 60,
			price: 60,
		});
	});

	it("projects V2 detail transforms and nullish defaults without hiding unavailable items", async () => {
		const { client, fetch } = fakeSanity(
			v2Product({
				description: "Description",
				variants: null,
				bordersEnabled: null,
				framedEnabled: false,
				frameMarkupMultiplier: 0,
				inStock: false,
				featured: null,
				image: image("hero", ""),
			}),
		);

		const result = await createSanityShopAdapter(() => client).loadProduct("v2", false);

		expect(fetch.mock.calls[0][0]).not.toContain("inStock == true");
		expect(result).toEqual({
			productType: "v2",
			product: {
				title: "V2 product",
				slug: "v2",
				description: "Description",
				variants: [],
				bordersEnabled: true,
				framedEnabled: false,
				frameMarkupMultiplier: 0,
				inStock: false,
				featured: false,
				images: [
					{
						thumbnail: "thumb:hero",
						full: "display:hero",
						original: "original:hero",
						alt: "V2 product",
					},
				],
			},
		});
	});

	it("falls back to V1 only for a null V2 result and preserves image order", async () => {
		const { client, fetch } = fakeSanity(null, {
			title: "V1 product",
			price: 12,
			category: "postcard",
			inStock: false,
			images: [image("first", "First"), image("second")],
			availablePapers: [],
		});

		const result = await createSanityShopAdapter(() => client).loadProduct("v1", true);

		expect(fetch).toHaveBeenCalledTimes(2);
		expect(fetch.mock.calls.map(([query]) => query)).toEqual([
			expect.stringContaining('_type == "lumaProductV2"'),
			expect.stringContaining('_type == "product"'),
		]);
		expect(fetch.mock.calls.map(([, params]) => params)).toEqual([{ slug: "v1" }, { slug: "v1" }]);
		expect(result).toMatchObject({
			productType: "v1",
			product: {
				slug: "v1",
				inStock: false,
				images: [
					{ full: "display:first", alt: "First" },
					{ full: "display:second", alt: "V1 product" },
				],
			},
		});
	});

	it("returns the exact product 404 and never falls back after a V2 error", async () => {
		const missing = fakeSanity(null, null);
		await expect(
			createSanityShopAdapter(() => missing.client).loadProduct("missing", false),
		).rejects.toMatchObject({ status: 404, body: { message: "Product not found" } });
		expect(missing.fetch).toHaveBeenCalledTimes(2);

		const failure = new Error("V2 unavailable");
		const broken = fakeSanity();
		broken.fetch.mockRejectedValueOnce(failure);
		await expect(
			createSanityShopAdapter(() => broken.client).loadProduct("broken", false),
		).rejects.toBe(failure);
		expect(broken.fetch).toHaveBeenCalledOnce();
	});

	it("preserves print-set image order, null filtering, defaults, and 404", async () => {
		const found = fakeSanity({
			title: "Set",
			previewImage: image("preview"),
			images: [image("one"), null, image("two")],
			variants: null,
			bordersEnabled: false,
			framedEnabled: null,
			frameMarkupMultiplier: null,
			inStock: false,
		});
		const adapter = createSanityShopAdapter(() => found.client);

		const result = await adapter.loadPrintSet("set", false);
		expect(result.printSet).toMatchObject({
			slug: "set",
			previewImage: "preview:preview",
			variants: [],
			bordersEnabled: false,
			framedEnabled: false,
			frameMarkupMultiplier: 2,
			inStock: false,
		});
		expect(result.images.map(({ thumb }) => thumb)).toEqual(["thumb:one", "thumb:two"]);

		const missing = fakeSanity(null);
		await expect(
			createSanityShopAdapter(() => missing.client).loadPrintSet("missing", false),
		).rejects.toMatchObject({ status: 404, body: { message: "Print set not found" } });
		expect(missing.fetch).toHaveBeenCalledOnce();
	});

	it("keeps collection fetch order, stock filters, V1-only products, and projections", async () => {
		const { client, fetch } = fakeSanity(
			{
				title: "Collection",
				description: "Description",
				previewImage: image("collection", "Collection alt"),
			},
			[
				{ title: "Child A", slug: "a", previewImage: image("child-a") },
				{ title: "Child B", slug: "b", previewImage: image("child-b", "B") },
			],
			[
				{
					title: "Set A",
					slug: "set-a",
					images: [image("set-a-1"), image("set-a-2")],
					previewImage: image("set-a"),
					price: 50,
				},
			],
			[{ title: "Product A", slug: "product-a", previewImage: image("product-a"), price: 5 }],
		);

		const result = await createSanityShopAdapter(() => client).loadCollection("collection", true);
		const queries = fetch.mock.calls.map(([query]) => query);
		expect(queries[0]).toContain('_type == "printCollection"');
		expect(queries[1]).toContain("references(");
		expect(queries[2]).toContain('_type == "lumaPrintSetV2"');
		expect(queries[2]).toContain("inStock == true");
		expect(queries[3]).toContain('*[_type == "product"');
		expect(queries[3]).not.toContain("lumaProductV2");
		expect(queries[3]).toContain("inStock == true");
		expect(result.collection).toMatchObject({
			slug: "collection",
			previewImage: "preview:collection",
			alt: "Collection alt",
		});
		expect(
			result.subCollections.map(({ slug, previewImage, alt }) => ({ slug, previewImage, alt })),
		).toEqual([
			{ slug: "a", previewImage: "preview:child-a", alt: "" },
			{ slug: "b", previewImage: "preview:child-b", alt: "B" },
		]);
		expect(result.printSets[0]).toMatchObject({
			preview1: "thumb:set-a-1",
			preview2: "thumb:set-a-2",
			previewImage: "preview:set-a",
		});
		expect(result.products[0]).toMatchObject({ preview: "preview:product-a" });

		const missing = fakeSanity(null);
		await expect(
			createSanityShopAdapter(() => missing.client).loadCollection("missing", false),
		).rejects.toMatchObject({ status: 404, body: { message: "Collection not found" } });
		expect(missing.fetch).toHaveBeenCalledOnce();
	});

	it("passes preview selection through and allows no-token fallback to one client", async () => {
		const fallback = fakeSanity(v2Product(), v2Product());
		selectDefaultClient.mockReturnValue(fallback.client);

		await sanityShop.loadProduct("preview", true);
		await sanityShop.loadProduct("published", false);

		expect(selectDefaultClient.mock.calls).toEqual([[true], [false]]);
		expect(fallback.fetch).toHaveBeenCalledTimes(2);
	});
});
