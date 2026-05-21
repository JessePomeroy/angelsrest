import { describe, expect, it } from "vitest";
import {
	buildTenantCheckoutOptions,
	buildTenantRefundOptions,
	calculatePlatformFeeAmount,
	PLATFORM_PRINT_FEE_RATE,
} from "$lib/server/stripeConnect";

describe("Stripe Connect tenant helpers", () => {
	it("calculates the locked 5% platform fee for print subtotals", () => {
		expect(PLATFORM_PRINT_FEE_RATE).toBe(0.05);
		expect(calculatePlatformFeeAmount({ kind: "print", subtotalCents: 10_099 })).toBe(504);
	});

	it("does not charge a platform fee for service checkout", () => {
		expect(calculatePlatformFeeAmount({ kind: "service", subtotalCents: 10_099 })).toBe(0);
	});

	it("creates a direct platform checkout for the hub tenant", () => {
		const options = buildTenantCheckoutOptions({
			tenant: { siteUrl: "angelsrest.online" },
			kind: "print",
			subtotalCents: 10_000,
		});

		expect(options).toEqual({
			session: {},
			requestOptions: undefined,
			platformFeeAmount: 0,
		});
	});

	it("routes print checkout through the connected account with an application fee", () => {
		const options = buildTenantCheckoutOptions({
			tenant: {
				siteUrl: "zippymiggy.com",
				stripeConnectedAccountId: "acct_123",
			},
			kind: "print",
			subtotalCents: 10_000,
		});

		expect(options).toEqual({
			session: {
				payment_intent_data: {
					application_fee_amount: 500,
				},
			},
			requestOptions: { stripeAccount: "acct_123" },
			platformFeeAmount: 500,
		});
	});

	it("routes service checkout through the connected account without an application fee", () => {
		const options = buildTenantCheckoutOptions({
			tenant: {
				siteUrl: "zippymiggy.com",
				stripeConnectedAccountId: "acct_123",
			},
			kind: "service",
			subtotalCents: 10_000,
		});

		expect(options).toEqual({
			session: {},
			requestOptions: { stripeAccount: "acct_123" },
			platformFeeAmount: 0,
		});
	});

	it("requests application-fee refunds only for connected-account refunds", () => {
		expect(
			buildTenantRefundOptions({
				siteUrl: "angelsrest.online",
			}),
		).toEqual({
			params: {},
			requestOptions: undefined,
		});

		expect(
			buildTenantRefundOptions({
				siteUrl: "zippymiggy.com",
				stripeConnectedAccountId: "acct_123",
			}),
		).toEqual({
			params: { refund_application_fee: true },
			requestOptions: { stripeAccount: "acct_123" },
		});
	});
});
