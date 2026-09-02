import { afterEach, describe, expect, it, vi } from "vitest";
import transferReceipts from "../catalogDisplayMediaTransferReceipts.json";

vi.mock("$env/dynamic/private", () => ({ env: {} }));
vi.mock("$env/dynamic/public", () => ({ env: { PUBLIC_CONVEX_URL: "https://convex.test" } }));
const getSanityClient = vi.hoisted(() => vi.fn());
const getFreshPublishedSanityClient = vi.hoisted(() => vi.fn());
vi.mock("$lib/sanity/client.server", () => ({
	getFreshPublishedSanityClient,
	getSanityClient,
}));
vi.mock("$lib/server/sanityShop.server", () => ({
	sanityShop: {
		loadIndex: vi.fn(),
		loadProduct: vi.fn(),
		loadPrintSet: vi.fn(),
		loadCollection: vi.fn(),
	},
}));

import {
	compareCatalogSemantics,
	compareShopCatalogSentinel,
	createCatalogShopProvider,
	parseCatalogProviderMode,
	readShopCatalogSentinel,
} from "$lib/server/catalogShop.server";

function first<T>(values: T[]) {
	const value = values[0];
	if (!value) throw new Error("Fixture is empty");
	return value;
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((accept, decline) => {
		resolve = accept;
		reject = decline;
	});
	return { promise, resolve, reject };
}

const sanityProduct = () => ({
	_type: "lumaProductV2",
	slug: "archival-print",
	title: "Catalog title",
	description: "Catalog description",
	hasCollection: false,
	hasParent: false,
	inStock: true,
	featured: true,
	variants: [
		{ paper: "archival-matte", size: "8x10", retailPrice: 42, enabled: true },
		{ paper: "glossy", size: "11x14", retailPrice: 50, enabled: false },
	],
	bordersEnabled: true,
	framedEnabled: false,
	frameMarkupMultiplier: 2,
	image: { alt: "Catalog alt", source: { width: 3000, height: 2000 } },
});

const convexAsset = () => ({
	assetId: "10000000-0000-4000-8000-000000000001",
	source: { height: 2000, width: 3000 },
	derivatives: {
		thumb: { contentType: "image/webp", width: 320, height: 213 },
		card: { contentType: "image/webp", width: 768, height: 512 },
		display1280: { contentType: "image/webp", width: 1280, height: 853 },
		display2048: { contentType: "image/webp", width: 2048, height: 1365 },
		display2560: { contentType: "image/webp", width: 2560, height: 1707 },
	},
});

const convexProduct = () => ({
	schemaVersion: 2 as const,
	productId: "product-private-looking",
	revisionId: "revision-private-looking",
	productKind: "print" as "print" | "print_set",
	title: "Catalog title",
	slug: "archival-print",
	description: "Catalog description",
	seoDescription: null,
	currency: "usd" as const,
	saleAvailability: "available" as "available" | "unavailable",
	variants: [
		{
			key: "ignored-key",
			order: 0,
			materialOption: { label: "Archival Matte", slug: "archival-matte" },
			sizeOption: {
				heightInches: 10,
				widthInches: 8,
				label: "8×10",
				slug: "8x10",
			},
			retailPriceCents: 4200,
		},
	],
	shopPlacement: { orderRank: null as string | null, featured: true },
	printOptions: {
		framePriceMultiplierBasisPoints: 20_000,
		frameOptionsEnabled: false,
		borderOptionsEnabled: true,
	},
	media: [
		{
			key: "ignored-media-key",
			role: "primary" as "primary" | "cover" | "gallery" | "set_member",
			order: 0,
			altText: "Catalog alt",
			asset: convexAsset(),
		},
	],
});

function fakeSanity(index: Promise<unknown> = Promise.resolve({ route: "sanity" })) {
	return {
		loadIndex: vi.fn(() => index),
		loadCollectionIndex: vi.fn(async () => [{ slug: "sanity-collection" }]),
		loadProduct: vi.fn(async (slug: string, preview: boolean) => ({ slug, preview })),
		loadPrintSet: vi.fn(async (slug: string, preview: boolean) => ({ slug, preview })),
		loadCollection: vi.fn(async (slug: string, preview: boolean) => ({ slug, preview })),
	};
}

function fakeReader(list: Promise<unknown>) {
	return { listPublished: vi.fn((_signal: AbortSignal) => list) };
}

function completeCatalog() {
	const sanity: unknown[] = [];
	const convex: unknown[] = [];
	const source = { alt: "Catalog alt", source: { width: 3000, height: 2000 } };
	for (let index = 0; index < 11; index += 1) {
		const slug = index === 0 ? "archival-print" : `print-${index}`;
		sanity.push({ ...sanityProduct(), slug });
		convex.push({ ...convexProduct(), slug });
	}
	for (let index = 0; index < 2; index += 1) {
		const productSlug = `set-${index}`;
		sanity.push({
			...sanityProduct(),
			_type: "lumaPrintSetV2",
			slug: productSlug,
			previewImage: source,
			images: [source],
		});
		const product = convexProduct();
		product.productKind = "print_set";
		product.slug = productSlug;
		product.media = [
			{ ...first(product.media), key: "cover", role: "cover" },
			{ ...first(product.media), key: "member", role: "set_member" },
		];
		convex.push(product);
	}
	for (const [category, kind, count] of [
		["tapestries", "tapestry", 19],
		["digital", "digital_download", 1],
	] as const) {
		for (let index = 0; index < count; index += 1) {
			const productSlug = `${kind.replace("_", "-")}-${index}`;
			sanity.push({
				_type: "product",
				slug: productSlug,
				title: "Catalog title",
				description: "Catalog description",
				category,
				inStock: true,
				hasCollection: false,
				hasParent: false,
				price: 10,
				availablePapers: [],
				images: [source],
			});
			const product = convexProduct() as unknown as Record<string, unknown>;
			Object.assign(product, {
				productKind: kind,
				slug: productSlug,
				variants: [
					{
						key: "default",
						order: 0,
						materialOption: null,
						sizeOption: null,
						retailPriceCents: 1000,
					},
				],
				shopPlacement: { featured: false, orderRank: null },
				media: [
					{
						key: "gallery",
						role: "gallery",
						order: 0,
						altText: "Catalog alt",
						asset: convexAsset(),
					},
				],
			});
			delete product.printOptions;
			convex.push(product);
		}
	}
	return { sanity, convex };
}

const noPresentationMismatches = {
	copy: 0,
	mediaStructure: 0,
	altText: 0,
	dimensions: 0,
};

const transferBoundSanityRef = "image-e99ab36cab090eb18cf258460069f73de2b22ce2-4664x3109-jpg";
const transferBoundReceipt = transferReceipts.receipts[transferBoundSanityRef];

function resizeConvexAsset(asset: ReturnType<typeof convexAsset>, width: number, height: number) {
	asset.source = { width, height };
	const maximumWidths = {
		thumb: 320,
		card: 768,
		display1280: 1280,
		display2048: 2048,
		display2560: 2560,
	} as const;
	for (const [preset, maximumWidth] of Object.entries(maximumWidths) as Array<
		[keyof typeof maximumWidths, number]
	>) {
		const derivativeWidth = Math.min(width, maximumWidth);
		asset.derivatives[preset].width = derivativeWidth;
		asset.derivatives[preset].height = Math.max(1, Math.round(height * (derivativeWidth / width)));
	}
}

function receiptBoundDimensionCatalog(count = 1) {
	const catalog = completeCatalog();
	const sanityImages: Array<ReturnType<typeof sanityProduct>["image"] & { assetRef?: string }> = [];
	const convexAssets: Array<ReturnType<typeof convexAsset>> = [];
	for (let index = 0; index < count; index += 1) {
		const sanityProductValue = catalog.sanity[index] as ReturnType<typeof sanityProduct>;
		const convexProductValue = catalog.convex[index] as ReturnType<typeof convexProduct>;
		const sanityImage = sanityProductValue.image as typeof sanityProductValue.image & {
			assetRef?: string;
		};
		Object.assign(sanityImage, {
			assetRef: transferBoundSanityRef,
			source: { width: 4664, height: 3109 },
		});
		const convexAssetValue = first(convexProductValue.media).asset;
		convexAssetValue.assetId = transferBoundReceipt.workerAssetId;
		resizeConvexAsset(
			convexAssetValue,
			transferBoundReceipt.source.width,
			transferBoundReceipt.source.height,
		);
		sanityImages.push(sanityImage);
		convexAssets.push(convexAssetValue);
	}
	const sanityImage = first(sanityImages);
	const convexAssetValue = first(convexAssets);
	return { catalog, sanityImage, convexAsset: convexAssetValue };
}

afterEach(() => {
	vi.useRealTimers();
	getFreshPublishedSanityClient.mockReset();
	getSanityClient.mockReset();
});

describe("catalog provider mode", () => {
	it.each([
		["sanity", "sanity"],
		["shadow", "shadow"],
		["convex", "convex"],
		[undefined, "sanity"],
		[null, "sanity"],
		["", "sanity"],
		["Shadow", "sanity"],
		[" convex ", "sanity"],
		["invalid", "sanity"],
	])("parses %j as %s", (value, expected) => {
		expect(parseCatalogProviderMode(value)).toBe(expected);
	});

	it("returns the exact Sanity value by default and preserves Sanity rejection identity", async () => {
		const output = { products: [], collections: [], printSets: [] };
		const sanity = fakeSanity(Promise.resolve(output));
		const createReader = vi.fn();
		const provider = createCatalogShopProvider({ sanity: sanity as never, createReader });

		await expect(provider.loadIndex(false)).resolves.toBe(output);
		expect(createReader).not.toHaveBeenCalled();

		const failure = new Error("Sanity route failure");
		const broken = createCatalogShopProvider({
			sanity: fakeSanity(Promise.reject(failure)) as never,
			createReader,
		});
		await expect(broken.loadIndex(false)).rejects.toBe(failure);
	});

	it("branches preview before mode, client construction, and timers", async () => {
		const sanity = fakeSanity();
		const mode = vi.fn(() => "shadow");
		const createReader = vi.fn();
		const timer = vi.spyOn(globalThis, "setTimeout");
		const provider = createCatalogShopProvider({ sanity: sanity as never, mode, createReader });

		await provider.loadIndex(true);
		await provider.loadProduct("preview", true);
		await provider.loadPrintSet("preview-set", true);
		await provider.loadCollection("preview-collection", true);
		expect(sanity.loadIndex).toHaveBeenCalledWith(true);
		expect(sanity.loadProduct).toHaveBeenCalledWith("preview", true);
		expect(sanity.loadPrintSet).toHaveBeenCalledWith("preview-set", true);
		expect(sanity.loadCollection).toHaveBeenCalledWith("preview-collection", true);
		expect(mode).not.toHaveBeenCalled();
		expect(createReader).not.toHaveBeenCalled();
		expect(timer).not.toHaveBeenCalled();
	});
});

describe("catalog semantic comparison", () => {
	it("matches the complete reviewed baseline by ordinal slug and fixed-key semantics", () => {
		const { sanity, convex } = completeCatalog();
		expect(compareCatalogSemantics(sanity, convex)).toEqual({
			primaryCount: 33,
			secondaryCount: 33,
		});
	});

	it.each([
		[
			"availability",
			(value: ReturnType<typeof convexProduct>) => {
				value.saleAvailability = "unavailable";
			},
		],
		[
			"featured",
			(value: ReturnType<typeof convexProduct>) => {
				value.shopPlacement.featured = false;
			},
		],
		[
			"order rank",
			(value: ReturnType<typeof convexProduct>) => {
				value.shopPlacement.orderRank = "a";
			},
		],
		[
			"integer cents",
			(value: ReturnType<typeof convexProduct>) => {
				first(value.variants).retailPriceCents += 1;
			},
		],
		[
			"material",
			(value: ReturnType<typeof convexProduct>) => {
				first(value.variants).materialOption = { slug: "glossy", label: "Glossy" };
			},
		],
		[
			"size selector",
			(value: ReturnType<typeof convexProduct>) => {
				first(value.variants).sizeOption = {
					slug: "11x14",
					label: "11×14",
					widthInches: 11,
					heightInches: 14,
				};
			},
		],
		[
			"print options",
			(value: ReturnType<typeof convexProduct>) => {
				value.printOptions.borderOptionsEnabled = false;
			},
		],
		[
			"media role",
			(value: ReturnType<typeof convexProduct>) => {
				value.media.push({ ...first(value.media), key: "gallery", role: "gallery" });
			},
		],
		[
			"media order",
			(value: ReturnType<typeof convexProduct>) => {
				value.media.push({ ...first(value.media), key: "second-primary", order: 1 });
			},
		],
		[
			"source dimensions",
			(value: ReturnType<typeof convexProduct>) => {
				const asset = first(value.media).asset;
				asset.source.height = 3000;
				for (const derivative of Object.values(asset.derivatives)) {
					derivative.height = derivative.width;
				}
			},
		],
	] as const)("detects a %s perturbation", (_name, mutate) => {
		const catalog = completeCatalog();
		mutate(first(catalog.convex) as ReturnType<typeof convexProduct>);
		const outcome = compareCatalogSemantics(catalog.sanity, catalog.convex);
		expect(outcome).toEqual({ reason: "mismatch", primaryCount: 33, secondaryCount: 33 });
	});

	it.each([
		[[], []],
		[[sanityProduct()], [convexProduct()]],
	])("rejects empty and partial catalogs instead of reporting a clean match", (sanity, convex) => {
		expect(() => compareCatalogSemantics(sanity, convex)).toThrow();
	});

	it("rejects overflow catalogs", () => {
		const catalog = completeCatalog();
		catalog.sanity.push({ ...sanityProduct(), slug: "overflow" });
		catalog.convex.push({ ...convexProduct(), slug: "overflow" });
		expect(() => compareCatalogSemantics(catalog.sanity, catalog.convex)).toThrow();
	});

	it("rejects a wrong kind distribution even when both catalogs have 33 matching products", () => {
		const catalog = completeCatalog();
		const sanity = catalog.sanity.find(
			(value) => (value as { category?: string }).category === "tapestries",
		) as { category: string };
		const convex = catalog.convex.find(
			(value) => (value as { productKind?: string }).productKind === "tapestry",
		) as { productKind: string };
		sanity.category = "digital";
		convex.productKind = "digital_download";
		expect(() => compareCatalogSemantics(catalog.sanity, catalog.convex)).toThrow();
	});

	it("does not traverse excluded copy, alt, IDs, derivatives, URLs, or private extras", () => {
		const catalog = completeCatalog();
		const convex = first(catalog.convex) as ReturnType<typeof convexProduct> &
			Record<string, unknown>;
		const placement = first(convex.media);
		Object.assign(convex, { provider: "hostile", cost: 999, raw: { token: "secret" } });
		Object.assign(placement, { url: "https://hostile.test/private", privateExtra: true });
		for (const [target, key] of [
			[convex, "productId"],
			[convex, "revisionId"],
			[convex, "title"],
			[convex, "description"],
			[placement, "key"],
			[placement, "altText"],
			[placement.asset, "assetId"],
			[placement.asset, "derivatives"],
		] as const) {
			Object.defineProperty(target, key, {
				configurable: true,
				get: () => {
					throw new Error(`excluded ${key} was observed`);
				},
			});
		}
		expect(compareCatalogSemantics(catalog.sanity, catalog.convex).reason).toBeUndefined();
	});

	it.each([
		{ ...sanityProduct(), _type: "product", category: "prints", price: 10, images: [] },
		{ ...sanityProduct(), _type: "product", category: "unknown", price: 10, images: [] },
		{ ...sanityProduct(), inStock: "yes" },
		{
			...sanityProduct(),
			variants: [{ paper: "glossy", size: "8x10", retailPrice: 1.001, enabled: true }],
		},
		{
			...sanityProduct(),
			variants: [{ paper: "glossy", size: "8x10", retailPrice: 10, enabled: "true" }],
		},
	])("rejects unsupported or malformed Sanity comparison metadata", (product) => {
		expect(() => compareCatalogSemantics([product], [convexProduct()])).toThrow();
	});

	it("defaults missing stock to available, includes unavailable products, and keeps only enabled variants", () => {
		const catalog = completeCatalog();
		const available = first(catalog.sanity) as ReturnType<typeof sanityProduct>;
		delete (available as Partial<typeof available>).inStock;
		const unavailable = catalog.sanity[1] as ReturnType<typeof sanityProduct>;
		unavailable.inStock = false;
		const secondary = catalog.convex[1] as ReturnType<typeof convexProduct>;
		secondary.saleAvailability = "unavailable";
		expect(compareCatalogSemantics(catalog.sanity, catalog.convex)).toEqual({
			primaryCount: 33,
			secondaryCount: 33,
		});
	});
});

describe("bounded public Shop drill sentinel", () => {
	it("matches all 33 products across distribution, commerce, presentation, associations, and rendered order", () => {
		const catalog = completeCatalog();
		expect(compareShopCatalogSentinel(catalog.sanity, catalog.convex)).toEqual({
			outcome: "exact",
			sanityCount: 33,
			convexCount: 33,
			distribution: "exact",
			publicAdapterValidation: "exact",
			commerceParity: "match",
			presentationParity: "match",
			presentationMismatchCounts: noPresentationMismatches,
			sanityPrintSetCoverFallbackCount: 0,
			transferEquivalentDimensionCount: 0,
			associationParity: "match",
			productIndexOrder: "match",
			printSetOrder: "match",
		});
	});

	it.each([
		[
			"title",
			"copy",
			(value: ReturnType<typeof convexProduct>) => {
				value.title = "Drifted public title";
			},
		],
		[
			"description",
			"copy",
			(value: ReturnType<typeof convexProduct>) => {
				value.description = "Drifted public description";
			},
		],
		[
			"SEO description",
			"copy",
			(value: ReturnType<typeof convexProduct>) => {
				(value as { seoDescription: string | null }).seoDescription = "Drifted SEO description";
			},
		],
		[
			"alternative text",
			"altText",
			(value: ReturnType<typeof convexProduct>) => {
				first(value.media).altText = "Drifted alternative text";
			},
		],
	] as const)("detects a %s presentation mismatch without returning the value", (_name, mismatchClass, mutate) => {
		const catalog = completeCatalog();
		mutate(first(catalog.convex) as ReturnType<typeof convexProduct>);
		const result = compareShopCatalogSentinel(catalog.sanity, catalog.convex);
		expect(result).toMatchObject({ outcome: "mismatch", presentationParity: "mismatch" });
		expect(result.presentationMismatchCounts).toEqual({
			...noPresentationMismatches,
			[mismatchClass]: 1,
		});
		expect(JSON.stringify(result)).not.toMatch(/Drifted|public title|SEO description/i);
	});

	it("uses the first set member for null Sanity covers and reports only the bounded fallback count", () => {
		const catalog = completeCatalog();
		for (const product of catalog.sanity) {
			if ((product as { _type?: string })._type === "lumaPrintSetV2") {
				(product as { previewImage: unknown }).previewImage = null;
			}
		}
		expect(compareCatalogSemantics(catalog.sanity, catalog.convex)).toEqual({
			primaryCount: 33,
			secondaryCount: 33,
		});
		expect(compareShopCatalogSentinel(catalog.sanity, catalog.convex)).toEqual({
			outcome: "exact",
			sanityCount: 33,
			convexCount: 33,
			distribution: "exact",
			publicAdapterValidation: "exact",
			commerceParity: "match",
			presentationParity: "match",
			presentationMismatchCounts: noPresentationMismatches,
			sanityPrintSetCoverFallbackCount: 2,
			transferEquivalentDimensionCount: 0,
			associationParity: "match",
			productIndexOrder: "match",
			printSetOrder: "match",
		});
	});

	it("classifies missing alternative text without exposing product or media identity", () => {
		const catalog = completeCatalog();
		delete ((first(catalog.sanity) as ReturnType<typeof sanityProduct>).image as { alt?: string })
			.alt;
		const result = compareShopCatalogSentinel(catalog.sanity, catalog.convex);
		expect(result).toMatchObject({
			outcome: "mismatch",
			distribution: "exact",
			commerceParity: "match",
			presentationParity: "mismatch",
			presentationMismatchCounts: {
				...noPresentationMismatches,
				altText: 1,
			},
			associationParity: "match",
			productIndexOrder: "match",
			printSetOrder: "match",
		});
		expect(JSON.stringify(result)).not.toMatch(/archival-print|Catalog alt|ignored-media-key/);
	});

	it.each([
		[
			"Sanity source width",
			(catalog: ReturnType<typeof completeCatalog>) => {
				(first(catalog.sanity) as ReturnType<typeof sanityProduct>).image.source.width += 1;
			},
		],
		[
			"Sanity source height",
			(catalog: ReturnType<typeof completeCatalog>) => {
				(first(catalog.sanity) as ReturnType<typeof sanityProduct>).image.source.height += 1;
			},
		],
		[
			"Convex source width",
			(catalog: ReturnType<typeof completeCatalog>) => {
				first(
					(first(catalog.convex) as ReturnType<typeof convexProduct>).media,
				).asset.source.width += 1;
			},
		],
		[
			"Convex derivative height",
			(catalog: ReturnType<typeof completeCatalog>) => {
				first(
					(first(catalog.convex) as ReturnType<typeof convexProduct>).media,
				).asset.derivatives.card.height += 2;
			},
		],
	] as const)("classifies a %s mismatch as dimensions only", (_name, mutate) => {
		const catalog = completeCatalog();
		mutate(catalog);
		expect(compareShopCatalogSentinel(catalog.sanity, catalog.convex)).toMatchObject({
			outcome: "mismatch",
			distribution: "exact",
			commerceParity: "match",
			presentationParity: "mismatch",
			presentationMismatchCounts: {
				...noPresentationMismatches,
				dimensions: 1,
			},
			associationParity: "match",
			productIndexOrder: "match",
			printSetOrder: "match",
		});
	});

	it("accepts provider-authoritative adjacent-pixel derivative heights and rejects wider drift", () => {
		const catalog = completeCatalog();
		const sanity = first(catalog.sanity) as ReturnType<typeof sanityProduct>;
		sanity.image.source = { width: 1600, height: 1074 };
		const asset = first((first(catalog.convex) as ReturnType<typeof convexProduct>).media).asset;
		resizeConvexAsset(asset, 1600, 1074);
		asset.derivatives.thumb.height = 214;
		asset.derivatives.card.height = 515;

		expect(compareShopCatalogSentinel(catalog.sanity, catalog.convex)).toMatchObject({
			outcome: "exact",
			presentationParity: "match",
			presentationMismatchCounts: noPresentationMismatches,
		});

		asset.derivatives.card.height = 514;
		expect(compareShopCatalogSentinel(catalog.sanity, catalog.convex)).toMatchObject({
			outcome: "mismatch",
			presentationParity: "mismatch",
			presentationMismatchCounts: {
				...noPresentationMismatches,
				dimensions: 1,
			},
		});
	});

	it("accepts only an exact committed receipt binding for a transferred source dimension", () => {
		const { catalog } = receiptBoundDimensionCatalog();
		const result = compareShopCatalogSentinel(catalog.sanity, catalog.convex);
		expect(result).toMatchObject({
			outcome: "exact",
			distribution: "exact",
			publicAdapterValidation: "exact",
			commerceParity: "match",
			presentationParity: "match",
			presentationMismatchCounts: noPresentationMismatches,
			transferEquivalentDimensionCount: 1,
			associationParity: "match",
			productIndexOrder: "match",
			printSetOrder: "match",
		});
		const serialized = JSON.stringify(result);
		expect(serialized).not.toContain(transferBoundSanityRef);
		expect(serialized).not.toContain(transferBoundReceipt.workerAssetId);
		expect(serialized).not.toContain(transferBoundReceipt.sourceSha256);
	});

	it("reports the four reviewed receipt-equivalent dimension differences as a bounded count", () => {
		const { catalog } = receiptBoundDimensionCatalog(4);
		expect(compareShopCatalogSentinel(catalog.sanity, catalog.convex)).toMatchObject({
			outcome: "exact",
			presentationParity: "match",
			presentationMismatchCounts: noPresentationMismatches,
			transferEquivalentDimensionCount: 4,
		});
	});

	it("keeps a transferred dimension difference blocking for a wrong Sanity asset reference", () => {
		const { catalog, sanityImage } = receiptBoundDimensionCatalog();
		sanityImage.assetRef = "image-19eedd3c081d2658351f849c519e519d1f7d99af-3000x4000-jpg";
		expect(compareShopCatalogSentinel(catalog.sanity, catalog.convex)).toMatchObject({
			outcome: "mismatch",
			presentationParity: "mismatch",
			presentationMismatchCounts: {
				...noPresentationMismatches,
				dimensions: 1,
			},
			transferEquivalentDimensionCount: 0,
		});
	});

	it("keeps a transferred dimension difference blocking for a wrong Worker asset ID", () => {
		const { catalog, convexAsset: asset } = receiptBoundDimensionCatalog();
		asset.assetId = "10000000-0000-4000-8000-000000000001";
		expect(compareShopCatalogSentinel(catalog.sanity, catalog.convex)).toMatchObject({
			outcome: "mismatch",
			publicAdapterValidation: "exact",
			presentationParity: "mismatch",
			presentationMismatchCounts: {
				...noPresentationMismatches,
				dimensions: 1,
			},
			transferEquivalentDimensionCount: 0,
		});
	});

	it("keeps a transferred dimension difference blocking for wrong receipt dimensions", () => {
		const { catalog } = receiptBoundDimensionCatalog();
		const receipts = structuredClone(transferReceipts);
		receipts.receipts[transferBoundSanityRef].source.width -= 1;
		expect(compareShopCatalogSentinel(catalog.sanity, catalog.convex, receipts)).toMatchObject({
			outcome: "mismatch",
			presentationParity: "mismatch",
			presentationMismatchCounts: {
				...noPresentationMismatches,
				dimensions: 1,
			},
			transferEquivalentDimensionCount: 0,
		});
	});

	it.each([
		["missing root", {}],
		["wrong schema", { ...structuredClone(transferReceipts), schemaVersion: 1 }],
		[
			"wrong derived content metadata",
			(() => {
				const receipts = structuredClone(transferReceipts);
				receipts.receipts[transferBoundSanityRef].source.contentType = "image/png";
				return receipts;
			})(),
		],
	] as const)("fails closed on a malformed transfer receipt manifest: %s", (_name, receipts) => {
		const { catalog } = receiptBoundDimensionCatalog();
		expect(compareShopCatalogSentinel(catalog.sanity, catalog.convex, receipts)).toMatchObject({
			outcome: "mismatch",
			presentationParity: "mismatch",
			presentationMismatchCounts: {
				...noPresentationMismatches,
				dimensions: 1,
			},
			transferEquivalentDimensionCount: 0,
		});
	});

	it("caps identifier-free presentation mismatch counts at the reviewed catalog size", () => {
		const sanity: unknown[] = [];
		const convex: unknown[] = [];
		for (let index = 0; index < 40; index += 1) {
			const productSlug = `bounded-${index}`;
			sanity.push({ ...sanityProduct(), slug: productSlug });
			const product = convexProduct();
			product.slug = productSlug;
			first(product.media).altText = "Different alt";
			convex.push(product);
		}
		expect(compareShopCatalogSentinel(sanity, convex).presentationMismatchCounts).toEqual({
			...noPresentationMismatches,
			altText: 33,
		});
	});

	it("normalizes provider CDN identity while detecting media role, order, alt, and source-dimension drift", () => {
		const catalog = completeCatalog();
		const media = first((first(catalog.convex) as ReturnType<typeof convexProduct>).media);
		media.asset.assetId = "20000000-0000-4000-8000-000000000002";
		expect(compareShopCatalogSentinel(catalog.sanity, catalog.convex)).toMatchObject({
			outcome: "exact",
			presentationParity: "match",
			presentationMismatchCounts: noPresentationMismatches,
		});

		media.order = 1;
		expect(compareShopCatalogSentinel(catalog.sanity, catalog.convex)).toMatchObject({
			outcome: "mismatch",
			presentationParity: "mismatch",
			presentationMismatchCounts: {
				...noPresentationMismatches,
				mediaStructure: 1,
			},
		});

		const malformed = completeCatalog();
		first(
			(first(malformed.convex) as ReturnType<typeof convexProduct>).media,
		).asset.derivatives.card.contentType = "image/avif";
		expect(compareShopCatalogSentinel(malformed.sanity, malformed.convex)).toMatchObject({
			outcome: "mismatch",
			presentationParity: "mismatch",
			presentationMismatchCounts: {
				...noPresentationMismatches,
				mediaStructure: 1,
			},
		});
	});

	it("keeps every classification independent when another facet cannot normalize", () => {
		const distribution = completeCatalog();
		distribution.sanity.push({ ...sanityProduct(), slug: "overflow" });
		distribution.convex.push({ ...convexProduct(), slug: "overflow" });
		expect(compareShopCatalogSentinel(distribution.sanity, distribution.convex)).toMatchObject({
			outcome: "mismatch",
			distribution: "mismatch",
			commerceParity: "match",
			presentationParity: "match",
			associationParity: "match",
			productIndexOrder: "match",
			printSetOrder: "match",
		});

		const commerce = completeCatalog();
		first((first(commerce.convex) as ReturnType<typeof convexProduct>).variants).retailPriceCents +=
			1;
		expect(compareShopCatalogSentinel(commerce.sanity, commerce.convex)).toMatchObject({
			outcome: "mismatch",
			distribution: "exact",
			commerceParity: "mismatch",
			presentationParity: "match",
			associationParity: "match",
			productIndexOrder: "match",
			printSetOrder: "match",
		});

		const presentation = completeCatalog();
		first(
			(first(presentation.convex) as ReturnType<typeof convexProduct>).media,
		).asset.derivatives.card.contentType = "image/avif";
		expect(compareShopCatalogSentinel(presentation.sanity, presentation.convex)).toMatchObject({
			outcome: "mismatch",
			distribution: "exact",
			commerceParity: "match",
			presentationParity: "mismatch",
			associationParity: "match",
			productIndexOrder: "match",
			printSetOrder: "match",
		});

		const association = completeCatalog();
		(first(association.sanity) as { hasCollection: unknown }).hasCollection = "malformed";
		expect(compareShopCatalogSentinel(association.sanity, association.convex)).toMatchObject({
			outcome: "mismatch",
			distribution: "exact",
			commerceParity: "match",
			presentationParity: "match",
			associationParity: "mismatch",
			productIndexOrder: "match",
			printSetOrder: "match",
		});
	});

	it.each([
		[
			"schema version",
			(product: Record<string, unknown>) => {
				product.schemaVersion = 1;
			},
		],
		[
			"currency",
			(product: Record<string, unknown>) => {
				product.currency = "eur";
			},
		],
		[
			"product identifier",
			(product: Record<string, unknown>) => {
				product.productId = "invalid identifier";
			},
		],
		[
			"variant key",
			(product: Record<string, unknown>) => {
				first(product.variants as Array<Record<string, unknown>>).key = "invalid key";
			},
		],
		[
			"media key",
			(product: Record<string, unknown>) => {
				first(product.media as Array<Record<string, unknown>>).key = "invalid key";
			},
		],
	] as const)("rejects malformed Convex public-adapter %s independently", (_name, mutate) => {
		const catalog = completeCatalog();
		mutate(first(catalog.convex) as Record<string, unknown>);
		expect(compareShopCatalogSentinel(catalog.sanity, catalog.convex)).toMatchObject({
			outcome: "mismatch",
			distribution: "exact",
			publicAdapterValidation: "mismatch",
			commerceParity: "match",
			presentationParity: "match",
			presentationMismatchCounts: noPresentationMismatches,
			associationParity: "match",
			productIndexOrder: "match",
			printSetOrder: "match",
		});
	});

	it("fails association parity when a Sanity product or set still references a collection", () => {
		const catalog = completeCatalog();
		(first(catalog.sanity) as { hasCollection: boolean }).hasCollection = true;
		expect(compareShopCatalogSentinel(catalog.sanity, catalog.convex)).toMatchObject({
			outcome: "mismatch",
			associationParity: "mismatch",
		});
	});

	it("detects derived product index order and provider-specific print-set order independently", () => {
		const ranked = completeCatalog();
		const general = [...ranked.convex]
			.reverse()
			.find(
				(value) => (value as { productKind?: string }).productKind === "tapestry",
			) as ReturnType<typeof convexProduct>;
		general.shopPlacement.orderRank = "a";
		expect(compareShopCatalogSentinel(ranked.sanity, ranked.convex)).toMatchObject({
			outcome: "mismatch",
			productIndexOrder: "mismatch",
		});

		const reordered = completeCatalog();
		const setIndexes = reordered.convex.flatMap((value, index) =>
			(value as { productKind?: string }).productKind === "print_set" ? [index] : [],
		);
		const [left, right] = setIndexes;
		if (left === undefined || right === undefined) throw new Error("Print-set fixtures missing");
		[reordered.convex[left], reordered.convex[right]] = [
			reordered.convex[right] as object,
			reordered.convex[left] as object,
		];
		expect(compareShopCatalogSentinel(reordered.sanity, reordered.convex)).toMatchObject({
			outcome: "mismatch",
			printSetOrder: "mismatch",
		});
	});

	it("classifies partial, overflow, wrong-distribution, and malformed catalogs as mismatch", () => {
		for (const mutate of [
			(catalog: ReturnType<typeof completeCatalog>) => catalog.sanity.pop(),
			(catalog: ReturnType<typeof completeCatalog>) =>
				catalog.convex.push({ ...convexProduct(), slug: "overflow" }),
			(catalog: ReturnType<typeof completeCatalog>) => {
				(first(catalog.convex) as { productKind: string }).productKind = "tapestry";
			},
			(catalog: ReturnType<typeof completeCatalog>) => {
				(first(catalog.sanity) as { title: unknown }).title = { raw: "private" };
			},
		]) {
			const catalog = completeCatalog();
			mutate(catalog);
			expect(compareShopCatalogSentinel(catalog.sanity, catalog.convex)).toMatchObject({
				outcome: "mismatch",
			});
		}
	});

	it("requires explicit Sanity stock visibility and preserves an explicit unavailable match", () => {
		for (const value of [undefined, null]) {
			const catalog = completeCatalog();
			(first(catalog.sanity) as { inStock?: unknown }).inStock = value;
			expect(compareShopCatalogSentinel(catalog.sanity, catalog.convex)).toMatchObject({
				outcome: "mismatch",
				distribution: "exact",
				commerceParity: "mismatch",
				presentationParity: "match",
				associationParity: "match",
				productIndexOrder: "mismatch",
				printSetOrder: "match",
			});
		}

		const unavailable = completeCatalog();
		(first(unavailable.sanity) as { inStock: boolean }).inStock = false;
		(first(unavailable.convex) as { saleAvailability: string }).saleAvailability = "unavailable";
		expect(compareShopCatalogSentinel(unavailable.sanity, unavailable.convex)).toMatchObject({
			outcome: "exact",
			distribution: "exact",
			productIndexOrder: "match",
		});
	});

	it("runs one fresh bounded pair of reads and suppresses raw failures", async () => {
		const catalog = completeCatalog();
		const fetchSanityCatalog = vi.fn(async (_signal: AbortSignal) => catalog.sanity);
		const reader = fakeReader(Promise.resolve(catalog.convex));
		await expect(
			readShopCatalogSentinel({
				fetchSanityCatalog,
				createReader: () => reader as never,
			}),
		).resolves.toMatchObject({ outcome: "exact", sanityCount: 33, convexCount: 33 });
		expect(fetchSanityCatalog).toHaveBeenCalledOnce();
		expect(reader.listPublished).toHaveBeenCalledOnce();

		await expect(
			readShopCatalogSentinel({
				fetchSanityCatalog: async () => {
					throw new Error("raw secret private-id hostile stack");
				},
				createReader: () => reader as never,
			}),
		).resolves.toEqual({
			outcome: "unavailable",
			sanityCount: null,
			convexCount: 33,
			distribution: "unavailable",
			publicAdapterValidation: "unavailable",
			commerceParity: "unavailable",
			presentationParity: "unavailable",
			presentationMismatchCounts: null,
			sanityPrintSetCoverFallbackCount: null,
			transferEquivalentDimensionCount: null,
			associationParity: "unavailable",
			productIndexOrder: "unavailable",
			printSetOrder: "unavailable",
		});
	});

	it("requests a fresh published Sanity projection only for the diagnostic", async () => {
		const catalog = completeCatalog();
		const fetch = vi.fn(
			async (
				_query: string,
				_params?: Record<string, unknown>,
				_options?: { perspective?: string; signal?: AbortSignal },
			) => catalog.sanity,
		);
		getFreshPublishedSanityClient.mockReturnValue({ fetch });
		await expect(
			readShopCatalogSentinel({
				createReader: () => fakeReader(Promise.resolve(catalog.convex)) as never,
			}),
		).resolves.toMatchObject({ outcome: "exact" });
		expect(getFreshPublishedSanityClient).toHaveBeenCalledOnce();
		expect(getSanityClient).not.toHaveBeenCalled();
		expect(fetch).toHaveBeenCalledOnce();
		const [query, params, options] = first(fetch.mock.calls);
		expect(query).toContain('"assetRef":asset._ref');
		expect(query.match(/"assetRef":asset\._ref/g)).toHaveLength(4);
		expect(params).toEqual({});
		expect(options).toEqual({
			perspective: "published",
			signal: expect.any(AbortSignal),
		});
	});

	it("aborts and returns unavailable at the hard top-level deadline", async () => {
		vi.useFakeTimers();
		let sanitySignal: AbortSignal | undefined;
		let convexSignal: AbortSignal | undefined;
		const pending = new Promise<never>(() => undefined);
		const result = readShopCatalogSentinel({
			fetchSanityCatalog: (signal) => {
				sanitySignal = signal;
				return pending;
			},
			createReader: () => ({
				listPublished: (signal: AbortSignal) => {
					convexSignal = signal;
					return pending;
				},
			}),
			deadlineMs: 25,
		});
		await vi.advanceTimersByTimeAsync(25);
		await expect(result).resolves.toMatchObject({ outcome: "unavailable" });
		expect(sanitySignal?.aborted).toBe(true);
		expect(convexSignal?.aborted).toBe(true);
	});
});

describe("Shop index shadow", () => {
	it("keeps the runtime shadow comparison on the existing published client selector", async () => {
		const catalog = completeCatalog();
		const fetch = vi.fn(
			async (
				_query: string,
				_params?: Record<string, unknown>,
				_options?: { signal?: AbortSignal },
			) => catalog.sanity,
		);
		getSanityClient.mockReturnValue({ fetch });
		const provider = createCatalogShopProvider({
			sanity: fakeSanity() as never,
			mode: () => "shadow",
			createReader: (() => fakeReader(Promise.resolve(catalog.convex))) as never,
		});

		await expect(provider.loadIndex(false)).resolves.toEqual({ route: "sanity" });
		expect(getSanityClient).toHaveBeenCalledOnce();
		expect(getSanityClient).toHaveBeenCalledWith(false);
		expect(getFreshPublishedSanityClient).not.toHaveBeenCalled();
		expect(fetch).toHaveBeenCalledOnce();
		expect(first(fetch.mock.calls)[2]).toEqual({ signal: expect.any(AbortSignal) });
	});

	it("starts the exact Sanity primary and one complete comparison concurrently and emits no match log", async () => {
		const output = { exact: "Sanity route result" };
		const catalog = completeCatalog();
		const primary = deferred<unknown>();
		const secondary = deferred<unknown>();
		const sanity = fakeSanity(primary.promise);
		const reader = fakeReader(secondary.promise);
		const createReader = vi.fn(() => reader);
		const fetchSanityCatalog = vi.fn(async () => catalog.sanity);
		const log = vi.fn();
		const provider = createCatalogShopProvider({
			sanity: sanity as never,
			mode: () => "shadow",
			createReader: createReader as never,
			fetchSanityCatalog,
			log,
		});

		const load = provider.loadIndex(false);
		await Promise.resolve();
		expect(sanity.loadIndex).toHaveBeenCalledWith(false);
		expect(fetchSanityCatalog).toHaveBeenCalledOnce();
		expect(createReader).toHaveBeenCalledOnce();
		expect(reader.listPublished).toHaveBeenCalledOnce();
		secondary.resolve(catalog.convex);
		primary.resolve(output);
		await expect(load).resolves.toBe(output);
		expect(log).not.toHaveBeenCalled();
	});

	it("returns Sanity on mismatch and emits one closed whitelisted warning", async () => {
		const output = { exact: "Sanity" };
		const catalog = completeCatalog();
		const convex = first(catalog.convex) as ReturnType<typeof convexProduct>;
		first(convex.variants).retailPriceCents += 1;
		const log = vi.fn();
		const now = vi.fn().mockReturnValueOnce(0).mockReturnValue(10_000);
		const provider = createCatalogShopProvider({
			sanity: fakeSanity(Promise.resolve(output)) as never,
			mode: () => "shadow",
			fetchSanityCatalog: async () => catalog.sanity,
			createReader: (() => fakeReader(Promise.resolve(catalog.convex))) as never,
			log,
			now,
		});

		await expect(provider.loadIndex(false)).resolves.toBe(output);
		expect(log).toHaveBeenCalledOnce();
		expect(log).toHaveBeenCalledWith({
			event: "catalog.shadow_closed",
			level: "warn",
			durationMs: 750,
			meta: {
				state: "closed",
				site: "angelsrest.online",
				reason: "mismatch",
				primaryCount: 33,
				secondaryCount: 33,
			},
		});
	});

	it.each([
		["secondary_error", () => Promise.reject(new Error("token secret slug private-id stack"))],
		["normalization_error", () => Promise.resolve([{ ...convexProduct(), currency: "eur" }])],
	] as const)("closes %s without leaking hostile evidence", async (reason, list) => {
		const log = vi.fn();
		const provider = createCatalogShopProvider({
			sanity: fakeSanity() as never,
			mode: () => "shadow",
			fetchSanityCatalog: async () => [sanityProduct()],
			createReader: (() => fakeReader(list())) as never,
			log,
		});

		await provider.loadIndex(false);
		expect(log).toHaveBeenCalledOnce();
		const evidence = JSON.stringify(log.mock.calls[0]);
		expect(evidence).toContain(reason);
		expect(evidence).not.toMatch(/token secret|private-id|stack|hostile|slug/i);
	});

	it.each([
		["empty", [], []],
		["partial", [sanityProduct()], [convexProduct()]],
	] as const)("reports an %s catalog as normalization_error", async (_name, sanity, convex) => {
		const log = vi.fn();
		const provider = createCatalogShopProvider({
			sanity: fakeSanity() as never,
			mode: () => "shadow",
			fetchSanityCatalog: async () => sanity,
			createReader: (() => fakeReader(Promise.resolve(convex))) as never,
			log,
		});

		await provider.loadIndex(false);
		expect(log).toHaveBeenCalledOnce();
		expect(log.mock.calls[0]?.[0]).toMatchObject({
			meta: {
				reason: "normalization_error",
				primaryCount: sanity.length,
				secondaryCount: convex.length,
			},
		});
	});

	it("bounds and aborts the secondary, consumes late rejection, and logs only once", async () => {
		vi.useFakeTimers();
		const late = deferred<unknown>();
		let signal: AbortSignal | undefined;
		const reader = fakeReader(late.promise);
		reader.listPublished.mockImplementation((value) => {
			signal = value;
			return late.promise;
		});
		const log = vi.fn();
		const provider = createCatalogShopProvider({
			sanity: fakeSanity() as never,
			mode: () => "shadow",
			fetchSanityCatalog: async () => [sanityProduct()],
			createReader: (() => reader) as never,
			deadlineMs: 25,
			log,
			now: () => 1_000,
		});

		const load = provider.loadIndex(false);
		await vi.advanceTimersByTimeAsync(25);
		await expect(load).resolves.toEqual({ route: "sanity" });
		expect(signal?.aborted).toBe(true);
		expect(log).toHaveBeenCalledOnce();
		expect(log.mock.calls[0]?.[0]).toMatchObject({
			durationMs: 0,
			meta: { reason: "timeout", primaryCount: null, secondaryCount: null },
		});

		late.reject(new Error("late hostile rejection"));
		await Promise.resolve();
		await Promise.resolve();
		expect(log).toHaveBeenCalledOnce();
	});

	it.each([
		"Sanity",
		"Convex",
	] as const)("keeps the deadline active when %s rejects while its peer hangs", async (rejectedBranch) => {
		vi.useFakeTimers();
		const late = deferred<unknown>();
		let signal: AbortSignal | undefined;
		const reader = fakeReader(Promise.resolve([]));
		reader.listPublished.mockImplementation((value) => {
			if (rejectedBranch === "Convex") return Promise.reject(new Error("closed"));
			signal = value;
			return late.promise;
		});
		const fetchSanityCatalog = vi.fn((value: AbortSignal) => {
			if (rejectedBranch === "Sanity") return Promise.reject(new Error("closed"));
			signal = value;
			return late.promise;
		});
		const log = vi.fn();
		const provider = createCatalogShopProvider({
			sanity: fakeSanity() as never,
			mode: () => "shadow",
			fetchSanityCatalog,
			createReader: (() => reader) as never,
			deadlineMs: 25,
			log,
		});

		const load = provider.loadIndex(false);
		let completed = false;
		void load.then(() => {
			completed = true;
		});
		await vi.advanceTimersByTimeAsync(24);
		expect(completed).toBe(false);
		await vi.advanceTimersByTimeAsync(1);
		await expect(load).resolves.toEqual({ route: "sanity" });
		expect(signal?.aborted).toBe(true);
		expect(log.mock.calls[0]?.[0]).toMatchObject({ meta: { reason: "timeout" } });
		late.reject(new Error("consumed late rejection"));
		await Promise.resolve();
	});

	it.each([
		"construction",
		"query",
	] as const)("bounds and consumes a synchronous reader %s failure with a hanging peer", async (failurePoint) => {
		vi.useFakeTimers();
		const late = deferred<unknown>();
		let signal: AbortSignal | undefined;
		const createReader = () => {
			if (failurePoint === "construction") throw new Error("closed");
			return {
				listPublished: () => {
					throw new Error("closed");
				},
			};
		};
		const log = vi.fn();
		const provider = createCatalogShopProvider({
			sanity: fakeSanity() as never,
			mode: () => "shadow",
			fetchSanityCatalog: (value) => {
				signal = value;
				return late.promise;
			},
			createReader: createReader as never,
			deadlineMs: 25,
			log,
		});

		const load = provider.loadIndex(false);
		await vi.advanceTimersByTimeAsync(25);
		await expect(load).resolves.toEqual({ route: "sanity" });
		expect(signal?.aborted).toBe(true);
		expect(log.mock.calls[0]?.[0]).toMatchObject({ meta: { reason: "timeout" } });
		late.reject(new Error("consumed late rejection"));
		await Promise.resolve();
	});

	it("preserves primary rejection and aborts the comparison without warning", async () => {
		const failure = new Error("primary failure");
		let signal: AbortSignal | undefined;
		const late = deferred<unknown>();
		const reader = fakeReader(late.promise);
		reader.listPublished.mockImplementation((value) => {
			signal = value;
			return late.promise;
		});
		const log = vi.fn();
		const provider = createCatalogShopProvider({
			sanity: fakeSanity(Promise.reject(failure)) as never,
			mode: () => "shadow",
			fetchSanityCatalog: async () => [sanityProduct()],
			createReader: (() => reader) as never,
			log,
		});

		await expect(provider.loadIndex(false)).rejects.toBe(failure);
		expect(signal?.aborted).toBe(true);
		expect(log).not.toHaveBeenCalled();
		late.reject(new Error("consumed after primary failure"));
		await Promise.resolve();
	});
});

describe("provider route ownership", () => {
	it("keeps shadow details and every collection read on exact Sanity", async () => {
		const sanity = fakeSanity();
		const createReader = vi.fn();
		const fetchSanityCatalog = vi.fn();
		const provider = createCatalogShopProvider({
			sanity: sanity as never,
			mode: () => "shadow",
			createReader,
			fetchSanityCatalog,
		});

		await provider.loadProduct("product", false);
		await provider.loadPrintSet("set", false);
		await provider.loadCollection("collection", false);
		expect(createReader).not.toHaveBeenCalled();
		expect(fetchSanityCatalog).not.toHaveBeenCalled();
		expect(sanity.loadCollection).toHaveBeenCalledWith("collection", false);
	});

	it("keeps absent, malformed, and explicit Sanity detail modes off Convex", async () => {
		for (const value of [undefined, "", "invalid", "sanity"]) {
			const sanity = fakeSanity();
			const createReader = vi.fn();
			const provider = createCatalogShopProvider({
				sanity: sanity as never,
				mode: () => value,
				createReader,
			});
			await provider.loadIndex(false);
			await provider.loadProduct("product", false);
			await provider.loadPrintSet("set", false);
			expect(createReader).not.toHaveBeenCalled();
		}
	});
});
