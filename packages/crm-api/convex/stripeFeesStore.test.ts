/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import { FEE_CAPTURE_RETRY_DELAY_MS } from "./helpers/stripeFeeCapture";
import schema from "./schema";
import { recordFeeCaptureRetry } from "./stripeFeesStore";

const modules = import.meta.glob("./**/*.ts");

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

		await t.mutation(internal.stripeFeesStore.beginAttempt, { orderId, attempt: 1 });

		const order = await t.run(async (ctx) => ctx.db.get(orderId));
		expect(order).toMatchObject({
			stripeFeeCaptureStatus: "pending",
			stripeFeeCaptureAttempts: 1,
			stripeFeeCaptureLastAttemptAt: expect.any(Number),
		});
		expect(order?.stripeFeeCaptureNextAttemptAt).toBeUndefined();
		expect(order?.stripeFeeCaptureError).toBeUndefined();
	});

	test("records retry visibility without making the attempt terminal", async () => {
		const { t, orderId } = await seedOrder();
		const nextAttemptAt = Date.now() + FEE_CAPTURE_RETRY_DELAY_MS;
		await t.mutation(internal.stripeFeesStore.beginAttempt, { orderId, attempt: 1 });

		await t.mutation(internal.stripeFeesStore.recordRetry, {
			orderId,
			attempt: 1,
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
		await t.mutation(internal.stripeFeesStore.beginAttempt, { orderId, attempt: 1 });
		const before = await t.run(async (ctx) => ctx.db.get(orderId));

		await expect(t.mutation(async (ctx) => await recordFeeCaptureRetry(
			ctx,
			{ orderId, attempt: 1, error: "stripe_api_error" },
			Number.POSITIVE_INFINITY,
		))).rejects.toThrow(/finite number/i);

		expect(await t.run(async (ctx) => ctx.db.get(orderId))).toEqual(before);
	});

	test("records captured fees and clears retry metadata", async () => {
		const { t, orderId } = await seedOrder();
		await t.mutation(internal.stripeFeesStore.recordRetry, {
			orderId,
			attempt: 1,
			error: "balance_transaction_not_ready",
		});

		await t.mutation(internal.stripeFeesStore.setFees, {
			orderId,
			stripeFees: 0,
			attempt: 2,
		});

		const order = await t.run(async (ctx) => ctx.db.get(orderId));
		expect(order).toMatchObject({
			stripeFees: 0,
			stripeFeeCaptureStatus: "captured",
			stripeFeeCaptureAttempts: 2,
		});
		expect(order?.stripeFeeCaptureNextAttemptAt).toBeUndefined();
		expect(order?.stripeFeeCaptureError).toBeUndefined();
	});

	test("records terminal failure and refuses to regress to pending", async () => {
		const { t, orderId } = await seedOrder();
		await t.mutation(internal.stripeFeesStore.recordFailure, {
			orderId,
			attempt: 3,
			error: "balance_transaction_not_ready",
		});

		const restarted = await t.mutation(internal.stripeFeesStore.beginAttempt, {
			orderId,
			attempt: 1,
		});
		const order = await t.run(async (ctx) => ctx.db.get(orderId));
		expect(restarted).toBe(false);
		expect(order).toMatchObject({
			stripeFeeCaptureStatus: "failed",
			stripeFeeCaptureAttempts: 3,
			stripeFeeCaptureError: "balance_transaction_not_ready",
		});
		expect(order?.stripeFeeCaptureNextAttemptAt).toBeUndefined();
	});
});
