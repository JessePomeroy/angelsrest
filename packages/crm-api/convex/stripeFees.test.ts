/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import { FEE_CAPTURE_RETRY_DELAY_MS } from "./helpers/stripeFeeCapture";
import schema from "./schema";

const { constructStripe, retrievePaymentIntent, retrieveCheckoutSession } = vi.hoisted(() => ({
	constructStripe: vi.fn(),
	retrievePaymentIntent: vi.fn(),
	retrieveCheckoutSession: vi.fn(),
}));

vi.mock("stripe", () => ({
	default: class Stripe {
		paymentIntents = { retrieve: retrievePaymentIntent };
		checkout = { sessions: { retrieve: retrieveCheckoutSession } };

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
	"CHECKOUT_SNAPSHOT_RESERVATION_SECRETS",
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
	retrieveCheckoutSession.mockReset();
	retrievePaymentIntent.mockResolvedValue({
		latest_charge: { balance_transaction: { fee: 321 } },
	});
	retrieveCheckoutSession.mockResolvedValue({ status: "expired", payment_status: "unpaid" });
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

const reservationSnapshot = {
	schemaVersion: 1 as const,
	catalogProvider: "convex" as const,
	items: [{
		productKey: "product", revisionId: "revision", productKind: "digital_download" as const,
		variantKey: null, materialOptionKey: null, sizeOptionKey: null,
		borderOptionKey: null, frameOptionKey: null,
	}],
};

async function seedBoundReservation() {
	const t = convexTest(schema, modules);
	await t.mutation(internal.orders.reserveCheckoutSnapshot, {
		siteUrl: "tenant.example", handleHash: "1".repeat(64), snapshotDigest: "2".repeat(64),
		snapshot: reservationSnapshot,
	});
	await t.mutation(internal.orders.bindCheckoutSnapshot, {
		siteUrl: "tenant.example", handleHash: "1".repeat(64),
		stripeSessionId: "cs_test_1234567890reservation", stripeExpiresAt: Math.floor(Date.now() / 1000) + 3600,
	});
	const row = (await t.run((ctx) => ctx.db.query("checkoutSnapshotReservations").take(1)))[0]!;
	await t.run((ctx) => ctx.db.patch(row._id, { reconciliationNextAt: Date.now() }));
	return { t, row };
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

describe("bound checkout snapshot paid-safe reconciliation", () => {
	test("deletes only after Stripe confirms expired and unpaid", async () => {
		const { t, row } = await seedBoundReservation();
		await t.action(internal.stripeFees.reconcileCheckoutSnapshotReservation, {
			reservationId: row._id, boundAt: row.boundAt!, attempt: 0,
		});
		expect(await t.run((ctx) => ctx.db.get(row._id))).toBeNull();
	});

	test("retains paid evidence, alerts without content, and makes stale jobs no-op", async () => {
		const { t, row } = await seedBoundReservation();
		retrieveCheckoutSession.mockResolvedValue({ status: "complete", payment_status: "paid" });
		await t.action(internal.stripeFees.reconcileCheckoutSnapshotReservation, {
			reservationId: row._id, boundAt: row.boundAt!, attempt: 0,
		});
		const retained = await t.run((ctx) => ctx.db.get(row._id));
		expect(retained?.reconciliationAlertedAt).toBe(Date.now());
		expect(console.error).toHaveBeenCalledWith("checkout_snapshot_reservation.paid_without_order");
		expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("cs_test_1234567890reservation");
		await t.action(internal.stripeFees.reconcileCheckoutSnapshotReservation, {
			reservationId: row._id, boundAt: row.boundAt!, attempt: 0,
		});
		expect(retrieveCheckoutSession).toHaveBeenCalledTimes(1);
	});

	test("discards an unverified provider identity after the bounded retry ladder", async () => {
		const { t, row } = await seedBoundReservation();
		retrieveCheckoutSession.mockRejectedValue(new Error("provider unavailable"));
		await t.action(internal.stripeFees.reconcileCheckoutSnapshotReservation, {
			reservationId: row._id, boundAt: row.boundAt!, attempt: 0,
		});
		await t.finishAllScheduledFunctions(vi.runAllTimers);
		expect(await t.run((ctx) => ctx.db.get(row._id))).toBeNull();
		expect(console.error).not.toHaveBeenCalledWith(
			"checkout_snapshot_reservation.reconciliation_uncertain",
		);
	});

	test("retains uncertainty indefinitely only after Stripe verifies the session identity", async () => {
		const { t, row } = await seedBoundReservation();
		retrieveCheckoutSession
			.mockResolvedValueOnce({ status: "open", payment_status: "unpaid" })
			.mockRejectedValue(new Error("provider unavailable"));
		await t.action(internal.stripeFees.reconcileCheckoutSnapshotReservation, {
			reservationId: row._id, boundAt: row.boundAt!, attempt: 0,
		});
		await t.finishAllScheduledFunctions(vi.runAllTimers);
		const retained = await t.run((ctx) => ctx.db.get(row._id));
		expect(retained).toMatchObject({
			reconciliationAttempt: 3,
			reconciliationProviderVerifiedAt: expect.any(Number),
			reconciliationAlertedAt: Date.now(),
		});
		expect(console.error).toHaveBeenCalledWith(
			"checkout_snapshot_reservation.reconciliation_uncertain",
		);
		expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("provider unavailable");
	});
});
