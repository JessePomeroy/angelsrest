import { describe, expect, it, vi } from "vitest";

vi.mock("$env/dynamic/private", () => ({ env: {} }));
vi.mock("$env/dynamic/public", () => ({ env: { PUBLIC_CONVEX_URL: "https://convex.test" } }));

import {
	adaptConvexIndex,
	adaptConvexPrintSet,
	adaptConvexProduct,
	ConvexShopProjectionError,
} from "$lib/server/convexShopAdapter";
import {
	createConvexShop,
	readConvexShopRuntimeSentinel,
} from "$lib/server/current/convexShop.server";

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

function media(role: string, order: number, id: string, altText?: string) {
	return {
		key: `${role}-${order}`,
		role,
		order,
		altText: role === "social_share" ? null : (altText ?? `${role} alt`),
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

function reader(list: unknown = completeCatalog()) {
	return {
		listPublished: vi.fn(async () => list),
		getPublishedBySlug: vi.fn(async (slug: string) =>
			Array.isArray(list)
				? (list.find(
						(value) =>
							value && typeof value === "object" && (value as { slug?: unknown }).slug === slug,
					) ?? null)
				: null,
		),
	};
}

describe("Convex Shop page-shape adapter", () => {
	it("accepts the bounded live catalog, filters unavailable rows, and maps immutable cards", () => {
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

	it("accepts empty and partial catalogs without freezing a historical kind distribution", () => {
		expect(adaptConvexIndex([])).toEqual({ products: [], printSets: [] });
		expect(adaptConvexIndex([projection("tapestry"), projection("merchandise")])).toMatchObject({
			products: [{ category: "merchandise" }, { category: "tapestries" }],
			printSets: [],
		});
	});

	it("accepts an unavailable cover-only print set without exposing it in the index", () => {
		const unavailable = projection("print_set");
		unavailable.saleAvailability = "unavailable";
		unavailable.variants = [];
		unavailable.media = [media("cover", 0, "unavailable-set-cover")];

		expect(adaptConvexIndex([unavailable])).toEqual({ products: [], printSets: [] });
		expect(adaptConvexPrintSet(unavailable)).toMatchObject({
			printSet: { inStock: false, variants: [] },
			images: [],
		});

		const missingCover = structuredClone(unavailable);
		missingCover.media = [media("social_share", 0, "unavailable-set-social")];
		expect(() => adaptConvexPrintSet(missingCover)).toThrow(ConvexShopProjectionError);
	});

	it("reconstructs the live featured catalog order", () => {
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
		if (!print || print.productType !== "v2") throw new Error("Expected a V2 print");
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
		const printKeys = [
			"title",
			"slug",
			"description",
			"variants",
			"bordersEnabled",
			"framedEnabled",
			"frameMarkupMultiplier",
			"inStock",
			"featured",
			"images",
		];
		expect(Reflect.ownKeys(print.product)).toEqual(printKeys);
		expect(Object.keys(JSON.parse(JSON.stringify(print.product)))).toEqual(printKeys);
		expect(Object.hasOwn(print.product, "price")).toBe(false);
		expect(Object.hasOwn(print.product, "category")).toBe(false);
		for (const [kind, category] of [
			["postcard", "postcards"],
			["tapestry", "tapestries"],
			["digital_download", "digital"],
			["merchandise", "merchandise"],
		] as const) {
			const available = adaptConvexProduct(projection(kind));
			if (!available || available.productType !== "v1") throw new Error("Expected a V1 product");
			expect(available).toMatchObject({
				productType: "v1",
				product: { category, availablePapers: [], inStock: true },
			});
			const unavailable = projection(kind);
			unavailable.saleAvailability = "unavailable";
			unavailable.variants = [];
			const unavailableOutput = adaptConvexProduct(unavailable);
			if (!unavailableOutput || unavailableOutput.productType !== "v1")
				throw new Error("Expected an unavailable V1 product");
			expect(unavailableOutput).toMatchObject({
				productType: "v1",
				product: { inStock: false, price: undefined },
			});
			const generalKeys = [
				"title",
				"slug",
				"description",
				"price",
				"category",
				"featured",
				"inStock",
				"images",
				"availablePapers",
				"seo",
			];
			expect(Reflect.ownKeys(available.product)).toEqual(generalKeys);
			expect(Object.keys(JSON.parse(JSON.stringify(available.product)))).toEqual(generalKeys);
			expect(Reflect.ownKeys(unavailableOutput.product)).toEqual(generalKeys);
			expect(Object.hasOwn(unavailableOutput.product, "price")).toBe(true);
			expect(Object.keys(JSON.parse(JSON.stringify(unavailableOutput.product)))).toEqual(
				generalKeys.filter((key) => key !== "price"),
			);
		}
		const set = adaptConvexPrintSet(projection("print_set"));
		if (!set) throw new Error("Expected a print set");
		expect(set).toMatchObject({
			printSet: { variants: [{ retailPrice: 42.01 }] },
			images: [
				{ thumb: expect.stringContaining("/thumb.webp") },
				{ thumb: expect.stringContaining("/thumb.webp") },
			],
		});
		const printSetKeys = [
			"title",
			"slug",
			"description",
			"previewImage",
			"variants",
			"bordersEnabled",
			"framedEnabled",
			"frameMarkupMultiplier",
			"inStock",
		];
		expect(Reflect.ownKeys(set)).toEqual(["printSet", "images"]);
		expect(Reflect.ownKeys(set.printSet)).toEqual(printSetKeys);
		expect(Object.keys(JSON.parse(JSON.stringify(set.printSet)))).toEqual(printSetKeys);
		expect(Object.hasOwn(set.printSet, "parent")).toBe(false);
		const output = JSON.stringify({
			print,
			set,
			general: adaptConvexProduct(projection("tapestry")),
			index: adaptConvexIndex(completeCatalog()),
		});
		expect(output).not.toMatch(/productId|revisionId|private|hash|provenance|capabilit|credential/);
	});

	it("preserves every tapestry gallery image in its saved order with its own alt text", () => {
		const tapestry = projection("tapestry");
		tapestry.media = [
			media("gallery", 0, "tapestry-first", "first tapestry view"),
			media("gallery", 1, "tapestry-second", "second tapestry view"),
			media("gallery", 2, "tapestry-third", "third tapestry view"),
			media("social_share", 0, "tapestry-social"),
		];

		const result = adaptConvexProduct(tapestry);
		if (!result || result.productType !== "v1") throw new Error("Expected a tapestry");
		expect(result.product.images).toEqual([
			expect.objectContaining({
				alt: "first tapestry view",
				full: expect.stringContaining(`${uuid("tapestry-first")}/display-1280.webp`),
			}),
			expect.objectContaining({
				alt: "second tapestry view",
				full: expect.stringContaining(`${uuid("tapestry-second")}/display-1280.webp`),
			}),
			expect.objectContaining({
				alt: "third tapestry view",
				full: expect.stringContaining(`${uuid("tapestry-third")}/display-1280.webp`),
			}),
		]);
	});

	it("returns null for unknown and wrong-kind routes", () => {
		expect(adaptConvexProduct(null)).toBeNull();
		expect(adaptConvexProduct(projection("print_set"))).toBeNull();
		expect(adaptConvexPrintSet(null)).toBeNull();
		expect(adaptConvexPrintSet(projection("print"))).toBeNull();
	});

	it("accepts provider-authoritative adjacent-pixel heights and rejects wider drift", () => {
		const value = structuredClone(projection("print"));
		const asset = first(value.media).asset;
		asset.source = { width: 1600, height: 1074 };
		asset.derivatives = {
			thumb: { contentType: "image/webp", width: 320, height: 214 },
			card: { contentType: "image/webp", width: 768, height: 515 },
			display1280: { contentType: "image/webp", width: 1280, height: 859 },
			display2048: { contentType: "image/webp", width: 1600, height: 1074 },
			display2560: { contentType: "image/webp", width: 1600, height: 1074 },
		};

		expect(() => adaptConvexProduct(value)).not.toThrow();
		asset.derivatives.card.height = 514;
		expect(() => adaptConvexProduct(value)).toThrow(ConvexShopProjectionError);
	});

	it.each([
		[
			"over-cap",
			(catalog: ReturnType<typeof completeCatalog>) => {
				while (catalog.length <= 40) catalog.push(projection("tapestry", catalog.length));
			},
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
			"unknown kind",
			(catalog: ReturnType<typeof completeCatalog>) => (first(catalog).productKind = "other"),
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

describe("Convex-only Shop runtime", () => {
	it("reports health from the same dynamic Convex index projection", async () => {
		const catalogReader = reader([projection("tapestry"), projection("print_set")]);
		await expect(
			readConvexShopRuntimeSentinel({ createReader: () => catalogReader as never }),
		).resolves.toEqual({
			outcome: "healthy",
			publishedProductCount: 2,
			productIndexCount: 1,
			printSetIndexCount: 1,
			collectionIndexCount: 0,
		});
	});

	it("loads the dynamic Convex index with no collection dependency", async () => {
		const catalogReader = reader([projection("tapestry"), projection("print_set")]);
		const shop = createConvexShop({ createReader: () => catalogReader as never });

		await expect(shop.loadIndex()).resolves.toMatchObject({
			products: [{ slug: "tapestry-0" }],
			printSets: [{ slug: "print-set-0" }],
			collections: [],
		});
		expect(catalogReader.listPublished).toHaveBeenCalledOnce();
		expect(catalogReader.getPublishedBySlug).not.toHaveBeenCalled();
	});

	it("uses the exact-slug query for detail and retires collection detail with a 404", async () => {
		const catalogReader = reader();
		const shop = createConvexShop({ createReader: () => catalogReader as never });

		await expect(shop.loadProduct("print-0")).resolves.toMatchObject({ productType: "v2" });
		await expect(shop.loadPrintSet("print-set-0")).resolves.toHaveProperty("printSet");
		await expect(shop.loadCollection("collection")).rejects.toMatchObject({
			status: 404,
			body: { message: "Print collection not found" },
		});
		expect(catalogReader.listPublished).not.toHaveBeenCalled();
		expect(catalogReader.getPublishedBySlug).toHaveBeenNthCalledWith(
			1,
			"print-0",
			expect.any(AbortSignal),
		);
		expect(catalogReader.getPublishedBySlug).toHaveBeenNthCalledWith(
			2,
			"print-set-0",
			expect.any(AbortSignal),
		);
	});

	it("fails a valid detail projection closed when its slug does not match the requested slug", async () => {
		const productReader = reader();
		productReader.getPublishedBySlug.mockResolvedValue(projection("print", 1) as never);
		const productShop = createConvexShop({ createReader: () => productReader as never });
		await expect(productShop.loadProduct("print-0")).rejects.toMatchObject({
			status: 503,
			body: { message: "Shop catalog is unavailable" },
		});

		const setReader = reader();
		setReader.getPublishedBySlug.mockResolvedValue(projection("print_set", 1) as never);
		const setShop = createConvexShop({ createReader: () => setReader as never });
		await expect(setShop.loadPrintSet("print-set-0")).rejects.toMatchObject({
			status: 503,
			body: { message: "Shop catalog is unavailable" },
		});
	});

	it("returns clean 404s for missing or wrong-kind exact-slug reads", async () => {
		const catalogReader = reader();
		const shop = createConvexShop({ createReader: () => catalogReader as never });

		await expect(shop.loadProduct("missing")).rejects.toMatchObject({
			status: 404,
			body: { message: "Product not found" },
		});
		await expect(shop.loadProduct("print-set-0")).rejects.toMatchObject({ status: 404 });
		await expect(shop.loadPrintSet("print-0")).rejects.toMatchObject({
			status: 404,
			body: { message: "Print set not found" },
		});
	});

	it("fails malformed or unavailable Convex reads closed", async () => {
		const malformed = projection("tapestry") as Record<string, unknown>;
		malformed.schemaVersion = 1;
		const malformedReader = reader([malformed]);
		const malformedShop = createConvexShop({ createReader: () => malformedReader as never });
		await expect(malformedShop.loadIndex()).rejects.toMatchObject({
			status: 503,
			body: { message: "Shop catalog is unavailable" },
		});

		const unavailableReader = reader();
		unavailableReader.listPublished.mockRejectedValue(new Error("private upstream list"));
		unavailableReader.getPublishedBySlug.mockRejectedValue(new Error("private upstream detail"));
		const unavailableShop = createConvexShop({
			createReader: () => unavailableReader as never,
		});
		await expect(unavailableShop.loadIndex()).rejects.toMatchObject({ status: 503 });
		await expect(unavailableShop.loadProduct("print-0")).rejects.toMatchObject({ status: 503 });
	});

	it("uses the production AbortSignal timeout to close an ignored pending read", async () => {
		const catalogReader = reader();
		catalogReader.listPublished.mockImplementation(() => new Promise<never>(() => {}));
		const shop = createConvexShop({
			createReader: () => catalogReader as never,
			deadlineMs: 5,
		});
		await expect(shop.loadIndex()).rejects.toMatchObject({
			status: 503,
			body: { message: "Shop catalog is unavailable" },
		});
	});

	it("bounds never-settling index, detail, and authoritative sentinel reads", async () => {
		const indexController = new AbortController();
		const indexTimeout = vi.fn(() => indexController.signal);
		const indexReader = reader();
		indexReader.listPublished.mockImplementation(() => new Promise<never>(() => {}));
		const indexShop = createConvexShop({
			createReader: () => indexReader as never,
			deadlineMs: 17,
			createTimeoutSignal: indexTimeout,
		});
		const indexFailure = expect(indexShop.loadIndex()).rejects.toMatchObject({
			status: 503,
			body: { message: "Shop catalog is unavailable" },
		});
		indexController.abort(new Error("private index timeout"));
		await indexFailure;
		expect(indexTimeout).toHaveBeenCalledWith(17);

		const detailController = new AbortController();
		const detailTimeout = vi.fn(() => detailController.signal);
		const detailReader = reader();
		detailReader.getPublishedBySlug.mockImplementation(() => new Promise<never>(() => {}));
		const detailShop = createConvexShop({
			createReader: () => detailReader as never,
			deadlineMs: 19,
			createTimeoutSignal: detailTimeout,
		});
		const detailFailure = expect(detailShop.loadProduct("print-0")).rejects.toMatchObject({
			status: 503,
			body: { message: "Shop catalog is unavailable" },
		});
		detailController.abort(new Error("private detail timeout"));
		await detailFailure;
		expect(detailTimeout).toHaveBeenCalledWith(19);

		const sentinelController = new AbortController();
		const sentinelTimeout = vi.fn(() => sentinelController.signal);
		const sentinelReader = reader();
		sentinelReader.listPublished.mockImplementation(() => new Promise<never>(() => {}));
		const sentinelFailure = expect(
			readConvexShopRuntimeSentinel({
				createReader: () => sentinelReader as never,
				deadlineMs: 23,
				createTimeoutSignal: sentinelTimeout,
			}),
		).rejects.toBeInstanceOf(Error);
		sentinelController.abort(new Error("private sentinel timeout"));
		await sentinelFailure;
		expect(sentinelTimeout).toHaveBeenCalledWith(23);
	});
});
