import { describe, expect, it } from "vitest";
import {
	buildCartTenantCheckoutOptions,
	calculateCartPrintSubtotalCents,
	parseHandleCartIntent,
} from "../server/cartCheckoutHelpers";
import type { CartItem } from "../shop/cart";

// Live cart checkout intent and tenant-fee helpers. Historical metadata
// decoding is covered separately by fixed fixtures in webhookCartShape.test.ts.

function makeItem(overrides: Partial<CartItem> = {}): CartItem {
	return {
		id: "abc-123",
		productSlug: "shore-no-1",
		type: "print",
		title: "Shore No. 1",
		imageUrl: "https://media.example.test/images/abc/shore-no-1.jpg",
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
		imageUrl: "https://media.example.test/images/abc/pokemon-tapestry.jpg",
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
		imageUrl: "https://media.example.test/images/abc/tide-cover.jpg",
		imageUrls: [
			"https://media.example.test/images/abc/tide-1.jpg",
			"https://media.example.test/images/abc/tide-2.jpg",
			"https://media.example.test/images/abc/tide-3.jpg",
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

describe("handle cart intent", () => {
	it("whitelists selectors and quantity while dropping browser snapshot fields", () => {
		expect(
			parseHandleCartIntent([
				makeItem({
					title: "forged",
					imageUrl: "https://attacker.test/forged.jpg",
					unitPriceCents: 1,
					paperSlug: "archival-matte",
					sizeSlug: "8x10",
				}),
			]),
		).toEqual([
			{
				productSlug: "shore-no-1",
				type: "print",
				quantity: 1,
				paperSlug: "archival-matte",
				sizeSlug: "8x10",
			},
		]);
	});

	it.each([0, 1])("preserves legacy paperIndex %i for authority classification", (paperIndex) => {
		expect(parseHandleCartIntent([makeItem({ paperIndex })])).toEqual([
			{
				productSlug: "shore-no-1",
				type: "print",
				quantity: 1,
				paperIndex,
			},
		]);
	});

	it("supports 1–40 lines independent of legacy metadata size", () => {
		const nearLimitSets = Array.from({ length: 40 }, (_, index) =>
			makeSetItem({ id: String(index), imageUrls: Array(20).fill(`https://cdn.test/${index}`) }),
		);
		expect(parseHandleCartIntent(nearLimitSets)).toHaveLength(40);
		expect(parseHandleCartIntent([...nearLimitSets, makeItem()])).toBeNull();
	});
});

describe("cart Stripe Connect options", () => {
	it("calculates print subtotal from print lines only", () => {
		expect(
			calculateCartPrintSubtotalCents([
				makeItem({ unitPriceCents: 4500, quantity: 2 }),
				makeMerchItem({ unitPriceCents: 18_900, quantity: 1 }),
				makeSetItem({ unitPriceCents: 12_000, quantity: 1 }),
			]),
		).toBe(21_000);
	});

	it("keeps hub cart checkout direct with no application fee", () => {
		const options = buildCartTenantCheckoutOptions({
			items: [makeItem({ unitPriceCents: 4500, quantity: 2 })],
			tenant: { siteUrl: "angelsrest.online" },
		});

		expect(options).toEqual({
			session: {
				payment_intent_data: {
					metadata: { commerceTenantSiteUrl: "angelsrest.online" },
				},
			},
			metadata: { commerceTenantSiteUrl: "angelsrest.online" },
			requestOptions: undefined,
			platformFeeAmount: 0,
		});
	});

	it("uses only print subtotal for connected-account cart application fees", () => {
		const options = buildCartTenantCheckoutOptions({
			items: [
				makeItem({ unitPriceCents: 4500, quantity: 2 }),
				makeMerchItem({ unitPriceCents: 18_900, quantity: 1 }),
			],
			tenant: {
				siteUrl: "zippymiggy.com",
				stripeConnectedAccountId: "acct_123",
			},
		});

		expect(options).toEqual({
			session: {
				payment_intent_data: {
					application_fee_amount: 450,
					metadata: { commerceTenantSiteUrl: "zippymiggy.com" },
				},
			},
			metadata: { commerceTenantSiteUrl: "zippymiggy.com" },
			requestOptions: { stripeAccount: "acct_123" },
			platformFeeAmount: 450,
		});
	});

	it("routes connected merch-only carts without a platform fee", () => {
		const options = buildCartTenantCheckoutOptions({
			items: [makeMerchItem({ unitPriceCents: 18_900, quantity: 1 })],
			tenant: {
				siteUrl: "zippymiggy.com",
				stripeConnectedAccountId: "acct_123",
			},
		});

		expect(options).toEqual({
			session: {
				payment_intent_data: {
					metadata: { commerceTenantSiteUrl: "zippymiggy.com" },
				},
			},
			metadata: { commerceTenantSiteUrl: "zippymiggy.com" },
			requestOptions: { stripeAccount: "acct_123" },
			platformFeeAmount: 0,
		});
	});
});
