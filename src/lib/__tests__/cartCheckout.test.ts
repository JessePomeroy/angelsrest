import { describe, expect, it } from "vitest";
import { buildCartMetadata, validateCart } from "../server/cartCheckoutHelpers";
import type { CartItem } from "../shop/cart";

// Tests for the cart checkout endpoint's pure helpers — `buildCartMetadata`
// and `validateCart`. The HTTP handler itself is exercised end-to-end by
// the webhook tests (which decode the metadata that this file produces).
//
// Splitting the validation + encoding into pure functions and testing them
// in isolation gives us tight coverage of the metadata contract that has
// to stay in lockstep with the webhook's `__test__buildOrderItemsFromSession`
// — see webhookCartShape.test.ts for the round-trip test.

function makeItem(overrides: Partial<CartItem> = {}): CartItem {
	return {
		id: "abc-123",
		productSlug: "shore-no-1",
		type: "print",
		title: "Shore No. 1",
		imageUrl: "https://cdn.sanity.io/images/abc/shore-no-1.jpg",
		paperName: "Archival Matte",
		paperSubcategoryId: 103001,
		paperWidth: 8,
		paperHeight: 12,
		quantity: 1,
		unitPriceCents: 4500,
		...overrides,
	};
}

/**
 * Build a non-print merch cart item — no paper fields. Models the
 * tapestry / postcard / merchandise case where the product is a single
 * SKU with a fixed price and no LumaPrints submission.
 */
function makeMerchItem(overrides: Partial<CartItem> = {}): CartItem {
	return {
		id: "merch-1",
		productSlug: "pokemon-tapestry",
		type: "print",
		title: "Pokemon Starters Tapestry",
		imageUrl: "https://cdn.sanity.io/images/abc/pokemon-tapestry.jpg",
		quantity: 1,
		unitPriceCents: 18900,
		...overrides,
	};
}

/**
 * Build a print set cart item — type=set with an imageUrls array.
 * Models the bundled-prints case (e.g. "Tide Set" — 3 photos sold
 * together as one purchase, all printed on the same paper).
 */
function makeSetItem(overrides: Partial<CartItem> = {}): CartItem {
	return {
		id: "set-1",
		productSlug: "tide-set",
		type: "set",
		title: "Tide Set",
		imageUrl: "https://cdn.sanity.io/images/abc/tide-cover.jpg",
		imageUrls: [
			"https://cdn.sanity.io/images/abc/tide-1.jpg",
			"https://cdn.sanity.io/images/abc/tide-2.jpg",
			"https://cdn.sanity.io/images/abc/tide-3.jpg",
		],
		paperName: "Glossy",
		paperSubcategoryId: 103007,
		paperWidth: 6,
		paperHeight: 9,
		quantity: 1,
		unitPriceCents: 12000,
		...overrides,
	};
}

describe("validateCart", () => {
	it("accepts a single valid print item", () => {
		expect(validateCart([makeItem()])).toBeNull();
	});

	it("accepts multiple valid print items", () => {
		expect(
			validateCart([
				makeItem(),
				makeItem({ id: "b", productSlug: "other" }),
				makeItem({ id: "c", productSlug: "third" }),
			]),
		).toBeNull();
	});

	it("rejects a non-array payload", () => {
		expect(validateCart(null)).toMatch(/array/);
		expect(validateCart({})).toMatch(/array/);
		expect(validateCart("nope")).toMatch(/array/);
	});

	it("rejects an empty cart", () => {
		expect(validateCart([])).toMatch(/empty/);
	});

	it("rejects a cart over the 40-item Stripe metadata cap", () => {
		const items = Array.from({ length: 41 }, (_, i) =>
			makeItem({ id: `item-${i}` }),
		);
		expect(validateCart(items)).toMatch(/too large/);
	});

	it("accepts a print set item with a populated imageUrls array", () => {
		expect(validateCart([makeSetItem()])).toBeNull();
	});

	it("rejects an item missing imageUrl", () => {
		expect(validateCart([makeItem({ imageUrl: "" })])).toMatch(/imageUrl/);
	});

	it("rejects a set item missing imageUrls", () => {
		const bad = { ...makeSetItem(), imageUrls: undefined } as unknown;
		expect(validateCart([bad])).toMatch(/set cart item missing imageUrls/);
	});

	it("rejects a set item with an empty imageUrls array", () => {
		expect(validateCart([makeSetItem({ imageUrls: [] })])).toMatch(
			/missing imageUrls/,
		);
	});

	it("rejects a set with too many images for the metadata cap", () => {
		// Each ~90 char URL takes ~95 chars after JSON encoding. With 8 of
		// them plus the rest of the payload we exceed the 480-char safety
		// margin and should bounce with the "use Buy Now" message.
		const tooMany = Array.from(
			{ length: 8 },
			(_, i) =>
				`https://cdn.sanity.io/images/n7rvza4g/production/abc123def456789-1200x800-${i}.jpg`,
		);
		expect(validateCart([makeSetItem({ imageUrls: tooMany })])).toMatch(
			/too many images/,
		);
	});

	it("accepts a non-print merch item with no paper fields", () => {
		// Tapestries / postcards / etc. have no paper × size variants.
		// They go in the cart with just title + image + price.
		expect(validateCart([makeMerchItem()])).toBeNull();
	});

	it("accepts a mixed cart of prints, merch, and sets", () => {
		expect(
			validateCart([makeItem(), makeMerchItem(), makeSetItem()]),
		).toBeNull();
	});

	it("rejects an item with partial paper config", () => {
		// All-or-nothing rule: if any paper field is present, all must be.
		// A missing subcategoryId on an otherwise-print item is a bug.
		const bad = { ...makeItem(), paperSubcategoryId: undefined } as unknown;
		expect(validateCart([bad])).toMatch(/incomplete paper config/);
	});

	it("rejects zero or negative width/height when paper is present", () => {
		expect(validateCart([makeItem({ paperWidth: 0 })])).toMatch(/paperWidth/);
		expect(validateCart([makeItem({ paperHeight: -1 })])).toMatch(
			/paperHeight/,
		);
	});

	it("rejects non-integer or zero quantities", () => {
		expect(validateCart([makeItem({ quantity: 0 })])).toMatch(/quantity/);
		expect(validateCart([makeItem({ quantity: 1.5 })])).toMatch(/quantity/);
		expect(validateCart([makeItem({ quantity: -1 })])).toMatch(/quantity/);
	});

	it("rejects negative or non-integer unitPriceCents", () => {
		expect(validateCart([makeItem({ unitPriceCents: -100 })])).toMatch(
			/unitPriceCents/,
		);
		expect(validateCart([makeItem({ unitPriceCents: 4500.5 })])).toMatch(
			/unitPriceCents/,
		);
	});
});

describe("buildCartMetadata", () => {
	it("encodes the isCart flag and item count", () => {
		const meta = buildCartMetadata([makeItem(), makeItem({ id: "b" })]);
		expect(meta.isCart).toBe("true");
		expect(meta.cartItemCount).toBe("2");
	});

	it("encodes one cartItem_{n} key per item", () => {
		const meta = buildCartMetadata([
			makeItem(),
			makeItem({ id: "b" }),
			makeItem({ id: "c" }),
		]);
		expect(meta.cartItem_0).toBeTruthy();
		expect(meta.cartItem_1).toBeTruthy();
		expect(meta.cartItem_2).toBeTruthy();
		expect(meta.cartItem_3).toBeUndefined();
	});

	it("uses the abbreviated key format the webhook expects for prints", () => {
		const meta = buildCartMetadata([
			makeItem({
				imageUrl: "https://cdn.sanity.io/images/abc/foo.jpg",
				paperSubcategoryId: 103001,
				paperWidth: 8,
				paperHeight: 12,
				quantity: 3,
			}),
		]);
		const parsed = JSON.parse(meta.cartItem_0);
		expect(parsed).toEqual({
			u: "https://cdn.sanity.io/images/abc/foo.jpg",
			s: 103001,
			w: 8,
			h: 12,
			q: 3,
		});
	});

	it("omits paper fields from the encoded payload for merch items", () => {
		const meta = buildCartMetadata([makeMerchItem({ quantity: 2 })]);
		const parsed = JSON.parse(meta.cartItem_0);
		expect(parsed).toEqual({
			u: "https://cdn.sanity.io/images/abc/pokemon-tapestry.jpg",
			q: 2,
		});
		expect(parsed.s).toBeUndefined();
		expect(parsed.w).toBeUndefined();
		expect(parsed.h).toBeUndefined();
	});

	it("encodes a mixed cart with prints and merch in the right shapes", () => {
		const meta = buildCartMetadata([makeItem(), makeMerchItem()]);
		const print = JSON.parse(meta.cartItem_0);
		const merch = JSON.parse(meta.cartItem_1);
		expect(print.s).toBe(103001);
		expect(merch.s).toBeUndefined();
	});

	it("encodes the imageUrls array as `i` for set items", () => {
		const meta = buildCartMetadata([makeSetItem()]);
		const parsed = JSON.parse(meta.cartItem_0);
		expect(parsed.i).toEqual([
			"https://cdn.sanity.io/images/abc/tide-1.jpg",
			"https://cdn.sanity.io/images/abc/tide-2.jpg",
			"https://cdn.sanity.io/images/abc/tide-3.jpg",
		]);
		// Cover image stays as `u` so the cart UI can show one thumbnail.
		expect(parsed.u).toBe("https://cdn.sanity.io/images/abc/tide-cover.jpg");
		// Paper info is preserved alongside `i`.
		expect(parsed.s).toBe(103007);
		expect(parsed.w).toBe(6);
		expect(parsed.h).toBe(9);
	});

	it("omits `i` from non-set items", () => {
		const meta = buildCartMetadata([makeItem(), makeMerchItem()]);
		expect(JSON.parse(meta.cartItem_0).i).toBeUndefined();
		expect(JSON.parse(meta.cartItem_1).i).toBeUndefined();
	});

	it("stays under the 500-char Stripe metadata value cap for realistic URLs", () => {
		// Realistic Sanity CDN URL — about 90 chars
		const realisticUrl =
			"https://cdn.sanity.io/images/abc12def/production/abc123def456789-1200x800.jpg";
		const meta = buildCartMetadata([makeItem({ imageUrl: realisticUrl })]);
		expect(meta.cartItem_0.length).toBeLessThan(500);
	});

	it("stays under the 50-key Stripe metadata cap for the maximum cart size", () => {
		const items = Array.from({ length: 40 }, (_, i) =>
			makeItem({ id: `item-${i}` }),
		);
		const meta = buildCartMetadata(items);
		// 40 cartItem_* keys + isCart + cartItemCount = 42 total
		expect(Object.keys(meta).length).toBeLessThanOrEqual(50);
	});
});
