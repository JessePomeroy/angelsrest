import { describe, expect, it, vi } from "vitest";
import type {
	CheckoutSelection,
	CheckoutSnapshotItem,
	ResolvedCheckoutItem,
} from "$lib/server/checkoutCatalog";
import {
	parseCheckoutCatalogProvider,
	resolveCheckoutCommerce as resolveCommerce,
} from "$lib/server/checkoutCommerce";

type Item = CheckoutSnapshotItem;
type Kind = Item["productKind"];
type Additions = Record<string, unknown>;
const primaryRole: Partial<Record<Kind, string>> = { print: "primary", print_set: "cover" };
const assetId = "123e4567-e89b-42d3-a456-426614174000";
const derivative = { contentType: "image/webp", width: 1280, height: 853 };
const media = (role: string, order = 0) => ({
	key: `${role}-${order}-media`,
	role,
	order,
	altText: "Public image",
	asset: {
		assetId,
		source: { width: 3000, height: 2000 },
		derivatives: Object.fromEntries(
			"thumb card display1280 display2048 display2560".split(" ").map((key) => [key, derivative]),
		),
	},
});
const printFinish = {
	materialKey: "archival-matte",
	sizeKey: "8x10",
	borderKey: "none",
	frameKey: "none",
	paper: { name: "Archival Matte", subcategoryId: 103001 },
	size: { label: "8 × 10", width: 8, height: 10 },
	border: { inches: 0 },
	frame: { subcategoryId: 0 },
	canvas: null,
};
const realCanvas = {
	color: "white",
	thickness: "1.25",
	subcategoryId: 101002,
	wrapOptionId: 3,
	wrapHex: "#FFFFFF",
};

function product(kind: Kind, slug = `${kind}-one`, material = "archival-matte") {
	const isPrint = kind === "print" || kind === "print_set";
	return {
		schemaVersion: 2,
		productId: `product-${kind}`,
		revisionId: `revision-${kind}`,
		productKind: kind,
		slug,
		saleAvailability: "available",
		variants: [
			{
				key: `variant-${kind}`,
				materialOption: isPrint ? { slug: material, label: "Material" } : null,
				sizeOption: isPrint ? { slug: "8x10", label: "8 × 10" } : null,
			},
		],
	};
}
function selection(kind: Kind, material = "archival-matte"): CheckoutSelection {
	const isPrint = kind === "print" || kind === "print_set";
	return {
		productId: `${kind}-one`,
		isPrintSet: kind === "print_set",
		paperSlug: isPrint ? material : undefined,
		sizeSlug: isPrint ? "8x10" : undefined,
	};
}
function response(item: Item, overrides: Additions = {}, slug = `${item.productKind}-one`) {
	const role = primaryRole[item.productKind] ?? "gallery";
	return {
		version: 1,
		purpose: "checkout",
		item,
		identity: {
			productId: item.productKey,
			revisionId: item.revisionId,
			productKind: item.productKind,
			title: `Trusted ${item.productKind}`,
			slug,
			variantKey: item.variantKey,
		},
		commerce: {
			currency: "usd",
			amountCents: 4200,
			finish:
				item.productKind === "print" || item.productKind === "print_set"
					? {
							...printFinish,
							borderKey: item.borderOptionKey,
							frameKey: item.frameOptionKey,
						}
					: null,
		},
		media: [media(role), ...(item.productKind === "print_set" ? [media("set_member")] : [])],
		...overrides,
	};
}
function sanityItem(kind: Kind = "print"): ResolvedCheckoutItem {
	const isPrint = kind === "print" || kind === "print_set";
	return {
		productId: `${kind}-one`,
		title: `Trusted ${kind}`,
		unitPriceCents: 4200,
		productCategory: kind,
		publicImage: "https://sanity.test/public.jpg",
		snapshot: null,
		legacyFulfillment: {
			isDigital: kind === "digital_download",
			isPrintSet: kind === "print_set",
			imageUrl: "https://sanity.test/public.jpg",
			imageUrls: kind === "print_set" ? ["https://sanity.test/member.jpg"] : [],
			paper: isPrint
				? { name: "Archival Matte", subcategoryId: 103001, width: 8, height: 10 }
				: null,
		},
	};
}
function canvasResponse(item: Item, canvas: unknown = realCanvas) {
	return response(item, {
		commerce: {
			currency: "usd",
			amountCents: 4200,
			finish: {
				...printFinish,
				materialKey: "canvas-white-1.25",
				borderKey: item.borderOptionKey,
				frameKey: item.frameOptionKey,
				paper: { name: 'Canvas White — 1.25" stretch', subcategoryId: 101002 },
				canvas,
			},
		},
	});
}
const canvasSelection = selection("print", "canvas-white-1.25");
const canvasProduct = product("print", "print-one", "canvas-white-1.25");
const fetcher = vi.fn();
function convexDependencies(kind: Kind, additions = {}) {
	return {
		provider: () => "convex",
		query: vi.fn().mockResolvedValue(product(kind)),
		resolve: vi.fn((item: CheckoutSnapshotItem) => Promise.resolve(response(item))),
		...additions,
	};
}
const resolveOne = (
	dependencies: NonNullable<Parameters<typeof resolveCommerce>[2]>,
	selected = selection("print"),
) => resolveCommerce(fetcher, [selected], dependencies);
function canvasAuthority(canvas: unknown = realCanvas) {
	return convexDependencies("print", {
		query: vi.fn().mockResolvedValue(canvasProduct),
		resolve: vi.fn((item: Item) => Promise.resolve(canvasResponse(item, canvas))),
	});
}

describe("checkout commerce provider", () => {
	it("strictly defaults every non-allowlisted provider to Sanity without constructing secondary work", async () => {
		for (const value of [undefined, null, "", "Convex", " convex", {}, 1]) {
			expect(parseCheckoutCatalogProvider(value)).toBe("sanity");
		}
		for (const value of ["sanity", "shadow", "convex"] as const) {
			expect(parseCheckoutCatalogProvider(value)).toBe(value);
		}
		const query = vi.fn();
		const resolve = vi.fn();
		const primary = sanityItem();
		await expect(
			resolveOne({
				provider: () => "invalid",
				resolveSanity: vi.fn().mockResolvedValue(primary),
				query,
				resolve,
			}),
		).resolves.toEqual({ provider: "sanity", items: [primary] });
		expect(query).not.toHaveBeenCalled();
		expect(resolve).not.toHaveBeenCalled();
	});
	it.each([
		"print",
		"print_set",
		"postcard",
		"tapestry",
		"digital_download",
		"merchandise",
	] as const)("maps authenticated authority for direct %s checkout and stores convex", async (kind) => {
		const dependencies = convexDependencies(kind);
		const result = await resolveOne(dependencies, selection(kind));
		expect(result.provider).toBe("convex");
		expect(result.items[0]).toMatchObject({
			title: `Trusted ${kind}`,
			unitPriceCents: 4200,
			publicImage: `https://media.angelsrest.online/sites/angelsrest.online/web/${assetId}/display-1280.webp`,
			legacyFulfillment: {
				isDigital: kind === "digital_download",
				isPrintSet: kind === "print_set",
			},
		});
		const requested = vi.mocked(dependencies.resolve).mock.calls[0]?.[0];
		expect(requested).toMatchObject({
			productKey: `product-${kind}`,
			revisionId: `revision-${kind}`,
			variantKey: `variant-${kind}`,
			materialOptionKey: kind === "print" || kind === "print_set" ? "archival-matte" : null,
		});
		expect(result.items[0]?.snapshot).toEqual(requested);
	});
	it("preserves null option identity and rejects selector, current tuple, echo, and result forgery", async () => {
		const nullOptions = convexDependencies("print");
		await resolveOne(nullOptions, { ...selection("print"), borderWidth: null, frame: null });
		expect(vi.mocked(nullOptions.resolve).mock.calls[0]?.[0]).toMatchObject({
			borderOptionKey: null,
			frameOptionKey: null,
		});
		const cases: Array<{
			select?: CheckoutSelection;
			query?: unknown;
			mutate?: (item: CheckoutSnapshotItem) => unknown;
		}> = [
			{ select: { ...selection("print"), paperSlug: "forged" } },
			{ query: { ...product("print"), slug: "wrong" } },
			{ mutate: (item) => response({ ...item, revisionId: "forged" }) },
			{ mutate: (item) => ({ ...response(item), identity: { title: "incomplete" } }) },
			{ mutate: (item) => ({ ...response(item), media: [media("gallery")] }) },
		];
		for (const candidate of cases) {
			const dependencies = convexDependencies("print", {
				query: vi.fn().mockResolvedValue(candidate.query ?? product("print")),
				resolve: vi.fn((item: CheckoutSnapshotItem) =>
					Promise.resolve(candidate.mutate ? candidate.mutate(item) : response(item)),
				),
			});
			await expect(resolveOne(dependencies, candidate.select)).rejects.toThrow(
				"Checkout catalog resolution failed",
			);
		}
	});
	it("accepts null and the real five-field canvas shape with clean shadow mapping", async () => {
		const paper = {
			name: 'Canvas White — 1.25" stretch',
			subcategoryId: 101002,
			width: 8,
			height: 10,
			canvasSubcategoryId: 101002,
			canvasWrapHex: "#FFFFFF",
		};
		await expect(resolveOne(canvasAuthority(null), canvasSelection)).resolves.toBeDefined();
		const authority = canvasAuthority();
		const result = await resolveOne(authority, canvasSelection);
		const resolve = authority.resolve;
		expect(result.items[0]?.legacyFulfillment.paper).toEqual(paper);
		expect(result.items[0]?.legacyFulfillment.paper).not.toHaveProperty("color");
		expect(result.items[0]?.legacyFulfillment.paper).not.toHaveProperty("wrapOptionId");

		const primary = {
			...sanityItem(),
			legacyFulfillment: { ...sanityItem().legacyFulfillment, paper },
		};
		const log = vi.fn();
		await resolveOne(
			{
				provider: () => "shadow",
				resolveSanity: vi.fn().mockResolvedValue(primary),
				query: vi.fn().mockResolvedValue(canvasProduct),
				resolve,
				log,
			},
			canvasSelection,
		);
		expect(log).not.toHaveBeenCalled();
	});

	it.each([
		["extra", { ...realCanvas, candidate: true }],
		["missing", { color: "white", thickness: "1.25", subcategoryId: 101002, wrapOptionId: 3 }],
		["color type", { ...realCanvas, color: 1 }],
		["color value", { ...realCanvas, color: "blue" }],
		["thickness type", { ...realCanvas, thickness: 1.25 }],
		["thickness bound", { ...realCanvas, thickness: "" }],
		["subcategory type", { ...realCanvas, subcategoryId: "101002" }],
		["subcategory bound", { ...realCanvas, subcategoryId: 0 }],
		["wrap option type", { ...realCanvas, wrapOptionId: "3" }],
		["wrap option bound", { ...realCanvas, wrapOptionId: 0 }],
		["wrap hex type", { ...realCanvas, wrapHex: 0 }],
		["wrap hex bound", { ...realCanvas, wrapHex: "#".repeat(21) }],
	])("rejects malformed canvas %s", async (_case, canvas) => {
		await expect(resolveOne(canvasAuthority(canvas), canvasSelection)).rejects.toThrow(
			"Checkout catalog resolution failed",
		);
	});

	it("accepts 50 media and 20 set members while rejecting a 21st member", async () => {
		const resolveWithMedia = (kind: Kind, entries: ReturnType<typeof media>[]) =>
			resolveOne(
				convexDependencies(kind, {
					resolve: vi.fn((item: CheckoutSnapshotItem) =>
						Promise.resolve(response(item, { media: entries })),
					),
				}),
				selection(kind),
			);
		const members = Array.from({ length: 20 }, (_, index) => media("set_member", index));
		const set = await resolveWithMedia("print_set", [media("cover"), ...members]);
		expect(set.items[0]?.legacyFulfillment.imageUrls).toHaveLength(20);
		const gallery = Array.from({ length: 50 }, (_, index) => media("gallery", index));
		await resolveWithMedia("merchandise", gallery);
		await expect(
			resolveWithMedia("print_set", [media("cover"), ...members, media("set_member", 20)]),
		).rejects.toThrow("Checkout catalog resolution failed");
	});
	it("fails unavailable and missing resolver authentication without a Sanity fallback", async () => {
		const sanity = vi.fn();
		const unavailable = convexDependencies("print", {
			resolve: vi.fn().mockRejectedValue(new Error("authoritative unavailable")),
			resolveSanity: sanity,
		});
		await expect(resolveOne(unavailable)).rejects.toThrow();
		expect(sanity).not.toHaveBeenCalled();
		await expect(
			resolveOne({
				provider: () => "convex",
				query: vi.fn().mockResolvedValue(product("print")),
				resolveSanity: sanity,
			}),
		).rejects.toMatchObject({ kind: "unavailable" });
		expect(sanity).not.toHaveBeenCalled();
	});
});

describe("checkout commerce shadow", () => {
	function shadow(additions: Additions = {}) {
		return {
			provider: () => "shadow",
			resolveSanity: vi.fn().mockResolvedValue(sanityItem()),
			query: vi.fn().mockResolvedValue(product("print")),
			resolve: vi.fn((item: CheckoutSnapshotItem) => Promise.resolve(response(item))),
			log: vi.fn(),
			...additions,
		};
	}

	it("emits nothing on a clean match and always returns/stores Sanity", async () => {
		const dependencies = shadow();
		await expect(resolveOne(dependencies)).resolves.toMatchObject({
			provider: "sanity",
			items: [{ publicImage: "https://sanity.test/public.jpg" }],
		});
		expect(dependencies.log).not.toHaveBeenCalled();
	});
	it.each([
		[
			"mismatch",
			{
				resolveSanity: vi.fn().mockResolvedValue(sanityItem("digital_download")),
				query: vi.fn().mockResolvedValue(product("merchandise", "digital_download-one")),
				resolve: vi.fn((item: CheckoutSnapshotItem) =>
					Promise.resolve(response(item, {}, "digital_download-one")),
				),
			},
		],
		[
			"secondary_error",
			{ resolve: vi.fn().mockRejectedValue(new Error("private raw secret id url")) },
		],
	] as const)("closes %s with one redacted warning and leaves primary unchanged", async (reason, additions) => {
		const log = vi.fn();
		const clock = vi.spyOn(Date, "now").mockReturnValueOnce(0).mockReturnValue(20);
		const selected = selection(reason === "mismatch" ? "digital_download" : "print");
		const result = await resolveOne(shadow({ ...additions, log }), selected);
		clock.mockRestore();
		expect(result.items[0]?.unitPriceCents).toBe(4200);
		expect(log).toHaveBeenCalledOnce();
		expect(log).toHaveBeenCalledWith({
			event: "checkout.catalog_shadow_closed",
			level: "warn",
			durationMs: 20,
			meta: { reason, primaryCount: 1, secondaryCount: reason === "mismatch" ? 1 : null },
		});
		expect(JSON.stringify(log.mock.calls)).not.toMatch(/digital|secret|product-|revision-|https:/);
	});

	it("aborts remaining partial-cart work when one secondary query fails", async () => {
		const signals: AbortSignal[] = [];
		const log = vi.fn();
		await resolveCommerce(
			fetcher,
			[selection("print"), { ...selection("print"), productId: "print-two" }],
			shadow({
				query: vi.fn((slug: string, signal: AbortSignal) => {
					signals.push(signal);
					return slug === "print-one"
						? Promise.reject(new Error("private secondary failure"))
						: new Promise(() => {});
				}),
				log,
			}),
		);
		expect(signals).toHaveLength(2);
		expect(signals.every(({ aborted }) => aborted)).toBe(true);
		expect(log).toHaveBeenCalledOnce();
	});

	it("uses one whole-cart deadline, aborts all secondary work, and returns ordered Sanity items", async () => {
		vi.useFakeTimers();
		try {
			const signals: AbortSignal[] = [];
			const log = vi.fn();
			const selections = Array.from({ length: 40 }, (_, index) => ({
				...selection("print"),
				productId: `print-${index}`,
			}));
			const promise = resolveCommerce(
				fetcher,
				selections,
				shadow({
					resolveSanity: vi.fn(({ productId }: CheckoutSelection) =>
						Promise.resolve({ ...sanityItem(), productId }),
					),
					query: vi.fn((_slug: string, signal: AbortSignal) => {
						signals.push(signal);
						return new Promise(() => {});
					}),
					log,
				}),
			);
			await vi.advanceTimersByTimeAsync(750);
			const result = await promise;
			expect(result.items.map(({ productId }) => productId)).toEqual(
				selections.map(({ productId }) => productId),
			);
			expect(signals).toHaveLength(40);
			expect(signals.every(({ aborted }) => aborted)).toBe(true);
			expect(log).toHaveBeenCalledWith(
				expect.objectContaining({
					durationMs: 750,
					meta: { reason: "timeout", primaryCount: 40, secondaryCount: null },
				}),
			);
		} finally {
			vi.useRealTimers();
		}
	});
});
