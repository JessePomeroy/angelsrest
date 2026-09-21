import { describe, expect, it } from "vitest";
import { calculatePrintSubtotalCents } from "../../../packages/crm-api/convex/helpers/printFeePolicy";
import { parseHandleCartIntent } from "../server/cartCheckoutHelpers";
import { buildTenantProductCheckoutOptions } from "../server/stripeConnect";
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
			calculatePrintSubtotalCents([
				{ productKind: "print", unitPriceCents: 4500, quantity: 2 },
				{ productKind: "merchandise", unitPriceCents: 18_900, quantity: 1 },
				{ productKind: "print_set", unitPriceCents: 12_000, quantity: 1 },
			]),
		).toBe(21_000);
	});

	it("keeps hub cart checkout direct with no application fee", () => {
		const options = buildTenantProductCheckoutOptions({
			items: [{ productKind: "print", unitPriceCents: 4500, quantity: 2 }],
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
		const options = buildTenantProductCheckoutOptions({
			items: [
				{ productKind: "print", unitPriceCents: 4500, quantity: 2 },
				{ productKind: "merchandise", unitPriceCents: 18_900, quantity: 1 },
			],
			tenant: {
				siteUrl: "zippymiggy.com",
				tenantId: "tenant_05eb6092-5d8c-43ce-ad26-1a59522bd07b",
				stripeConnectedAccountId: "acct_1234567890TenantA",
			},
		});

		expect(options).toEqual({
			session: {
				payment_intent_data: {
					application_fee_amount: 450,
					metadata: {
						commerceTenantSiteUrl: "zippymiggy.com",
						commerceTenantId: "tenant_05eb6092-5d8c-43ce-ad26-1a59522bd07b",
					},
				},
			},
			metadata: {
				commerceTenantSiteUrl: "zippymiggy.com",
				commerceTenantId: "tenant_05eb6092-5d8c-43ce-ad26-1a59522bd07b",
			},
			requestOptions: { stripeAccount: "acct_1234567890TenantA" },
			platformFeeAmount: 450,
		});
	});

	it("routes connected merch-only carts without a platform fee", () => {
		const options = buildTenantProductCheckoutOptions({
			items: [{ productKind: "merchandise", unitPriceCents: 18_900, quantity: 1 }],
			tenant: {
				siteUrl: "zippymiggy.com",
				tenantId: "tenant_05eb6092-5d8c-43ce-ad26-1a59522bd07b",
				stripeConnectedAccountId: "acct_1234567890TenantA",
			},
		});

		expect(options).toEqual({
			session: {
				payment_intent_data: {
					metadata: {
						commerceTenantSiteUrl: "zippymiggy.com",
						commerceTenantId: "tenant_05eb6092-5d8c-43ce-ad26-1a59522bd07b",
					},
				},
			},
			metadata: {
				commerceTenantSiteUrl: "zippymiggy.com",
				commerceTenantId: "tenant_05eb6092-5d8c-43ce-ad26-1a59522bd07b",
			},
			requestOptions: { stripeAccount: "acct_1234567890TenantA" },
			platformFeeAmount: 0,
		});
	});
});
