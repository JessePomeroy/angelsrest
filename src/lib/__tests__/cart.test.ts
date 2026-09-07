import { describe, expect, it } from "vitest";
import {
	addItemToCart,
	CART_EXPIRY_DAYS,
	type CartItem,
	cartItemCount,
	cartTotalCents,
	clearCart,
	emptyCart,
	isCartExpired,
	MAX_QUANTITY_PER_LINE,
	parseCartState,
	removeItemFromCart,
	STORAGE_KEY,
	updateItemQuantity,
} from "../shop/cart";

const now = new Date("2026-04-11T00:00:00Z");
const item: Omit<CartItem, "id"> = {
	productSlug: "shore-no-1",
	type: "print",
	title: "Shore No. 1",
	imageUrl: "https://media.example.test/shore.jpg",
	paperName: "Archival Matte",
	paperSubcategoryId: 103001,
	paperWidth: 8,
	paperHeight: 12,
	quantity: 1,
	unitPriceCents: 4500,
};
const oneItem = () => addItemToCart(emptyCart(now), item, () => "first", now);

describe("cart state", () => {
	it("keeps the storage namespace, empty totals, and authored timestamp", () => {
		expect(STORAGE_KEY).toBe("angelsrest:cart:v3");
		const empty = emptyCart(now);
		expect(empty).toEqual({ items: [], updatedAt: now.toISOString() });
		expect(clearCart(now)).toEqual(empty);
		expect(cartItemCount(empty)).toBe(0);
		expect(cartTotalCents(empty)).toBe(0);
	});

	it("adds without mutating its input and merges matching quantities", () => {
		const original = emptyCart(new Date("2026-04-01T00:00:00Z"));
		const added = addItemToCart(original, item, () => "first", now);
		expect(added).not.toBe(original);
		expect(original.items).toEqual([]);
		expect(added).toEqual({ items: [{ ...item, id: "first" }], updatedAt: now.toISOString() });
		const merged = addItemToCart(added, { ...item, quantity: 2 }, () => "unused", now);
		expect(merged.items).toEqual([{ ...item, id: "first", quantity: 3 }]);
	});

	it.each([
		{ paperSubcategoryId: 103007, paperName: "Glossy" },
		{ paperWidth: 16, paperHeight: 24 },
		{ productSlug: "shore-no-2" },
		{ type: "set" as const },
	])("keeps distinct purchases on separate lines: %j", (difference) => {
		const changed = { ...item, ...difference };
		const cart = addItemToCart(oneItem(), changed, () => "second", now);
		expect(cart.items).toEqual([
			{ ...item, id: "first" },
			{ ...changed, id: "second" },
		]);
	});

	it("keeps sets with different image arrays distinct", () => {
		const set = { ...item, type: "set" as const, imageUrls: ["a.jpg", "b.jpg"] };
		const first = addItemToCart(emptyCart(now), set, () => "first", now);
		const changed = { ...set, imageUrls: ["a.jpg", "c.jpg"] };
		expect(addItemToCart(first, changed, () => "second", now).items).toEqual([
			{ ...set, id: "first" },
			{ ...changed, id: "second" },
		]);
	});

	it.each([
		[0, 1],
		[999, MAX_QUANTITY_PER_LINE],
	])("bounds a newly added quantity %i to %i", (quantity, expected) => {
		const cart = addItemToCart(emptyCart(now), { ...item, quantity }, () => "first", now);
		expect(cart.items[0].quantity).toBe(expected);
	});

	it("caps merged quantities", () => {
		const first = addItemToCart(emptyCart(now), { ...item, quantity: 15 }, () => "first", now);
		expect(
			addItemToCart(first, { ...item, quantity: 15 }, () => "unused", now).items[0].quantity,
		).toBe(MAX_QUANTITY_PER_LINE);
	});

	it.each([
		[5, 5],
		[999, MAX_QUANTITY_PER_LINE],
		[0, null],
		[-3, null],
	])("updates quantity %i to %s", (quantity, expected) => {
		const updated = updateItemQuantity(oneItem(), "first", quantity, now);
		expect(updated.items).toEqual(
			expected === null ? [] : [{ ...item, id: "first", quantity: expected }],
		);
	});

	it("removes only the selected line and ignores unknown identities", () => {
		const original = oneItem();
		const two = addItemToCart(original, { ...item, productSlug: "other" }, () => "second", now);
		expect(removeItemFromCart(two, "first", now).items).toEqual([two.items[1]]);
		expect(removeItemFromCart(original, "unknown", now)).toEqual(original);
		expect(updateItemQuantity(original, "unknown", 5, now)).toEqual(original);
	});

	it("totals prices in cents and quantities across lines", () => {
		const first = addItemToCart(emptyCart(now), { ...item, quantity: 2 }, () => "first", now);
		const cart = addItemToCart(
			first,
			{ ...item, productSlug: "other", quantity: 3, unitPriceCents: 7500 },
			() => "second",
			now,
		);
		expect(cartTotalCents(cart)).toBe(31500);
		expect(cartItemCount(cart)).toBe(5);
	});

	it.each([
		[0, false],
		[7, false],
		[CART_EXPIRY_DAYS, false],
		[CART_EXPIRY_DAYS + 1 / 86400000, true],
		[69, true],
	])("expires a cart aged %s days: %s", (days, expected) => {
		const cart = emptyCart(new Date(now.getTime() - days * 86400000));
		expect(isCartExpired(cart, now)).toBe(expected);
	});
});

describe("persisted cart parsing", () => {
	it.each([
		{
			productSlug: "canvas-print",
			canvasSubcategoryId: 101001,
			canvasWrapHex: "#FFFFFF",
			borderWidthValue: "none",
			frameValue: "none",
		},
		{
			productSlug: "framed-print",
			paperSlug: "archival-matte",
			sizeSlug: "8x12",
			borderWidth: 0.25,
			borderWidthValue: "0.25",
			frameSubcategoryId: 105001,
			frameValue: "black",
		},
		{ productSlug: "legacy-print", paperIndex: 0, paperWidth: 8.5, paperHeight: 11 },
		{ productSlug: "paired-prints", type: "set" as const, imageUrls: ["first.jpg", "second.jpg"] },
	])("retains valid print choices: $productSlug", (options) => {
		const stored = { items: [{ ...item, ...options, id: "valid" }], updatedAt: now.toISOString() };
		expect(parseCartState(JSON.parse(JSON.stringify(stored)))).toEqual(stored);
	});

	it("preserves fixed-price merchandise without print options, blank images, and zero prices", () => {
		const stored = {
			items: [
				{
					id: "merch",
					productSlug: "shirt",
					type: "print",
					title: "Shirt",
					imageUrl: "",
					quantity: 20,
					unitPriceCents: 0,
				},
			],
			updatedAt: now.toISOString(),
		};
		expect(parseCartState(stored)).toEqual(stored);
		expect(parseCartState(emptyCart(now))).toEqual(emptyCart(now));
	});

	it.each([
		null,
		[],
		{},
		{ items: null, updatedAt: now.toISOString() },
		{ items: [null], updatedAt: now.toISOString() },
		{ items: [{}], updatedAt: now.toISOString() },
		{ items: [[item]], updatedAt: now.toISOString() },
		{ items: [], updatedAt: "not a date" },
		{ items: [], updatedAt: "" },
		{ items: [], updatedAt: 0 },
		{ items: [] },
	])("rejects malformed saved state: %j", (stored) => {
		expect(parseCartState(stored)).toBeNull();
	});

	it.each([
		{ id: "" },
		{ id: null },
		{ productSlug: " " },
		{ productSlug: 123 },
		{ type: "digital" },
		{ type: "merch" },
		{ title: {} },
		{ imageUrl: null },
		{ quantity: "1" },
		{ quantity: 0 },
		{ quantity: -1 },
		{ quantity: 1.5 },
		{ quantity: MAX_QUANTITY_PER_LINE + 1 },
		{ unitPriceCents: -1 },
		{ unitPriceCents: 10.5 },
		{ unitPriceCents: Number.NaN },
		{ unitPriceCents: Number.POSITIVE_INFINITY },
		{ unitPriceCents: Number.MAX_SAFE_INTEGER + 1 },
		{ imageUrls: "photo.jpg" },
		{ imageUrls: [null] },
		{ paperIndex: -1 },
		{ paperIndex: 0.5 },
		{ paperSubcategoryId: 0 },
		{ frameSubcategoryId: 1.5 },
		{ canvasSubcategoryId: "101001" },
		{ paperWidth: 0 },
		{ paperHeight: Number.POSITIVE_INFINITY },
		{ borderWidth: -0.25 },
	])("rejects unsafe item fields: %j", (difference) => {
		expect(
			parseCartState({ ...oneItem(), items: [{ ...oneItem().items[0], ...difference }] }),
		).toBeNull();
	});

	it.each([
		"paperName",
		"paperSlug",
		"sizeSlug",
		"canvasWrapHex",
		"borderWidthValue",
		"frameValue",
	])("rejects malformed optional %s", (field) => {
		expect(
			parseCartState({ ...oneItem(), items: [{ ...oneItem().items[0], [field]: {} }] }),
		).toBeNull();
	});

	it("rejects a JSON numeric overflow before totals can become infinite", () => {
		const raw = JSON.stringify(oneItem()).replace(
			'"unitPriceCents":4500',
			'"unitPriceCents":1e400',
		);
		expect(parseCartState(JSON.parse(raw))).toBeNull();
	});

	it("rejects duplicate line identities that would break keyed cart rendering", () => {
		const duplicate = { ...oneItem().items[0], productSlug: "another-print" };
		expect(parseCartState({ ...oneItem(), items: [oneItem().items[0], duplicate] })).toBeNull();
	});

	it("rejects unsafe line or combined totals even when each unit price is safe", () => {
		const expensive = { ...oneItem().items[0], unitPriceCents: Number.MAX_SAFE_INTEGER };
		expect(parseCartState({ ...oneItem(), items: [{ ...expensive, quantity: 2 }] })).toBeNull();
		expect(
			parseCartState({
				...oneItem(),
				items: [expensive, { ...expensive, id: "second", unitPriceCents: 1 }],
			}),
		).toBeNull();
	});
});
