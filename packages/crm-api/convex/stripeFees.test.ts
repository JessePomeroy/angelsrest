/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import { FEE_CAPTURE_RETRY_DELAY_MS } from "./helpers/stripeFeeCapture";
import schema from "./schema";

const { constructStripe, retrievePaymentIntent } = vi.hoisted(() => ({
	constructStripe: vi.fn(),
	retrievePaymentIntent: vi.fn(),
}));

vi.mock("stripe", () => ({
	default: class Stripe {
		paymentIntents = { retrieve: retrievePaymentIntent };

		constructor() {
			constructStripe();
		}
	},
}));

const modules = import.meta.glob("./**/*.ts");
const envNames = [
	"BETTER_AUTH_SECRET",
	"AUTH_GOOGLE_SECRET",
	"STRIPE_SECRET_KEY",
	"WEBHOOK_SECRET",
	"ORDER_LOOKUP_SECRET",
	"CATALOG_PRIVATE_ASSET_EDITOR_HOST_JOURNAL_SECRETS",
	"CATALOG_PRIVATE_ASSET_EDITOR_INSPECTION_CLAIM_SECRETS",
	"CATALOG_PRIVATE_EDITOR_UPLOAD_CONTROL_SECRETS",
	"CATALOG_PRIVATE_ASSET_STORAGE_RECEIPT_SECRETS",
	"CATALOG_PRIVATE_ASSET_INSPECTION_RECEIPT_SECRETS",
	"CMS_MEDIA_DELETION_COMPLETION_SECRETS",
] as const;
const previousEnv = new Map<string, string | undefined>();
const stripeSecret = "sk_test_fee-capture-authority-0123456789abcdef";
const authSecret = "fee-capture-auth-authority-0123456789abcdef";

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
	for (const name of envNames) previousEnv.set(name, process.env[name]);
	process.env.BETTER_AUTH_SECRET = authSecret;
	process.env.AUTH_GOOGLE_SECRET = "fee-capture-google-authority-0123456789abcdef";
	process.env.STRIPE_SECRET_KEY = stripeSecret;
	process.env.WEBHOOK_SECRET = "fee-capture-webhook-authority-0123456789abcdef";
	process.env.ORDER_LOOKUP_SECRET = "fee-capture-lookup-authority-0123456789abcdef";
	for (const name of envNames.slice(5)) delete process.env[name];
	constructStripe.mockReset();
	retrievePaymentIntent.mockReset();
	retrievePaymentIntent.mockResolvedValue({
		latest_charge: { balance_transaction: { fee: 321 } },
	});
	vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.useRealTimers();
	for (const name of envNames) {
		const value = previousEnv.get(name);
		if (value === undefined) delete process.env[name];
		else process.env[name] = value;
	}
	previousEnv.clear();
});

async function seedOrder() {
	const t = convexTest(schema, modules);
	const orderId = await t.run(async (ctx) =>
		ctx.db.insert("orders", {
			siteUrl: "tenant.example",
			orderNumber: "ORD-FEE-AUTHORITY",
			stripeSessionId: "cs_fee_authority",
			stripePaymentIntentId: "pi_fee_authority",
			customerEmail: "customer@example.com",
			items: [],
			total: 1000,
			fulfillmentType: "digital",
			status: "new",
			stripeFeeCaptureStatus: "pending",
			stripeFeeCaptureAttempts: 0,
			stripeFeeCaptureNextAttemptAt: Date.now(),
		}),
	);
	return { t, orderId };
}

describe("scheduled Stripe fee capture authority recovery", () => {
	test("fails closed, schedules a durable retry, and succeeds after configuration repair", async () => {
		const { t, orderId } = await seedOrder();
		process.env.BETTER_AUTH_SECRET = stripeSecret;

		await t.action(internal.stripeFees.captureFeesForOrder, { orderId });

		expect(constructStripe).not.toHaveBeenCalled();
		expect(retrievePaymentIntent).not.toHaveBeenCalled();
		expect(await t.run(async (ctx) => ctx.db.get(orderId))).toMatchObject({
			stripeFeeCaptureStatus: "pending",
			stripeFeeCaptureAttempts: 1,
			stripeFeeCaptureNextAttemptAt: Date.now() + FEE_CAPTURE_RETRY_DELAY_MS,
			stripeFeeCaptureError: "authority_configuration_invalid",
		});

		process.env.BETTER_AUTH_SECRET = authSecret;
		vi.advanceTimersByTime(FEE_CAPTURE_RETRY_DELAY_MS);
		await t.finishInProgressScheduledFunctions();

		expect(constructStripe).toHaveBeenCalledTimes(1);
		expect(retrievePaymentIntent).toHaveBeenCalledTimes(1);
		const repaired = await t.run(async (ctx) => ctx.db.get(orderId));
		expect(repaired).toMatchObject({
			stripeFees: 321,
			stripeFeeCaptureStatus: "captured",
			stripeFeeCaptureAttempts: 2,
		});
		expect(repaired?.stripeFeeCaptureNextAttemptAt).toBeUndefined();
		expect(repaired?.stripeFeeCaptureError).toBeUndefined();
	});

	test("exhausts the same bounded retries without Stripe or a stale next attempt", async () => {
		const { t, orderId } = await seedOrder();
		process.env.BETTER_AUTH_SECRET = stripeSecret;

		await t.action(internal.stripeFees.captureFeesForOrder, { orderId });
		await t.finishAllScheduledFunctions(vi.runAllTimers);

		expect(constructStripe).not.toHaveBeenCalled();
		expect(retrievePaymentIntent).not.toHaveBeenCalled();
		const exhausted = await t.run(async (ctx) => ctx.db.get(orderId));
		expect(exhausted).toMatchObject({
			stripeFeeCaptureStatus: "failed",
			stripeFeeCaptureAttempts: 3,
			stripeFeeCaptureError: "authority_configuration_invalid",
		});
		expect(exhausted?.stripeFeeCaptureNextAttemptAt).toBeUndefined();
	});
});
