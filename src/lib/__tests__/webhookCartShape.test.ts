import type Stripe from "stripe";
import { describe, expect, it } from "vitest";
import { FulfillmentValidationError } from "../server/fulfillmentValidationError";
import { buildOrderItemsFromSession as __test__buildOrderItemsFromSession } from "../server/webhookDecoder";

function makeSession(metadata: Record<string, string>): Stripe.Checkout.Session {
	return { metadata } as unknown as Stripe.Checkout.Session;
}

// Fixed historical Stripe metadata, independent of current cart state or encoders.
describe("__test__buildOrderItemsFromSession — historical cart metadata", () => {
	it("decodes a single-item cart back into one OrderItem", () => {
		const session = makeSession({
			isCart: "true",
			cartItemCount: "1",
			cartItem_0:
				'{"u":"https://media.example.test/images/abc/shore-no-1.jpg","q":1,"s":103001,"w":8,"h":12}',
		});
		const orderItems = __test__buildOrderItemsFromSession(session, []);
		expect(orderItems).toHaveLength(1);
		expect(orderItems[0]).toMatchObject({
			imageUrl: "https://media.example.test/images/abc/shore-no-1.jpg",
			sourcePolicy: "byte_exact",
			paperSubcategoryId: 103001,
			width: 8,
			height: 12,
			quantity: 1,
		});
	});

	it("decodes a multi-item cart with mixed papers and sizes", () => {
		const session = makeSession({
			isCart: "true",
			cartItemCount: "3",
			cartItem_0:
				'{"u":"https://media.example.test/images/abc/a.jpg","q":1,"s":103001,"w":8,"h":12}',
			cartItem_1:
				'{"u":"https://media.example.test/images/abc/b.jpg","q":2,"s":103007,"w":16,"h":24}',
			cartItem_2:
				'{"u":"https://media.example.test/images/abc/c.jpg","q":3,"s":103001,"w":4,"h":6}',
		});
		const orderItems = __test__buildOrderItemsFromSession(session, []);
		expect(orderItems).toHaveLength(3);
		// Each cart entry preserves its own paper, size and quantity.
		expect(orderItems[0].paperSubcategoryId).toBe(103001);
		expect(orderItems[0].width).toBe(8);
		expect(orderItems[1].paperSubcategoryId).toBe(103007);
		expect(orderItems[1].width).toBe(16);
		expect(orderItems[1].quantity).toBe(2);
		expect(orderItems[2].quantity).toBe(3);
	});

	it("returns an empty array if isCart is true but cartItemCount is 0", () => {
		const session = makeSession({ isCart: "true", cartItemCount: "0" });
		expect(__test__buildOrderItemsFromSession(session, [])).toEqual([]);
	});

	it("returns an empty array if isCart is true but cartItemCount is missing", () => {
		const session = makeSession({ isCart: "true" });
		expect(__test__buildOrderItemsFromSession(session, [])).toEqual([]);
	});

	it("skips malformed cartItem entries instead of throwing", () => {
		// 3 items declared, middle one is corrupted
		const session = makeSession({
			isCart: "true",
			cartItemCount: "3",
			cartItem_0: '{"u":"a.jpg","s":103001,"w":8,"h":12,"q":1}',
			cartItem_1: "not valid json",
			cartItem_2: '{"u":"c.jpg","s":103001,"w":8,"h":12,"q":1}',
		});
		const orderItems = __test__buildOrderItemsFromSession(session, []);
		expect(orderItems).toHaveLength(2);
		expect(orderItems[0].imageUrl).toBe("a.jpg");
		expect(orderItems[1].imageUrl).toBe("c.jpg");
	});

	it("skips entries that parse but have wrong field types", () => {
		const session = makeSession({
			isCart: "true",
			cartItemCount: "2",
			cartItem_0: '{"u":"a.jpg","s":103001,"w":8,"h":12,"q":1}',
			// Width is a string instead of a number — should be skipped
			cartItem_1: '{"u":"b.jpg","s":103001,"w":"8","h":12,"q":1}',
		});
		const orderItems = __test__buildOrderItemsFromSession(session, []);
		expect(orderItems).toHaveLength(1);
		expect(orderItems[0].imageUrl).toBe("a.jpg");
	});

	it("skips merch entries (no paper info) so they aren't sent to LumaPrints", () => {
		const session = makeSession({
			isCart: "true",
			cartItemCount: "1",
			cartItem_0: '{"u":"https://media.example.test/images/abc/tapestry.jpg","q":1}',
		});
		expect(__test__buildOrderItemsFromSession(session, [])).toEqual([]);
	});

	it("expands a set entry with its paper config and cart line quantity on every image", () => {
		const session = makeSession({
			isCart: "true",
			cartItemCount: "1",
			cartItem_0:
				'{"u":"https://media.example.test/images/abc/tide-cover.jpg","q":2,"s":103007,"w":6,"h":9,"i":["https://media.example.test/images/abc/tide-1.jpg","https://media.example.test/images/abc/tide-2.jpg","https://media.example.test/images/abc/tide-3.jpg"]}',
		});
		const orderItems = __test__buildOrderItemsFromSession(session, []);
		expect(orderItems).toHaveLength(3);
		expect(orderItems.map((i) => i.imageUrl)).toEqual([
			"https://media.example.test/images/abc/tide-1.jpg",
			"https://media.example.test/images/abc/tide-2.jpg",
			"https://media.example.test/images/abc/tide-3.jpg",
		]);
		for (const item of orderItems) {
			expect(item.paperSubcategoryId).toBe(103007);
			expect(item.width).toBe(6);
			expect(item.height).toBe(9);
			expect(item.quantity).toBe(2);
		}
	});

	it("returns the union of single prints, merch (skipped), and set expansions", () => {
		const session = makeSession({
			isCart: "true",
			cartItemCount: "3",
			cartItem_0:
				'{"u":"https://media.example.test/images/abc/print.jpg","q":1,"s":103001,"w":8,"h":12}',
			cartItem_1: '{"u":"https://media.example.test/images/abc/tapestry.jpg","q":1}',
			cartItem_2:
				'{"u":"https://media.example.test/images/abc/tide-cover.jpg","q":1,"s":103007,"w":6,"h":9,"i":["https://media.example.test/images/abc/tide-1.jpg","https://media.example.test/images/abc/tide-2.jpg","https://media.example.test/images/abc/tide-3.jpg"]}',
		});
		const orderItems = __test__buildOrderItemsFromSession(session, []);
		expect(orderItems.map(({ imageUrl }) => imageUrl)).toEqual([
			"https://media.example.test/images/abc/print.jpg",
			"https://media.example.test/images/abc/tide-1.jpg",
			"https://media.example.test/images/abc/tide-2.jpg",
			"https://media.example.test/images/abc/tide-3.jpg",
		]);
		expect(orderItems.map(({ quantity }) => quantity)).toEqual([1, 1, 1, 1]);
	});

	it("keeps cart image and paper precedence over stale direct-set metadata", () => {
		const session = makeSession({
			isCart: "true",
			cartItemCount: "1",
			cartItem_0: '{"u":"cart.jpg","q":1,"s":103007,"w":8,"h":12}',
			isPrintSet: "true",
			imageUrl: "single.jpg",
			imageUrls: JSON.stringify(["set-a.jpg", "set-b.jpg"]),
			paperSubcategoryId: "999999",
			paperWidth: "99",
			paperHeight: "99",
		});
		const orderItems = __test__buildOrderItemsFromSession(session, []);
		expect(orderItems.map(({ imageUrl }) => imageUrl)).toEqual(["cart.jpg"]);
		expect(orderItems[0].paperSubcategoryId).toBe(103007);
		expect(orderItems[0].width).toBe(8);
	});
});

describe("__test__buildOrderItemsFromSession — backwards compat", () => {
	it("still handles the legacy single-print shape", () => {
		const session = makeSession({
			paperSubcategoryId: "103001",
			paperWidth: "8",
			paperHeight: "12",
			imageUrl: "https://media.example.test/images/abc/legacy.jpg",
		});
		const lineItems = [{ quantity: 2 } as Stripe.LineItem];
		const orderItems = __test__buildOrderItemsFromSession(session, lineItems);
		expect(orderItems).toHaveLength(1);
		expect(orderItems[0].imageUrl).toBe("https://media.example.test/images/abc/legacy.jpg");
		expect(orderItems[0].quantity).toBe(2);
	});

	it("carries direct checkout frame and canvas metadata into fulfillment items", () => {
		const session = makeSession({
			paperSubcategoryId: "101001",
			paperWidth: "8",
			paperHeight: "10",
			imageUrl: "https://media.example.test/images/abc/canvas.jpg",
			borderWidth: "0.25",
			frameSubcategoryId: "105001",
			canvasSubcategoryId: "101001",
			canvasWrapHex: "#000000",
		});
		const orderItems = __test__buildOrderItemsFromSession(session, []);
		expect(orderItems[0]).toMatchObject({
			borderWidth: 0.25,
			frameSubcategoryId: 105001,
			canvasSubcategoryId: 101001,
			canvasWrapHex: "#000000",
		});
	});

	it("still handles the legacy print set shape", () => {
		const session = makeSession({
			paperSubcategoryId: "103001",
			paperWidth: "8",
			paperHeight: "12",
			isPrintSet: "true",
			imageUrls: JSON.stringify(["a.jpg", "b.jpg", "c.jpg"]),
		});
		const orderItems = __test__buildOrderItemsFromSession(session, []);
		expect(orderItems).toHaveLength(3);
		expect(orderItems[0].imageUrl).toBe("a.jpg");
		expect(orderItems[2].imageUrl).toBe("c.jpg");
	});

	it("throws a permanent validation error for malformed legacy print dimensions", () => {
		const session = makeSession({
			paperSubcategoryId: "103001",
			paperWidth: "",
			paperHeight: "12",
			imageUrl: "https://media.example.test/images/abc/legacy.jpg",
		});

		expect(() => __test__buildOrderItemsFromSession(session, [])).toThrow(
			FulfillmentValidationError,
		);
	});

	it("returns an empty array for malformed legacy print set imageUrls", () => {
		const session = makeSession({
			paperSubcategoryId: "103001",
			paperWidth: "8",
			paperHeight: "12",
			isPrintSet: "true",
			imageUrls: JSON.stringify({ imageUrl: "not-an-array.jpg" }),
		});
		expect(__test__buildOrderItemsFromSession(session, [])).toEqual([]);
	});

	it("returns empty array for orders with no LumaPrints metadata", () => {
		const session = makeSession({});
		expect(__test__buildOrderItemsFromSession(session, [])).toEqual([]);
	});
});
