import { describe, expect, it } from "vitest";
import {
	addItemToCart,
	CART_EXPIRY_DAYS,
	type CartItem,
	type CartState,
	cartItemCount,
	cartTotalCents,
	clearCart,
	emptyCart,
	isCartExpired,
	itemMatchKey,
	MAX_QUANTITY_PER_LINE,
	removeItemFromCart,
	updateItemQuantity,
} from "../shop/cart";

// Test helpers — keep object construction terse so each test is one
// distinct concern, not a wall of property assignments.

let nextId = 0;
const idGen = () => `test-id-${++nextId}`;

function makePrintItem(
	overrides: Partial<Omit<CartItem, "id">> = {},
): Omit<CartItem, "id"> {
	return {
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

function makeSetItem(
	overrides: Partial<Omit<CartItem, "id">> = {},
): Omit<CartItem, "id"> {
	return {
		productSlug: "tide-set",
		type: "set",
		title: "Tide Set (5 prints)",
		imageUrl: "https://cdn.sanity.io/images/abc/tide-1.jpg",
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

describe("emptyCart", () => {
	it("returns a cart with no items and a current ISO timestamp", () => {
		const now = new Date("2026-04-11T08:00:00Z");
		const cart = emptyCart(now);
		expect(cart.items).toEqual([]);
		expect(cart.updatedAt).toBe("2026-04-11T08:00:00.000Z");
	});
});

describe("itemMatchKey", () => {
	it("treats same product + same paper + same size as the same key", () => {
		const a = makePrintItem();
		const b = makePrintItem();
		expect(itemMatchKey(a)).toBe(itemMatchKey(b));
	});

	it("treats different paper as different keys", () => {
		const matte = makePrintItem({
			paperName: "Archival Matte",
			paperSubcategoryId: 103001,
		});
		const glossy = makePrintItem({
			paperName: "Glossy",
			paperSubcategoryId: 103007,
		});
		expect(itemMatchKey(matte)).not.toBe(itemMatchKey(glossy));
	});

	it("treats different size as different keys", () => {
		const small = makePrintItem({ paperWidth: 4, paperHeight: 6 });
		const large = makePrintItem({ paperWidth: 16, paperHeight: 24 });
		expect(itemMatchKey(small)).not.toBe(itemMatchKey(large));
	});

	it("treats different products as different keys", () => {
		const a = makePrintItem({ productSlug: "shore-no-1" });
		const b = makePrintItem({ productSlug: "shore-no-2" });
		expect(itemMatchKey(a)).not.toBe(itemMatchKey(b));
	});

	it("treats prints and sets as different keys even with same product", () => {
		const print = makePrintItem({ productSlug: "tide-set", type: "print" });
		const set = makeSetItem({ productSlug: "tide-set" });
		expect(itemMatchKey(print)).not.toBe(itemMatchKey(set));
	});

	it("treats two sets with different image arrays as different keys", () => {
		const a = makeSetItem({ imageUrls: ["a.jpg", "b.jpg"] });
		const b = makeSetItem({ imageUrls: ["a.jpg", "c.jpg"] });
		expect(itemMatchKey(a)).not.toBe(itemMatchKey(b));
	});
});

describe("addItemToCart", () => {
	it("adds a new line item to an empty cart", () => {
		const cart = addItemToCart(emptyCart(), makePrintItem(), idGen);
		expect(cart.items).toHaveLength(1);
		expect(cart.items[0].id).toBe("test-id-1");
		expect(cart.items[0].title).toBe("Shore No. 1");
		expect(cart.items[0].quantity).toBe(1);
	});

	it("merges quantities when the same product + paper + size is added twice", () => {
		let cart = addItemToCart(emptyCart(), makePrintItem(), idGen);
		cart = addItemToCart(cart, makePrintItem({ quantity: 2 }), idGen);
		expect(cart.items).toHaveLength(1);
		expect(cart.items[0].quantity).toBe(3);
	});

	it("adds a separate line for the same product with a different paper", () => {
		let cart = addItemToCart(
			emptyCart(),
			makePrintItem({
				paperName: "Archival Matte",
				paperSubcategoryId: 103001,
			}),
			idGen,
		);
		cart = addItemToCart(
			cart,
			makePrintItem({ paperName: "Glossy", paperSubcategoryId: 103007 }),
			idGen,
		);
		expect(cart.items).toHaveLength(2);
		expect(cart.items.map((i) => i.paperName)).toEqual([
			"Archival Matte",
			"Glossy",
		]);
	});

	it("adds a separate line for the same product with a different size", () => {
		let cart = addItemToCart(
			emptyCart(),
			makePrintItem({ paperWidth: 8, paperHeight: 12 }),
			idGen,
		);
		cart = addItemToCart(
			cart,
			makePrintItem({ paperWidth: 16, paperHeight: 24 }),
			idGen,
		);
		expect(cart.items).toHaveLength(2);
	});

	it("clamps quantity above MAX_QUANTITY_PER_LINE", () => {
		const cart = addItemToCart(
			emptyCart(),
			makePrintItem({ quantity: 999 }),
			idGen,
		);
		expect(cart.items[0].quantity).toBe(MAX_QUANTITY_PER_LINE);
	});

	it("clamps quantity below 1 to 1", () => {
		const cart = addItemToCart(
			emptyCart(),
			makePrintItem({ quantity: 0 }),
			idGen,
		);
		expect(cart.items[0].quantity).toBe(1);
	});

	it("clamps merged quantity above the cap", () => {
		let cart = addItemToCart(
			emptyCart(),
			makePrintItem({ quantity: 15 }),
			idGen,
		);
		cart = addItemToCart(cart, makePrintItem({ quantity: 15 }), idGen);
		expect(cart.items[0].quantity).toBe(MAX_QUANTITY_PER_LINE);
	});

	it("does not mutate the input cart (immutability check)", () => {
		const original = emptyCart();
		const result = addItemToCart(original, makePrintItem(), idGen);
		expect(original.items).toEqual([]);
		expect(result).not.toBe(original);
	});

	it("updates updatedAt when adding an item", () => {
		const before = new Date("2026-04-01T00:00:00Z");
		const after = new Date("2026-04-11T00:00:00Z");
		const original = emptyCart(before);
		const result = addItemToCart(original, makePrintItem(), idGen, after);
		expect(result.updatedAt).toBe("2026-04-11T00:00:00.000Z");
	});
});

describe("updateItemQuantity", () => {
	it("changes the quantity of an existing item", () => {
		let cart = addItemToCart(emptyCart(), makePrintItem(), idGen);
		const itemId = cart.items[0].id;
		cart = updateItemQuantity(cart, itemId, 5);
		expect(cart.items[0].quantity).toBe(5);
	});

	it("removes the item when quantity drops to 0", () => {
		let cart = addItemToCart(emptyCart(), makePrintItem(), idGen);
		const itemId = cart.items[0].id;
		cart = updateItemQuantity(cart, itemId, 0);
		expect(cart.items).toHaveLength(0);
	});

	it("removes the item when quantity goes negative", () => {
		let cart = addItemToCart(emptyCart(), makePrintItem(), idGen);
		const itemId = cart.items[0].id;
		cart = updateItemQuantity(cart, itemId, -3);
		expect(cart.items).toHaveLength(0);
	});

	it("clamps to MAX_QUANTITY_PER_LINE", () => {
		let cart = addItemToCart(emptyCart(), makePrintItem(), idGen);
		const itemId = cart.items[0].id;
		cart = updateItemQuantity(cart, itemId, 999);
		expect(cart.items[0].quantity).toBe(MAX_QUANTITY_PER_LINE);
	});

	it("is a no-op for an unknown item id", () => {
		let cart = addItemToCart(emptyCart(), makePrintItem(), idGen);
		cart = updateItemQuantity(cart, "nonexistent", 5);
		expect(cart.items[0].quantity).toBe(1);
	});
});

describe("removeItemFromCart", () => {
	it("removes the matching item by id", () => {
		let cart = addItemToCart(emptyCart(), makePrintItem(), idGen);
		cart = addItemToCart(
			cart,
			makePrintItem({ productSlug: "other-print" }),
			idGen,
		);
		expect(cart.items).toHaveLength(2);
		const firstId = cart.items[0].id;
		cart = removeItemFromCart(cart, firstId);
		expect(cart.items).toHaveLength(1);
		expect(cart.items[0].productSlug).toBe("other-print");
	});

	it("is a no-op for an unknown id", () => {
		let cart = addItemToCart(emptyCart(), makePrintItem(), idGen);
		cart = removeItemFromCart(cart, "nonexistent");
		expect(cart.items).toHaveLength(1);
	});
});

describe("clearCart", () => {
	it("returns an empty cart regardless of input", () => {
		const cart = clearCart();
		expect(cart.items).toEqual([]);
	});
});

describe("cartTotalCents", () => {
	it("sums unit prices times quantities across all line items", () => {
		let cart = addItemToCart(
			emptyCart(),
			makePrintItem({ unitPriceCents: 4500, quantity: 2 }),
			idGen,
		);
		cart = addItemToCart(
			cart,
			makePrintItem({
				productSlug: "other",
				unitPriceCents: 7500,
				quantity: 3,
			}),
			idGen,
		);
		// 4500*2 + 7500*3 = 9000 + 22500 = 31500
		expect(cartTotalCents(cart)).toBe(31500);
	});

	it("returns 0 for an empty cart", () => {
		expect(cartTotalCents(emptyCart())).toBe(0);
	});
});

describe("cartItemCount", () => {
	it("sums quantities across line items", () => {
		let cart = addItemToCart(
			emptyCart(),
			makePrintItem({ quantity: 2 }),
			idGen,
		);
		cart = addItemToCart(
			cart,
			makePrintItem({ productSlug: "other", quantity: 3 }),
			idGen,
		);
		expect(cartItemCount(cart)).toBe(5);
	});

	it("returns 0 for an empty cart", () => {
		expect(cartItemCount(emptyCart())).toBe(0);
	});
});

describe("isCartExpired", () => {
	it("returns false for a fresh cart", () => {
		const now = new Date("2026-04-11T00:00:00Z");
		const cart = emptyCart(now);
		expect(isCartExpired(cart, now)).toBe(false);
	});

	it("returns false for a cart updated within the expiry window", () => {
		const oneWeekAgo = new Date("2026-04-04T00:00:00Z");
		const now = new Date("2026-04-11T00:00:00Z");
		const cart: CartState = { items: [], updatedAt: oneWeekAgo.toISOString() };
		expect(isCartExpired(cart, now)).toBe(false);
	});

	it("returns true for a cart older than CART_EXPIRY_DAYS", () => {
		const twoMonthsAgo = new Date("2026-02-01T00:00:00Z");
		const now = new Date("2026-04-11T00:00:00Z");
		const cart: CartState = {
			items: [],
			updatedAt: twoMonthsAgo.toISOString(),
		};
		expect(isCartExpired(cart, now)).toBe(true);
	});

	it("uses CART_EXPIRY_DAYS as the boundary", () => {
		// Exactly one millisecond past the expiry window
		const now = new Date("2026-04-11T00:00:00Z");
		const justPastExpiry = new Date(
			now.getTime() - (CART_EXPIRY_DAYS * 24 * 60 * 60 * 1000 + 1),
		);
		const cart: CartState = {
			items: [],
			updatedAt: justPastExpiry.toISOString(),
		};
		expect(isCartExpired(cart, now)).toBe(true);
	});
});
