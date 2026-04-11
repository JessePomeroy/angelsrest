import type Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";
import { buildCartMetadata } from "../server/cartCheckoutHelpers";
import type { CartItem } from "../shop/cart";

// The webhook handler imports a bunch of server-only modules. Mock them
// at the boundary so we can import `__test__buildOrderItemsFromSession`
// without spinning up Stripe / Resend / Convex.
//
// vi.mock is statically hoisted — see `feedback_vitest_mock_hoisting`
// memory for why we don't re-apply this in beforeEach.
vi.mock("stripe", () => ({
	default: class MockStripe {
		webhooks = { constructEvent: vi.fn() };
		refunds = { create: vi.fn() };
		checkout = { sessions: { retrieve: vi.fn() } };
		paymentIntents = { retrieve: vi.fn() };
	},
}));

vi.mock("resend", () => ({
	Resend: class MockResend {
		emails = { send: vi.fn() };
	},
}));

vi.mock("$lib/server/convexClient", () => ({
	getConvex: () => ({ mutation: vi.fn(), query: vi.fn() }),
}));

vi.mock("$convex/api", () => ({
	api: {
		orders: { create: "orders.create", updateStatus: "orders.updateStatus" },
		invoices: { markPaid: "invoices.markPaid" },
	},
}));

vi.mock("$lib/config/site", () => ({
	SITE_DOMAIN: "angelsrest.online",
}));

import { __test__buildOrderItemsFromSession } from "../../routes/api/webhooks/stripe/+server";

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

function makeSession(
	metadata: Record<string, string>,
): Stripe.Checkout.Session {
	return { metadata } as unknown as Stripe.Checkout.Session;
}

describe("__test__buildOrderItemsFromSession — cart shape (PR C)", () => {
	it("decodes a single-item cart back into one OrderItem", () => {
		const items = [makeItem()];
		const session = makeSession(buildCartMetadata(items));
		const orderItems = __test__buildOrderItemsFromSession(session, []);
		expect(orderItems).toHaveLength(1);
		expect(orderItems[0]).toEqual({
			imageUrl: "https://cdn.sanity.io/images/abc/shore-no-1.jpg",
			paperSubcategoryId: 103001,
			width: 8,
			height: 12,
			quantity: 1,
		});
	});

	it("decodes a multi-item cart with mixed papers and sizes", () => {
		const items: CartItem[] = [
			makeItem({
				id: "a",
				imageUrl: "https://cdn.sanity.io/images/abc/a.jpg",
				paperSubcategoryId: 103001,
				paperWidth: 8,
				paperHeight: 12,
				quantity: 1,
			}),
			makeItem({
				id: "b",
				imageUrl: "https://cdn.sanity.io/images/abc/b.jpg",
				paperSubcategoryId: 103007,
				paperWidth: 16,
				paperHeight: 24,
				quantity: 2,
			}),
			makeItem({
				id: "c",
				imageUrl: "https://cdn.sanity.io/images/abc/c.jpg",
				paperSubcategoryId: 103001,
				paperWidth: 4,
				paperHeight: 6,
				quantity: 3,
			}),
		];
		const session = makeSession(buildCartMetadata(items));
		const orderItems = __test__buildOrderItemsFromSession(session, []);
		expect(orderItems).toHaveLength(3);
		// Each cart entry preserves its OWN paper/size — proves the cart
		// branch isn't accidentally inheriting top-level paper metadata.
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
			cartItem_0: JSON.stringify({ u: "a.jpg", s: 103001, w: 8, h: 12, q: 1 }),
			cartItem_1: "not valid json",
			cartItem_2: JSON.stringify({ u: "c.jpg", s: 103001, w: 8, h: 12, q: 1 }),
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
			cartItem_0: JSON.stringify({ u: "a.jpg", s: 103001, w: 8, h: 12, q: 1 }),
			// Width is a string instead of a number — should be skipped
			cartItem_1: JSON.stringify({
				u: "b.jpg",
				s: 103001,
				w: "8",
				h: 12,
				q: 1,
			}),
		});
		const orderItems = __test__buildOrderItemsFromSession(session, []);
		expect(orderItems).toHaveLength(1);
		expect(orderItems[0].imageUrl).toBe("a.jpg");
	});

	it("skips merch entries (no paper info) so they aren't sent to LumaPrints", () => {
		// A merch item is encoded with just { u, q } — no s/w/h. The decoder
		// should treat its absence as the signal to skip LumaPrints
		// submission entirely. The Convex order itself is built from the
		// Stripe line items elsewhere, so the customer still has a record.
		const session = makeSession({
			isCart: "true",
			cartItemCount: "1",
			cartItem_0: JSON.stringify({
				u: "https://cdn.sanity.io/images/abc/tapestry.jpg",
				q: 1,
			}),
		});
		expect(__test__buildOrderItemsFromSession(session, [])).toEqual([]);
	});

	it("returns only the print rows in a mixed prints + merch cart", () => {
		const items: CartItem[] = [
			makeItem({
				id: "print",
				imageUrl: "https://cdn.sanity.io/images/abc/print.jpg",
			}),
			// Build a merch item by stripping the paper fields
			{
				...makeItem({ id: "merch" }),
				paperName: undefined,
				paperSubcategoryId: undefined,
				paperWidth: undefined,
				paperHeight: undefined,
				imageUrl: "https://cdn.sanity.io/images/abc/tapestry.jpg",
			},
			makeItem({
				id: "print2",
				imageUrl: "https://cdn.sanity.io/images/abc/print2.jpg",
				paperWidth: 16,
				paperHeight: 24,
			}),
		];
		const session = makeSession(buildCartMetadata(items));
		const orderItems = __test__buildOrderItemsFromSession(session, []);
		// Only the two print items should make it through to LumaPrints.
		expect(orderItems).toHaveLength(2);
		expect(orderItems[0].imageUrl).toBe(
			"https://cdn.sanity.io/images/abc/print.jpg",
		);
		expect(orderItems[1].imageUrl).toBe(
			"https://cdn.sanity.io/images/abc/print2.jpg",
		);
		expect(orderItems[1].width).toBe(16);
	});

	it("ignores top-level paperSubcategoryId when isCart is set", () => {
		// Cart entries should drive everything; top-level metadata is
		// either absent or irrelevant for cart checkouts.
		const session = makeSession({
			...buildCartMetadata([makeItem({ paperSubcategoryId: 103007 })]),
			// Stale top-level metadata that should be ignored
			paperSubcategoryId: "999999",
			paperWidth: "99",
		});
		const orderItems = __test__buildOrderItemsFromSession(session, []);
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
			imageUrl: "https://cdn.sanity.io/images/abc/legacy.jpg",
		});
		const lineItems = [{ quantity: 2 } as Stripe.LineItem];
		const orderItems = __test__buildOrderItemsFromSession(session, lineItems);
		expect(orderItems).toHaveLength(1);
		expect(orderItems[0].imageUrl).toBe(
			"https://cdn.sanity.io/images/abc/legacy.jpg",
		);
		expect(orderItems[0].quantity).toBe(2);
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

	it("returns empty array for orders with no LumaPrints metadata", () => {
		const session = makeSession({});
		expect(__test__buildOrderItemsFromSession(session, [])).toEqual([]);
	});
});
