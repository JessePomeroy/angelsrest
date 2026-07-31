import { describe, expect, it, vi } from "vitest";

vi.mock("$env/dynamic/private", () => ({ env: {} }));
vi.mock("$env/dynamic/public", () => ({ env: { PUBLIC_CONVEX_URL: "https://convex.test" } }));
vi.mock("$lib/sanity/client.server", () => ({ getSanityClient: vi.fn() }));
vi.mock("$lib/server/sanityShop.server", () => ({ sanityShop: {} }));

import { createCatalogShopProvider } from "$lib/server/catalogShop.server";
import {
	adaptConvexIndex,
	adaptConvexPrintSet,
	adaptConvexProduct,
	ConvexShopProjectionError,
} from "$lib/server/convexShopAdapter";

const derivatives = {
	thumb: { contentType: "image/webp", width: 320, height: 213 },
	card: { contentType: "image/webp", width: 768, height: 512 },
	display1280: { contentType: "image/webp", width: 1280, height: 853 },
	display2048: { contentType: "image/webp", width: 2048, height: 1365 },
	display2560: { contentType: "image/webp", width: 2560, height: 1707 },
};

function first<T>(values: T[]) {
	const value = values[0];
	if (!value) throw new Error("Fixture is empty");
	return value;
}

function at(value: unknown, path: PropertyKey[]) {
	let target = value;
	for (const key of path) target = (target as Record<PropertyKey, unknown>)[key];
	return target as Record<PropertyKey, unknown>;
}

function uuid(value: string) {
	let hash = 0;
	for (const character of value) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
	return `10000000-0000-4000-8000-${String(hash).padStart(12, "0")}`;
}

function media(role: string, order: number, id: string) {
	return {
		key: `${role}-${order}`,
		role,
		order,
		altText: role === "social_share" ? null : `${role} alt`,
		asset: { assetId: uuid(id), source: { width: 3000, height: 2000 }, derivatives },
	};
}

function projection(kind: string, index = 0) {
	const slug = `${kind.replace("_", "-")}-${index}`;
	const isPrint = kind === "print" || kind === "print_set";
	return {
		schemaVersion: 2,
		productId: `product-${slug}`,
		revisionId: `revision-${slug}`,
		productKind: kind,
		title: `Title ${slug}`,
		slug,
		description: `Description ${slug}`,
		seoDescription: `SEO ${slug}`,
		currency: "usd",
		saleAvailability: "available",
		variants: [
			{
				key: "default",
				order: 0,
				materialOption: isPrint ? { label: "Archival Matte", slug: "archival-matte" } : null,
				sizeOption: isPrint
					? { heightInches: 10, widthInches: 8, label: "8×10", slug: "8x10" }
					: null,
				retailPriceCents: 4201 + index,
			},
		],
		shopPlacement: {
			featured: false,
			orderRank: `rank-${String(index).padStart(2, "0")}` as string | null,
		},
		...(isPrint
			? {
					printOptions: {
						borderOptionsEnabled: true,
						frameOptionsEnabled: false,
						framePriceMultiplierBasisPoints: 20_000,
					},
				}
			: {}),
		media:
			kind === "print"
				? [media("primary", 0, `asset-${slug}`)]
				: kind === "print_set"
					? [
							media("cover", 0, `asset-${slug}-cover`),
							media("set_member", 0, `asset-${slug}-one`),
							media("set_member", 1, `asset-${slug}-two`),
						]
					: [
							media("gallery", 0, `asset-${slug}`),
							media("social_share", 0, `asset-${slug}-social`),
						],
	};
}

function completeCatalog() {
	return [
		...Array.from({ length: 11 }, (_, index) => projection("print", index)),
		...Array.from({ length: 2 }, (_, index) => projection("print_set", index)),
		...Array.from({ length: 19 }, (_, index) => projection("tapestry", index)),
		projection("digital_download"),
	];
}

function fakeSanity() {
	return {
		loadIndex: vi.fn(async () => ({ source: "sanity" })),
		loadCollectionIndex: vi.fn(async () => [{ slug: "sanity-collection" }]),
		loadProduct: vi.fn(async () => ({ source: "sanity-product" })),
		loadPrintSet: vi.fn(async () => ({ source: "sanity-set" })),
		loadCollection: vi.fn(async () => ({ source: "sanity-collection" })),
	};
}

function reader(list: unknown = completeCatalog()) {
	return { listPublished: vi.fn(async () => list) };
}

describe("Convex Shop page-shape adapter", () => {
	it("requires the complete baseline, filters unavailable rows, and maps immutable cards", () => {
		const catalog = completeCatalog();
		const unavailable = catalog[1];
		if (!unavailable) throw new Error("Fixture is incomplete");
		unavailable.saleAvailability = "unavailable";
		const result = adaptConvexIndex(catalog);

		expect([result.products.length, result.printSets.length]).toEqual([30, 2]);
		expect(result.products.map(({ category }) => category)).toEqual(
			expect.arrayContaining(["prints", "tapestries", "digital"]),
		);
		expect(result.products.find(({ slug }) => slug === "print-0")).toMatchObject({
			preview: `https://media.angelsrest.online/sites/angelsrest.online/web/${uuid("asset-print-0")}/card.webp`,
			price: 42.01,
		});
		expect(result.printSets[0]).toMatchObject({
			previewImage: `https://media.angelsrest.online/sites/angelsrest.online/web/${uuid("asset-print-set-0-cover")}/card.webp`,
			preview1: `https://media.angelsrest.online/sites/angelsrest.online/web/${uuid("asset-print-set-0-one")}/thumb.webp`,
		});
	});

	it("reconstructs the live Sanity featured and V2-first merge order", () => {
		const catalog = completeCatalog();
		for (const product of catalog) product.saleAvailability = "unavailable";
		const orderedProducts = [
			{ slug: "print-1", featured: true, title: "A featured print", orderRank: "rank-01" },
			{ slug: "print-0", featured: true, title: "Z featured print", orderRank: "rank-00" },
			{
				slug: "tapestry-1",
				featured: true,
				title: "A featured general",
				orderRank: "rank-00",
			},
			{
				slug: "tapestry-0",
				featured: true,
				title: "Z featured general",
				orderRank: "rank-00",
			},
			{ slug: "print-3", featured: false, title: "A regular print", orderRank: "rank-03" },
			{ slug: "print-2", featured: false, title: "Z regular print", orderRank: "rank-02" },
			{
				slug: "tapestry-3",
				featured: false,
				title: "A rank-tied general",
				orderRank: "rank-00",
			},
			{
				slug: "tapestry-2",
				featured: false,
				title: "Z rank-tied general",
				orderRank: "rank-00",
			},
			{
				slug: "tapestry-5",
				featured: false,
				title: "A later-rank general",
				orderRank: "rank-01",
			},
			{
				slug: "tapestry-4",
				featured: false,
				title: "A null-rank general",
				orderRank: null,
			},
		] as const;
		for (const expected of orderedProducts) {
			const product = catalog.find(({ slug }) => slug === expected.slug);
			if (!product) throw new Error("Fixture is incomplete");
			product.saleAvailability = "available";
			product.shopPlacement.featured = expected.featured;
			product.shopPlacement.orderRank = expected.orderRank;
			product.title = expected.title;
		}

		const slugs = adaptConvexIndex(catalog.reverse()).products.map(({ slug }) => slug);

		expect(slugs).toEqual(orderedProducts.map(({ slug }) => slug));
	});

	it("maps print, all fixed kinds, and print-set details without IDs or private facts", () => {
		const print = adaptConvexProduct(projection("print"));
		expect(print).toMatchObject({
			productType: "v2",
			product: {
				variants: [{ paper: "archival-matte", size: "8x10", retailPrice: 42.01 }],
				images: [
					{
						thumbnail: `https://media.angelsrest.online/sites/angelsrest.online/web/${uuid("asset-print-0")}/thumb.webp`,
						full: `https://media.angelsrest.online/sites/angelsrest.online/web/${uuid("asset-print-0")}/display-1280.webp`,
						original: `https://media.angelsrest.online/sites/angelsrest.online/web/${uuid("asset-print-0")}/display-2560.webp`,
					},
				],
			},
		});
		for (const [kind, category] of [
			["postcard", "postcards"],
			["tapestry", "tapestries"],
			["digital_download", "digital"],
			["merchandise", "merchandise"],
		] as const) {
			const available = adaptConvexProduct(projection(kind));
			expect(available).toMatchObject({
				productType: "v1",
				product: { category, availablePapers: [], inStock: true },
			});
			const unavailable = projection(kind);
			unavailable.saleAvailability = "unavailable";
			unavailable.variants = [];
			expect(adaptConvexProduct(unavailable)).toMatchObject({
				productType: "v1",
				product: { inStock: false, price: undefined },
			});
		}
		const set = adaptConvexPrintSet(projection("print_set"));
		expect(set).toMatchObject({
			printSet: { variants: [{ retailPrice: 42.01 }] },
			images: [
				{ thumb: expect.stringContaining("/thumb.webp") },
				{ thumb: expect.stringContaining("/thumb.webp") },
			],
		});
		expect(set?.printSet).not.toHaveProperty("parent");
		const output = JSON.stringify({
			print,
			set,
			general: adaptConvexProduct(projection("tapestry")),
			index: adaptConvexIndex(completeCatalog()),
		});
		expect(output).not.toMatch(/productId|revisionId|private|hash|provenance|capabilit|credential/);
	});

	it("returns null for unknown and wrong-kind routes", () => {
		expect(adaptConvexProduct(null)).toBeNull();
		expect(adaptConvexProduct(projection("print_set"))).toBeNull();
		expect(adaptConvexPrintSet(null)).toBeNull();
		expect(adaptConvexPrintSet(projection("print"))).toBeNull();
	});

	it.each([
		["partial", (catalog: ReturnType<typeof completeCatalog>) => catalog.pop()],
		[
			"overflow",
			(catalog: ReturnType<typeof completeCatalog>) => catalog.push(projection("print", 99)),
		],
		[
			"duplicate slug",
			(catalog: ReturnType<typeof completeCatalog>) => {
				const duplicate = catalog[1];
				if (!duplicate) throw new Error("Fixture is incomplete");
				duplicate.slug = first(catalog).slug;
			},
		],
		[
			"wrong count",
			(catalog: ReturnType<typeof completeCatalog>) => (first(catalog).productKind = "tapestry"),
		],
	])("rejects a %s catalog", (_name, mutate) => {
		const catalog = completeCatalog();
		mutate(catalog);
		expect(() => adaptConvexIndex(catalog)).toThrow(ConvexShopProjectionError);
	});

	it.each([
		["schema", (value: Record<string, unknown>) => (value.schemaVersion = 1)],
		["kind", (value: Record<string, unknown>) => (value.productKind = "other")],
		["currency", (value: Record<string, unknown>) => (value.currency = "eur")],
		["identifier", (value: Record<string, unknown>) => (value.productId = "../private")],
		["copy", (value: Record<string, unknown>) => (value.title = " untrimmed")],
		[
			"price",
			(value: Record<string, unknown>) =>
				(first(value.variants as Record<string, unknown>[]).retailPriceCents = 1.5),
		],
		[
			"selector",
			(value: Record<string, unknown>) =>
				(first(value.variants as Record<string, unknown>[]).materialOption = null),
		],
		[
			"placement",
			(value: Record<string, unknown>) =>
				((value.shopPlacement as Record<string, unknown>).featured = "yes"),
		],
		[
			"media role",
			(value: Record<string, unknown>) =>
				(first(value.media as Record<string, unknown>[]).role = "private"),
		],
		[
			"media order",
			(value: Record<string, unknown>) =>
				(first(value.media as Record<string, unknown>[]).order = 2),
		],
		[
			"asset ID",
			(value: Record<string, unknown>) =>
				((
					first(value.media as Record<string, unknown>[]).asset as Record<string, unknown>
				).assetId = "../key"),
		],
		[
			"MIME",
			(value: Record<string, unknown>) =>
				((
					(first(value.media as Record<string, unknown>[]).asset as Record<string, unknown>)
						.derivatives as Record<string, Record<string, unknown>>
				).card.contentType = "image/png"),
		],
		[
			"dimensions",
			(value: Record<string, unknown>) =>
				((
					(first(value.media as Record<string, unknown>[]).asset as Record<string, unknown>)
						.derivatives as Record<string, Record<string, unknown>>
				).card.width = 1),
		],
	] satisfies Array<
		[string, (value: Record<string, unknown>) => void]
	>)("rejects malformed %s facts", (_name, mutate) => {
		const value = structuredClone(projection("print")) as unknown as Record<string, unknown>;
		mutate(value);
		expect(() => adaptConvexProduct(value)).toThrow(ConvexShopProjectionError);
	});

	it("requires plain records with exact own keys at every projection level", () => {
		for (const path of [
			[],
			["shopPlacement"],
			["variants", 0],
			["variants", 0, "materialOption"],
			["variants", 0, "sizeOption"],
			["printOptions"],
			["media", 0],
			["media", 0, "asset"],
			["media", 0, "asset", "source"],
			["media", 0, "asset", "derivatives"],
			["media", 0, "asset", "derivatives", "card"],
		] satisfies PropertyKey[][]) {
			const value = structuredClone(projection("print"));
			at(value, path).privateExtra = "closed";
			expect(() => adaptConvexProduct(value)).toThrow(ConvexShopProjectionError);
		}
		expect(() => adaptConvexProduct(Object.create(projection("print")))).toThrow(
			ConvexShopProjectionError,
		);
	});
});

describe("explicit Convex provider dispatch", () => {
	it("uses Convex products plus only the dedicated Sanity collection index", async () => {
		const sanity = fakeSanity();
		const catalogReader = reader();
		const provider = createCatalogShopProvider({
			sanity: sanity as never,
			mode: () => "convex",
			createReader: () => catalogReader as never,
		});
		const result = await provider.loadIndex(false);
		expect(result.collections).toEqual([{ slug: "sanity-collection" }]);
		expect(catalogReader.listPublished).toHaveBeenCalledOnce();
		expect(sanity.loadCollectionIndex).toHaveBeenCalledWith(false);
		expect(sanity.loadIndex).not.toHaveBeenCalled();
	});

	it("selects detail reads from a complete list and leaves collection detail on Sanity", async () => {
		const sanity = fakeSanity();
		const catalogReader = reader();
		const provider = createCatalogShopProvider({
			sanity: sanity as never,
			mode: () => "convex",
			createReader: () => catalogReader as never,
		});
		await expect(provider.loadProduct("print-0", false)).resolves.toMatchObject({
			productType: "v2",
		});
		await expect(provider.loadPrintSet("print-set-0", false)).resolves.toHaveProperty("printSet");
		await expect(provider.loadCollection("collection", false)).resolves.toEqual({
			source: "sanity-collection",
		});
		expect(sanity.loadProduct).not.toHaveBeenCalled();
		expect(sanity.loadPrintSet).not.toHaveBeenCalled();
	});

	it("returns 404s only after a complete list omits the requested route kind", async () => {
		const catalogReader = reader();
		const provider = createCatalogShopProvider({
			sanity: fakeSanity() as never,
			mode: () => "convex",
			createReader: () => catalogReader as never,
		});
		await expect(provider.loadProduct("missing", false)).rejects.toMatchObject({
			status: 404,
			body: { message: "Product not found" },
		});
		await expect(provider.loadProduct("print-set-0", false)).rejects.toMatchObject({ status: 404 });
		await expect(provider.loadPrintSet("print-0", false)).rejects.toMatchObject({
			status: 404,
			body: { message: "Print set not found" },
		});
	});

	it("fails malformed or unavailable Convex reads closed without Sanity fallback", async () => {
		for (const value of [[projection("print")], new Error("private upstream detail")]) {
			const sanity = fakeSanity();
			const catalogReader = reader();
			if (value instanceof Error) catalogReader.listPublished.mockRejectedValue(value);
			else catalogReader.listPublished.mockResolvedValue(value as never);
			const provider = createCatalogShopProvider({
				sanity: sanity as never,
				mode: () => "convex",
				createReader: () => catalogReader as never,
			});
			await expect(provider.loadIndex(false)).rejects.toMatchObject({
				status: 503,
				body: { message: "Shop catalog is unavailable" },
			});
			expect(sanity.loadIndex).not.toHaveBeenCalled();
		}
		const provider = createCatalogShopProvider({
			sanity: fakeSanity() as never,
			mode: () => "convex",
			createReader: () => reader([projection("print")]) as never,
		});
		await expect(provider.loadProduct("print-0", false)).rejects.toMatchObject({ status: 503 });
	});

	it("fails a dedicated Sanity collection-index error closed", async () => {
		const failure = new Error("collection unavailable");
		const sanity = fakeSanity();
		sanity.loadCollectionIndex.mockRejectedValue(failure);
		const provider = createCatalogShopProvider({
			sanity: sanity as never,
			mode: () => "convex",
			createReader: () => reader() as never,
		});
		await expect(provider.loadIndex(false)).rejects.toMatchObject({
			status: 503,
			body: { message: "Shop catalog is unavailable" },
		});
	});
});
