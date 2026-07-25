import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("$env/dynamic/private", () => ({ env: {} }));
vi.mock("$env/dynamic/public", () => ({ env: { PUBLIC_CONVEX_URL: "https://convex.test" } }));
vi.mock("$lib/sanity/client.server", () => ({ getSanityClient: vi.fn() }));
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
	createCatalogShopProvider,
	parseCatalogProviderMode,
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
	inStock: true,
	featured: true,
	variants: [
		{ paper: "archival-matte", size: "8x10", retailPrice: 42, enabled: true },
		{ paper: "glossy", size: "11x14", retailPrice: 50, enabled: false },
	],
	bordersEnabled: true,
	framedEnabled: false,
	frameMarkupMultiplier: 2,
	image: { source: { width: 3000, height: 2000 } },
});

const convexProduct = () => ({
	schemaVersion: 2 as const,
	productId: "product-private-looking",
	revisionId: "revision-private-looking",
	productKind: "print" as "print" | "print_set",
	title: "Ignored copy",
	slug: "archival-print",
	description: "Ignored description",
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
			altText: "Ignored alt",
			asset: {
				assetId: "ignored-asset-id",
				source: { height: 2000, width: 3000 },
				derivatives: { display1280: { url: "https://ignored.test/image" } },
			},
		},
	],
});

function fakeSanity(index: Promise<unknown> = Promise.resolve({ route: "sanity" })) {
	return {
		loadIndex: vi.fn(() => index),
		loadProduct: vi.fn(async (slug: string, preview: boolean) => ({ slug, preview })),
		loadPrintSet: vi.fn(async (slug: string, preview: boolean) => ({ slug, preview })),
		loadCollection: vi.fn(async (slug: string, preview: boolean) => ({ slug, preview })),
	};
}

function fakeReader(list: Promise<unknown>, detail: Promise<unknown> = Promise.resolve(null)) {
	return {
		listPublished: vi.fn((_signal: AbortSignal) => list),
		getPublishedBySlug: vi.fn((_slug: string, _signal: AbortSignal) => detail),
	};
}

afterEach(() => {
	vi.useRealTimers();
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
		expect(sanity.loadIndex).toHaveBeenCalledWith(true);
		expect(sanity.loadProduct).toHaveBeenCalledWith("preview", true);
		expect(mode).not.toHaveBeenCalled();
		expect(createReader).not.toHaveBeenCalled();
		expect(timer).not.toHaveBeenCalled();
	});
});

describe("catalog semantic comparison", () => {
	it("matches by ordinal slug with fixed-key semantics rather than object key order", () => {
		expect(compareCatalogSemantics([sanityProduct()], [convexProduct()])).toEqual({
			primaryCount: 1,
			secondaryCount: 1,
		});
	});

	it.each([
		[
			"kind",
			(value: ReturnType<typeof convexProduct>) => {
				value.productKind = "print_set";
			},
		],
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
				first(value.variants).materialOption.slug = "glossy";
			},
		],
		[
			"size dimensions",
			(value: ReturnType<typeof convexProduct>) => {
				first(value.variants).sizeOption.widthInches = 9;
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
				first(value.media).role = "gallery";
			},
		],
		[
			"media order",
			(value: ReturnType<typeof convexProduct>) => {
				first(value.media).order = 1;
			},
		],
		[
			"source dimensions",
			(value: ReturnType<typeof convexProduct>) => {
				first(value.media).asset.source.width += 1;
			},
		],
	] as const)("detects a %s perturbation", (_name, mutate) => {
		const convex = convexProduct();
		mutate(convex);
		const outcome = compareCatalogSemantics([sanityProduct()], [convex]);
		expect(outcome).toEqual({ reason: "mismatch", primaryCount: 1, secondaryCount: 1 });
	});

	it("uses the import-authority mappings for sets and all four supported V1 categories", () => {
		const dimensions = { source: { width: 3000, height: 2000 } };
		const mappings = [
			["postcards", "postcard"],
			["tapestries", "tapestry"],
			["digital", "digital_download"],
			["merchandise", "merchandise"],
		] as const;
		const sanity = mappings.map(([category]) => ({
			_type: "product",
			slug: category,
			category,
			price: 10,
			availablePapers: [],
			images: [dimensions],
		}));
		const convex = mappings.map(([category, kind]) => {
			const value = convexProduct() as unknown as Record<string, unknown>;
			value.productKind = kind;
			value.slug = category;
			value.variants = [
				{
					order: 0,
					materialOption: null,
					sizeOption: null,
					retailPriceCents: 1000,
				},
			];
			value.shopPlacement = { featured: false, orderRank: null };
			value.media = [{ role: "gallery", order: 0, asset: dimensions }];
			delete value.printOptions;
			return value;
		});
		expect(compareCatalogSemantics(sanity, convex).reason).toBeUndefined();

		const set = {
			...sanityProduct(),
			_type: "lumaPrintSetV2",
			slug: "set",
			previewImage: dimensions,
			images: [dimensions],
		};
		const convexSet = convexProduct();
		convexSet.productKind = "print_set";
		convexSet.slug = "set";
		convexSet.media = [
			{ ...first(convexSet.media), role: "cover" },
			{ ...first(convexSet.media), role: "set_member", order: 0 },
		];
		expect(compareCatalogSemantics([set], [convexSet]).reason).toBeUndefined();
	});

	it("ignores forbidden copy, alt, URL, IDs, cost, provider, and raw fields", () => {
		const convex = convexProduct() as ReturnType<typeof convexProduct> & Record<string, unknown>;
		Object.assign(convex, {
			title: "Hostile title",
			description: "Hostile copy",
			provider: "hostile-provider",
			cost: 999,
			raw: { token: "secret" },
		});
		Object.assign(first(convex.media), {
			altText: "Hostile alt",
			url: "https://hostile.test/private",
			key: "hostile-id",
		});
		expect(compareCatalogSemantics([sanityProduct()], [convex]).reason).toBeUndefined();
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
		const available = sanityProduct();
		delete (available as Partial<typeof available>).inStock;
		const unavailable = { ...sanityProduct(), slug: "unavailable", inStock: false };
		const first = convexProduct();
		const second = structuredClone(first);
		second.slug = "unavailable";
		second.saleAvailability = "unavailable";
		expect(compareCatalogSemantics([unavailable, available], [second, first])).toEqual({
			primaryCount: 2,
			secondaryCount: 2,
		});
	});
});

describe("Shop index shadow", () => {
	it("starts the exact Sanity primary and one complete comparison concurrently and emits no match log", async () => {
		const output = { exact: "Sanity route result" };
		const primary = deferred<unknown>();
		const secondary = deferred<unknown>();
		const sanity = fakeSanity(primary.promise);
		const reader = fakeReader(secondary.promise);
		const createReader = vi.fn(() => reader);
		const fetchSanityCatalog = vi.fn(async () => [sanityProduct()]);
		const log = vi.fn();
		const provider = createCatalogShopProvider({
			sanity: sanity as never,
			mode: () => "shadow",
			createReader: createReader as never,
			fetchSanityCatalog,
			log,
		});

		const load = provider.loadIndex(false);
		expect(sanity.loadIndex).toHaveBeenCalledWith(false);
		expect(fetchSanityCatalog).toHaveBeenCalledOnce();
		expect(createReader).toHaveBeenCalledOnce();
		expect(reader.listPublished).toHaveBeenCalledOnce();
		secondary.resolve([convexProduct()]);
		primary.resolve(output);
		await expect(load).resolves.toBe(output);
		expect(log).not.toHaveBeenCalled();
	});

	it("returns Sanity on mismatch and emits one closed whitelisted warning", async () => {
		const output = { exact: "Sanity" };
		const convex = convexProduct();
		first(convex.variants).retailPriceCents += 1;
		const log = vi.fn();
		const now = vi.fn().mockReturnValueOnce(0).mockReturnValue(10_000);
		const provider = createCatalogShopProvider({
			sanity: fakeSanity(Promise.resolve(output)) as never,
			mode: () => "shadow",
			fetchSanityCatalog: async () => [sanityProduct()],
			createReader: (() => fakeReader(Promise.resolve([convex]))) as never,
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
				primaryCount: 1,
				secondaryCount: 1,
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

describe("dormant Convex seam and Sanity-only routes", () => {
	it("keeps shadow details and all collection reads on exact Sanity without comparisons", async () => {
		const sanity = fakeSanity();
		const createReader = vi.fn();
		const fetchSanityCatalog = vi.fn();
		const provider = createCatalogShopProvider({
			sanity: sanity as never,
			mode: () => "shadow",
			createReader,
			fetchSanityCatalog,
		});

		await expect(provider.loadProduct("product", false)).resolves.toEqual({
			slug: "product",
			preview: false,
		});
		await expect(provider.loadPrintSet("set", false)).resolves.toEqual({
			slug: "set",
			preview: false,
		});
		await expect(provider.loadCollection("collection", false)).resolves.toEqual({
			slug: "collection",
			preview: false,
		});
		expect(createReader).not.toHaveBeenCalled();
		expect(fetchSanityCatalog).not.toHaveBeenCalled();
	});

	it("uses only CRM 2.29 public list/detail reads at the dormant convex seam", async () => {
		const list = [convexProduct()];
		const reader = fakeReader(Promise.resolve(list), Promise.resolve(null));
		const sanity = fakeSanity();
		const provider = createCatalogShopProvider({
			sanity: sanity as never,
			mode: () => "convex",
			createReader: (() => reader) as never,
		});

		await expect(provider.readConvexCatalog()).resolves.toBe(list);
		await expect(provider.readConvexCatalog("missing")).resolves.toBeNull();
		expect(reader.listPublished).toHaveBeenCalledOnce();
		expect(reader.getPublishedBySlug).toHaveBeenCalledWith("missing", expect.any(AbortSignal));
		expect(sanity.loadIndex).not.toHaveBeenCalled();

		const failure = new Error("public read unavailable");
		reader.getPublishedBySlug.mockRejectedValueOnce(failure);
		await expect(provider.readConvexCatalog("broken")).rejects.toBe(failure);
	});

	it("keeps dormant mode routes on Sanity because CRM has no collection or media-key contract", async () => {
		const output = { exact: "Sanity index" };
		const sanity = fakeSanity(Promise.resolve(output));
		const createReader = vi.fn();
		const provider = createCatalogShopProvider({
			sanity: sanity as never,
			mode: () => "convex",
			createReader,
		});

		await expect(provider.loadIndex(false)).resolves.toBe(output);
		await provider.loadProduct("product", false);
		await provider.loadPrintSet("set", false);
		await provider.loadCollection("collection", false);
		expect(createReader).not.toHaveBeenCalled();
	});
});
