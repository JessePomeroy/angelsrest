/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import { FEE_CAPTURE_RETRY_DELAY_MS } from "./helpers/stripeFeeCapture";
import schema from "./schema";
import { recordFeeCaptureRetry } from "./stripeFeesStore";

const modules = import.meta.glob("./**/*.ts");
const attemptToken = "fee-capture-attempt-token";

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
});

afterEach(() => {
	vi.useRealTimers();
});

async function seedOrder() {
	const t = convexTest(schema, modules);
	const orderId = await t.run(async (ctx) =>
		ctx.db.insert("orders", {
			siteUrl: "tenant.example",
			orderNumber: "ORD-FEE-001",
			stripeSessionId: "cs_fee_test",
			stripePaymentIntentId: "pi_fee_test",
			stripePaymentCurrency: "usd",
			stripePaymentLivemode: false,
			stripeConnectedAccountId: "acct_fee_test",
			customerEmail: "customer@example.com",
			items: [],
			total: 1000,
			fulfillmentType: "digital",
			status: "new",
			stripeFeeCaptureStatus: "pending",
			stripeFeeCaptureAttempts: 0,
			stripeFeeCaptureNextAttemptAt: Date.now() + 15_000,
		}),
	);
	return { t, orderId };
}

describe("Stripe fee capture checkpoints", () => {
	test("retains connected-account routing for the delayed Stripe read", async () => {
		const { t, orderId } = await seedOrder();

		const order = await t.query(internal.stripeFeesStore.getOrderForFees, { orderId });

		expect(order?.stripeConnectedAccountId).toBe("acct_fee_test");
	});

	test("checkpoints an attempt before the external call", async () => {
		const { t, orderId } = await seedOrder();

		await t.mutation(internal.stripeFeesStore.beginAttempt, {
			orderId, attempt: 1, attemptToken,
		});

		const order = await t.run(async (ctx) => ctx.db.get(orderId));
		expect(order).toMatchObject({
			stripeFeeCaptureStatus: "pending",
			stripeFeeCaptureAttempts: 1,
			stripeFeeCaptureLastAttemptAt: expect.any(Number),
		});
		expect(order?.stripeFeeCaptureNextAttemptAt).toBe(
			Date.now() + FEE_CAPTURE_RETRY_DELAY_MS,
		);
		expect(order?.stripeFeeCaptureAttemptToken).toBe(attemptToken);
		expect(order?.stripeFeeCaptureError).toBeUndefined();
	});

	test("records retry visibility without making the attempt terminal", async () => {
		const { t, orderId } = await seedOrder();
		const nextAttemptAt = Date.now() + FEE_CAPTURE_RETRY_DELAY_MS;
		await t.mutation(internal.stripeFeesStore.beginAttempt, {
			orderId, attempt: 1, attemptToken,
		});

		await t.mutation(internal.stripeFeesStore.recordRetry, {
			orderId,
			attempt: 1,
			attemptToken,
			error: "stripe_api_error",
		});

		const order = await t.run(async (ctx) => ctx.db.get(orderId));
		expect(order).toMatchObject({
			stripeFeeCaptureStatus: "pending",
			stripeFeeCaptureAttempts: 1,
			stripeFeeCaptureNextAttemptAt: nextAttemptAt,
			stripeFeeCaptureError: "stripe_api_error",
		});
	});

	test("rolls the checkpoint back when scheduler dispatch fails", async () => {
		const { t, orderId } = await seedOrder();
		await t.mutation(internal.stripeFeesStore.beginAttempt, {
			orderId, attempt: 1, attemptToken,
		});
		const before = await t.run(async (ctx) => ctx.db.get(orderId));

		await expect(t.mutation(async (ctx) => await recordFeeCaptureRetry(
			ctx,
			{ orderId, attempt: 1, attemptToken, error: "stripe_api_error" },
			Number.POSITIVE_INFINITY,
		))).rejects.toThrow(/finite number/i);

		expect(await t.run(async (ctx) => ctx.db.get(orderId))).toEqual(before);
	});

	test("records captured fees and clears retry metadata", async () => {
		const { t, orderId } = await seedOrder();
		await t.mutation(internal.stripeFeesStore.beginAttempt, {
			orderId, attempt: 1, attemptToken,
		});
		await t.mutation(internal.stripeFeesStore.recordRetry, {
			orderId,
			attempt: 1,
			attemptToken,
			error: "balance_transaction_not_ready",
		});
		const secondToken = "fee-capture-attempt-token-2";
		await t.mutation(internal.stripeFeesStore.beginAttempt, {
			orderId, attempt: 2, attemptToken: secondToken,
		});

		await t.mutation(internal.stripeFeesStore.setFees, {
			orderId,
			stripeFees: 0,
			stripeFeeCurrency: "usd",
			stripeFeeChargeId: "ch_fee_test",
			stripeFeeBalanceTransactionId: "txn_fee_test",
			attempt: 2,
			attemptToken: secondToken,
		});

		const order = await t.run(async (ctx) => ctx.db.get(orderId));
		expect(order).toMatchObject({
			stripeFees: 0,
			stripeFeeCurrency: "usd",
			stripeFeeChargeId: "ch_fee_test",
			stripeFeeBalanceTransactionId: "txn_fee_test",
			stripeFeeCapturedAt: Date.now(),
			stripeFeeProvenanceVersion: 1,
			stripeFeeProvenance: "provider_verified",
			stripeFeeCaptureStatus: "captured",
			stripeFeeCaptureAttempts: 2,
		});
		expect(order?.stripeFeeCaptureNextAttemptAt).toBeUndefined();
		expect(order?.stripeFeeCaptureError).toBeUndefined();
	});

	test("keeps a manual-refund cancellation terminal across every fee transition", async () => {
		const { t, orderId } = await seedOrder();
		await t.mutation(internal.stripeFeesStore.beginAttempt, {
			orderId, attempt: 1, attemptToken,
		});
		await t.run((ctx) => ctx.db.patch(orderId, {
			status: "refunded",
			stripeRefundId: "re_manual_refund",
			stripeFeeCaptureStatus: "canceled",
			stripeFeeCaptureNextAttemptAt: undefined,
		}));

		await expect(t.query(internal.stripeFeesStore.getOrderForFees, { orderId }))
			.resolves.toBeNull();
		await expect(t.mutation(internal.stripeFeesStore.beginAttempt, {
			orderId, attempt: 2, attemptToken: "late-token",
		}))
			.resolves.toBe(false);
		await expect(t.mutation(internal.stripeFeesStore.recordRetry, {
			orderId, attempt: 1, attemptToken, error: "stripe_api_error",
		})).resolves.toBe(false);
		await expect(t.mutation(internal.stripeFeesStore.setFees, {
			orderId, stripeFees: 300, stripeFeeCurrency: "usd",
			stripeFeeChargeId: "ch_late", stripeFeeBalanceTransactionId: "txn_late",
			attempt: 1, attemptToken,
		})).resolves.toBe(false);
		await expect(t.mutation(internal.stripeFeesStore.recordFailure, {
			orderId, attempt: 1, attemptToken, error: "stripe_api_error",
		})).resolves.toBe(false);
		expect(await t.run((ctx) => ctx.db.get(orderId))).toMatchObject({
			status: "refunded",
			stripeRefundId: "re_manual_refund",
			stripeFeeCaptureStatus: "canceled",
		});
	});

	test("records terminal failure and refuses to regress to pending", async () => {
		const { t, orderId } = await seedOrder();
		await t.mutation(internal.stripeFeesStore.beginAttempt, {
			orderId, attempt: 1, attemptToken,
		});
		await t.mutation(internal.stripeFeesStore.recordFailure, {
			orderId,
			attempt: 1,
			attemptToken,
			error: "balance_transaction_not_ready",
		});

		const restarted = await t.mutation(internal.stripeFeesStore.beginAttempt, {
			orderId,
			attempt: 1,
			attemptToken: "restart-token",
		});
		const order = await t.run(async (ctx) => ctx.db.get(orderId));
		expect(restarted).toBe(false);
		expect(order).toMatchObject({
			stripeFeeCaptureStatus: "failed",
			stripeFeeCaptureAttempts: 1,
			stripeFeeCaptureError: "balance_transaction_not_ready",
		});
		expect(order?.stripeFeeCaptureNextAttemptAt).toBeUndefined();
	});

	test("rejects duplicate, stale, and out-of-order attempts before provider work", async () => {
		const { t, orderId } = await seedOrder();
		await expect(t.mutation(internal.stripeFeesStore.beginAttempt, {
			orderId, attempt: 1, attemptToken,
		})).resolves.toBe(true);
		await expect(t.mutation(internal.stripeFeesStore.beginAttempt, {
			orderId, attempt: 1, attemptToken: "duplicate-token",
		})).resolves.toBe(false);
		await expect(t.mutation(internal.stripeFeesStore.beginAttempt, {
			orderId, attempt: 2, attemptToken: "concurrent-next-token",
		})).resolves.toBe(false);
		await expect(t.mutation(internal.stripeFeesStore.beginAttempt, {
			orderId, attempt: 3, attemptToken: "out-of-order-token",
		})).resolves.toBe(false);
		await expect(t.mutation(internal.stripeFeesStore.setFees, {
			orderId, stripeFees: 100, stripeFeeCurrency: "usd",
			stripeFeeChargeId: "ch_stale", stripeFeeBalanceTransactionId: "txn_stale",
			attempt: 1, attemptToken: "stale-token",
		})).resolves.toBe(false);
	});

	test("atomically advances a timed-out attempt and makes its old token stale", async () => {
		const { t, orderId } = await seedOrder();
		await t.mutation(internal.stripeFeesStore.beginAttempt, {
			orderId, attempt: 1, attemptToken,
		});
		vi.advanceTimersByTime(FEE_CAPTURE_RETRY_DELAY_MS);
		await expect(t.mutation(internal.stripeFeesStore.expireAttempt, {
			orderId, attempt: 1, attemptToken,
		})).resolves.toBe(true);
		const order = await t.run((ctx) => ctx.db.get(orderId));
		expect(order).toMatchObject({
			stripeFeeCaptureStatus: "pending",
			stripeFeeCaptureAttempts: 1,
			stripeFeeCaptureError: "stripe_api_error",
		});
		expect(order?.stripeFeeCaptureAttemptToken).toBeUndefined();
		await expect(t.mutation(internal.stripeFeesStore.recordFailure, {
			orderId, attempt: 1, attemptToken, error: "stripe_api_error",
		})).resolves.toBe(false);
	});

	test.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
		"refuses invalid provider-derived fee %s",
		async (stripeFees) => {
			const { t, orderId } = await seedOrder();
			await t.mutation(internal.stripeFeesStore.beginAttempt, {
				orderId, attempt: 1, attemptToken,
			});
			await expect(t.mutation(internal.stripeFeesStore.setFees, {
				orderId, stripeFees, stripeFeeCurrency: "usd",
				stripeFeeChargeId: "ch_invalid", stripeFeeBalanceTransactionId: "txn_invalid",
				attempt: 1, attemptToken,
			})).resolves.toBe(false);
		},
	);

	test("refuses incomplete provider provenance identifiers", async () => {
		const { t, orderId } = await seedOrder();
		await t.mutation(internal.stripeFeesStore.beginAttempt, {
			orderId, attempt: 1, attemptToken,
		});
		await expect(t.mutation(internal.stripeFeesStore.setFees, {
			orderId,
			stripeFees: 100,
			stripeFeeCurrency: "usd",
			stripeFeeChargeId: "ch_",
			stripeFeeBalanceTransactionId: "txn_",
			attempt: 1,
			attemptToken,
		})).resolves.toBe(false);
	});
});
