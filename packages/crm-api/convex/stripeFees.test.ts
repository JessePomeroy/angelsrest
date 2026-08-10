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

		constructor(key: string, options: unknown) {
			constructStripe(key, options);
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
	"ORDER_PRODUCERS_STATE",
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
	process.env.ORDER_PRODUCERS_STATE = "open";
	constructStripe.mockReset();
	retrievePaymentIntent.mockReset();
	retrieveCheckoutSession.mockReset();
	retrievePaymentIntent.mockResolvedValue({
		object: "payment_intent",
		id: "pi_fee_authority",
		status: "succeeded",
		amount: 1000,
		amount_received: 1000,
		currency: "usd",
		livemode: false,
		metadata: { commerceTenantSiteUrl: "tenant.example" },
		latest_charge: {
			object: "charge",
			id: "ch_fee_authority",
			payment_intent: "pi_fee_authority",
			amount: 1000,
			amount_captured: 1000,
			amount_refunded: 0,
			paid: true,
			captured: true,
			refunded: false,
			currency: "usd",
			livemode: false,
			balance_transaction: {
				object: "balance_transaction",
				id: "txn_fee_authority",
				source: "ch_fee_authority",
				amount: 1000,
				net: 179,
				status: "pending",
				type: "charge",
				reporting_category: "charge",
				currency: "usd",
				fee: 821,
				fee_details: [
					{ type: "stripe_fee", amount: 321, currency: "usd" },
					{ type: "application_fee", amount: 500, currency: "usd" },
				],
			},
		},
	});
	retrieveCheckoutSession.mockResolvedValue({ status: "expired", payment_status: "unpaid" });
	vi.spyOn(console, "error").mockImplementation(() => undefined);
	vi.spyOn(console, "warn").mockImplementation(() => undefined);
	vi.spyOn(console, "log").mockImplementation(() => undefined);
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
			stripePaymentCurrency: "usd",
			stripePaymentLivemode: false,
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

		expect(constructStripe).toHaveBeenCalledOnce();
		expect(constructStripe).toHaveBeenCalledWith(stripeSecret, {
			apiVersion: "2026-01-28.clover",
		});
		expect(retrievePaymentIntent).toHaveBeenCalledTimes(1);
		const repaired = await t.run(async (ctx) => ctx.db.get(orderId));
		expect(repaired).toMatchObject({
			stripeFees: 321,
			stripeFeeCurrency: "usd",
			stripeFeeChargeId: "ch_fee_authority",
			stripeFeeBalanceTransactionId: "txn_fee_authority",
			stripeFeeProvenance: "provider_verified",
			stripeFeeProvenanceVersion: 1,
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

	test("uses the stored connected account and rejects a mismatched payment projection", async () => {
		const { t, orderId } = await seedOrder();
		await t.run((ctx) => ctx.db.patch(orderId, {
			stripeConnectedAccountId: "acct_fee_authority",
		}));
		retrievePaymentIntent.mockResolvedValueOnce({
			object: "payment_intent",
			id: "pi_fee_authority",
			status: "succeeded",
			amount: 1000,
			amount_received: 999,
			currency: "usd",
			livemode: false,
			metadata: { commerceTenantSiteUrl: "tenant.example" },
			latest_charge: null,
		});

		await t.action(internal.stripeFees.captureFeesForOrder, { orderId });

		expect(retrievePaymentIntent).toHaveBeenCalledWith(
			"pi_fee_authority",
			{ expand: ["latest_charge.balance_transaction"] },
			{ stripeAccount: "acct_fee_authority" },
		);
		expect(await t.run((ctx) => ctx.db.get(orderId))).toMatchObject({
			stripeFeeCaptureStatus: "failed",
			stripeFeeCaptureError: "payment_projection_invalid",
		});
	});

	test("fails a legacy missing projection before crossing the Stripe boundary", async () => {
		const { t, orderId } = await seedOrder();
		await t.run((ctx) => ctx.db.patch(orderId, {
			stripePaymentCurrency: undefined,
			stripePaymentLivemode: undefined,
		}));

		await t.action(internal.stripeFees.captureFeesForOrder, { orderId });

		expect(constructStripe).not.toHaveBeenCalled();
		expect(retrievePaymentIntent).not.toHaveBeenCalled();
		expect(await t.run((ctx) => ctx.db.get(orderId))).toMatchObject({
			stripeFeeCaptureStatus: "failed",
			stripeFeeCaptureError: "payment_projection_invalid",
		});
	});

	test.each([
		["id", "pi_otherprovidervalue"],
		["currency", "eur"],
		["livemode", true],
		["metadata", { commerceTenantSiteUrl: "other.example" }],
	] as const)("rejects a provider payment %s mismatch", async (field, value) => {
		const { t, orderId } = await seedOrder();
		const complete = await retrievePaymentIntent();
		retrievePaymentIntent.mockClear();
		retrievePaymentIntent.mockResolvedValueOnce({
			...complete,
			[field]: value,
		});

		await t.action(internal.stripeFees.captureFeesForOrder, { orderId });

			expect(await t.run((ctx) => ctx.db.get(orderId))).toMatchObject({
				stripeFeeCaptureStatus: "failed",
				stripeFeeCaptureError: "payment_projection_invalid",
			});
	});

	test("accepts normalized-equivalent signed tenant routing", async () => {
		const { t, orderId } = await seedOrder();
		await t.run((ctx) => ctx.db.patch(orderId, {
			siteUrl: "https://www.tenant.example/path/",
		}));

		await t.action(internal.stripeFees.captureFeesForOrder, { orderId });

		expect(await t.run((ctx) => ctx.db.get(orderId))).toMatchObject({
			stripeFees: 321,
			stripeFeeCaptureStatus: "captured",
			stripeFeeProvenance: "provider_verified",
		});
	});

	test.each([
		["amount", 999],
		["amount_captured", 999],
		["currency", "eur"],
	] as const)("rejects a latest-charge %s mismatch", async (field, value) => {
		const { t, orderId } = await seedOrder();
		const complete = await retrievePaymentIntent();
		retrievePaymentIntent.mockClear();
		retrievePaymentIntent.mockResolvedValueOnce({
			...complete,
			latest_charge: {
				...complete.latest_charge,
				[field]: value,
			},
		});

		await t.action(internal.stripeFees.captureFeesForOrder, { orderId });

		expect(await t.run((ctx) => ctx.db.get(orderId))).toMatchObject({
			stripeFeeCaptureStatus: "failed",
			stripeFeeCaptureError: "provider_object_mismatch",
		});
	});

	test("isolates the Stripe processing component on a connected direct charge", async () => {
		const { t, orderId } = await seedOrder();
		await t.run((ctx) => ctx.db.patch(orderId, {
			stripeConnectedAccountId: "acct_fee_authority",
		}));

		await t.action(internal.stripeFees.captureFeesForOrder, { orderId });

		expect(retrievePaymentIntent).toHaveBeenCalledWith(
			"pi_fee_authority",
			{ expand: ["latest_charge.balance_transaction"] },
			{ stripeAccount: "acct_fee_authority" },
		);
		const stored = await t.run((ctx) => ctx.db.get(orderId));
		expect(stored).toMatchObject({
			stripeFees: 321,
			stripeFeeCaptureStatus: "captured",
			stripeFeeProvenance: "provider_verified",
		});
		expect(stored?.stripeFees).not.toBe(821);
		expect(stored?.stripeFees).not.toBe(500);
	});

	test("stores an authoritative zero processing fee as captured rather than unknown", async () => {
		const { t, orderId } = await seedOrder();
		const complete = await retrievePaymentIntent();
		retrievePaymentIntent.mockClear();
		retrievePaymentIntent.mockResolvedValueOnce({
			...complete,
			latest_charge: {
				...complete.latest_charge,
				balance_transaction: {
					...complete.latest_charge.balance_transaction,
					fee: 0,
					net: 1000,
					fee_details: [
						{ type: "stripe_fee", amount: 0, currency: "usd" },
					],
				},
			},
		});

		await t.action(internal.stripeFees.captureFeesForOrder, { orderId });

		expect(await t.run((ctx) => ctx.db.get(orderId))).toMatchObject({
			stripeFees: 0,
			stripeFeeCurrency: "usd",
			stripeFeeCaptureStatus: "captured",
			stripeFeeProvenance: "provider_verified",
		});
	});

	test("captures the original-charge fee even if Stripe reports a later refund", async () => {
		const { t, orderId } = await seedOrder();
		const complete = await retrievePaymentIntent();
		retrievePaymentIntent.mockClear();
		retrievePaymentIntent.mockResolvedValueOnce({
			...complete,
			latest_charge: {
				...complete.latest_charge,
				amount_refunded: 1000,
				refunded: true,
			},
		});

		await t.action(internal.stripeFees.captureFeesForOrder, { orderId });

		expect(await t.run((ctx) => ctx.db.get(orderId))).toMatchObject({
			stripeFees: 321,
			stripeFeeCaptureStatus: "captured",
			stripeFeeProvenance: "provider_verified",
		});
	});

	test("accepts an authoritative negative balance-transaction net", async () => {
		const { t, orderId } = await seedOrder();
		const complete = await retrievePaymentIntent();
		retrievePaymentIntent.mockClear();
		retrievePaymentIntent.mockResolvedValueOnce({
			...complete,
			latest_charge: {
				...complete.latest_charge,
				balance_transaction: {
					...complete.latest_charge.balance_transaction,
					fee: 1200,
					net: -200,
					fee_details: [
						{ type: "stripe_fee", amount: 700, currency: "usd" },
						{ type: "application_fee", amount: 500, currency: "usd" },
					],
				},
			},
		});

		await t.action(internal.stripeFees.captureFeesForOrder, { orderId });

		expect(await t.run((ctx) => ctx.db.get(orderId))).toMatchObject({
			stripeFees: 700,
			stripeFeeCaptureStatus: "captured",
			stripeFeeProvenance: "provider_verified",
		});
	});

	test("rejects a same-currency balance transaction with a different gross amount", async () => {
		const { t, orderId } = await seedOrder();
		const complete = await retrievePaymentIntent();
		retrievePaymentIntent.mockClear();
		retrievePaymentIntent.mockResolvedValueOnce({
			...complete,
			latest_charge: {
				...complete.latest_charge,
				balance_transaction: {
					...complete.latest_charge.balance_transaction,
					amount: 999,
					net: 178,
				},
			},
		});

		await t.action(internal.stripeFees.captureFeesForOrder, { orderId });

		const stored = await t.run((ctx) => ctx.db.get(orderId));
		expect(stored).toMatchObject({
			stripeFeeCaptureStatus: "failed",
			stripeFeeCaptureError: "provider_object_mismatch",
		});
		expect(stored?.stripeFees).toBeUndefined();
	});

	test("makes a preexisting recorded fee terminal before crossing the provider boundary", async () => {
		const { t, orderId } = await seedOrder();
		await t.run((ctx) => ctx.db.patch(orderId, {
			stripeFees: 777,
			stripeFeeCurrency: "usd",
			stripeFeeCaptureStatus: "legacy_unverified",
			stripeFeeProvenance: "legacy_unverified",
		}));

		await t.action(internal.stripeFees.captureFeesForOrder, { orderId });

		expect(constructStripe).not.toHaveBeenCalled();
		expect(retrievePaymentIntent).not.toHaveBeenCalled();
		expect(await t.run((ctx) => ctx.db.get(orderId))).toMatchObject({
			stripeFees: 777,
			stripeFeeCaptureStatus: "legacy_unverified",
			stripeFeeProvenance: "legacy_unverified",
		});
	});

	test("keeps a processing payment pending and captures after it succeeds", async () => {
		const { t, orderId } = await seedOrder();
		retrievePaymentIntent.mockResolvedValueOnce({
			object: "payment_intent",
			id: "pi_fee_authority",
			status: "processing",
			amount: 1000,
			amount_received: 0,
			currency: "usd",
			livemode: false,
			metadata: { commerceTenantSiteUrl: "tenant.example" },
			latest_charge: null,
		});

		await t.action(internal.stripeFees.captureFeesForOrder, { orderId });
		expect(await t.run((ctx) => ctx.db.get(orderId))).toMatchObject({
			stripeFeeCaptureStatus: "pending",
			stripeFeeCaptureAttempts: 1,
			stripeFeeCaptureError: "payment_not_ready",
		});

		vi.advanceTimersByTime(FEE_CAPTURE_RETRY_DELAY_MS);
		await t.finishInProgressScheduledFunctions();
		expect(await t.run((ctx) => ctx.db.get(orderId))).toMatchObject({
			stripeFees: 321,
			stripeFeeCaptureStatus: "captured",
			stripeFeeCaptureAttempts: 2,
		});
	});

	test("retries an incomplete fee breakdown without treating aggregate fees as processing fees", async () => {
		const { t, orderId } = await seedOrder();
		const complete = await retrievePaymentIntent();
		retrievePaymentIntent.mockClear();
		retrievePaymentIntent.mockResolvedValueOnce({
			...complete,
			latest_charge: {
				...complete.latest_charge,
				balance_transaction: {
					...complete.latest_charge.balance_transaction,
					fee_details: [
						{ type: "stripe_fee", amount: 321, currency: "usd" },
					],
				},
			},
		});

		await t.action(internal.stripeFees.captureFeesForOrder, { orderId });
		const pending = await t.run((ctx) => ctx.db.get(orderId));
		expect(pending?.stripeFees).toBeUndefined();
		expect(pending).toMatchObject({
			stripeFeeCaptureStatus: "pending",
			stripeFeeCaptureError: "fee_breakdown_not_ready",
		});

		vi.advanceTimersByTime(FEE_CAPTURE_RETRY_DELAY_MS);
		await t.finishInProgressScheduledFunctions();
		expect(await t.run((ctx) => ctx.db.get(orderId))).toMatchObject({
			stripeFees: 321,
			stripeFeeCaptureStatus: "captured",
			stripeFeeCaptureAttempts: 2,
		});
	});

	test("rejects a mismatched charge or balance-transaction chain without storing a fee", async () => {
		const { t, orderId } = await seedOrder();
		retrievePaymentIntent.mockResolvedValueOnce({
			object: "payment_intent",
			id: "pi_fee_authority",
			status: "succeeded",
			amount: 1000,
			amount_received: 1000,
			currency: "usd",
			livemode: false,
			metadata: { commerceTenantSiteUrl: "tenant.example" },
			latest_charge: {
				object: "charge",
				id: "ch_fee_authority",
				payment_intent: "pi_other",
				paid: true,
				captured: true,
				currency: "usd",
				livemode: false,
				balance_transaction: null,
			},
		});

		await t.action(internal.stripeFees.captureFeesForOrder, { orderId });

		const order = await t.run((ctx) => ctx.db.get(orderId));
		expect(order?.stripeFees).toBeUndefined();
		expect(order).toMatchObject({
			stripeFeeCaptureStatus: "failed",
			stripeFeeCaptureError: "provider_object_mismatch",
		});
		const logs = JSON.stringify([
			...vi.mocked(console.error).mock.calls,
			...vi.mocked(console.warn).mock.calls,
			...vi.mocked(console.log).mock.calls,
		]);
		expect(logs).not.toContain("ORD-FEE-AUTHORITY");
		expect(logs).not.toContain("pi_fee_authority");
		expect(logs).not.toContain("ch_fee_authority");
	});

	test("normalizes Stripe API failures without logging sensitive provider details", async () => {
		const { t, orderId } = await seedOrder();
		await t.run((ctx) => ctx.db.patch(orderId, {
			stripeConnectedAccountId: "acct_fee_authority",
		}));
		const sensitiveProviderError = [
			"raw provider failure",
			stripeSecret,
			"acct_fee_authority",
			"pi_fee_authority",
			"ORD-FEE-AUTHORITY",
			"tenant.example",
			"321",
		].join(" ");
		retrievePaymentIntent.mockRejectedValueOnce(new Error(sensitiveProviderError));

		await t.action(internal.stripeFees.captureFeesForOrder, { orderId });

		expect(retrievePaymentIntent).toHaveBeenCalledWith(
			"pi_fee_authority",
			{ expand: ["latest_charge.balance_transaction"] },
			{ stripeAccount: "acct_fee_authority" },
		);
		expect(await t.run((ctx) => ctx.db.get(orderId))).toMatchObject({
			stripeFeeCaptureStatus: "pending",
			stripeFeeCaptureError: "stripe_api_error",
		});
		expect(console.error).toHaveBeenCalledWith("stripe_fee_capture.stripe_api_error");
		const logs = JSON.stringify([
			...vi.mocked(console.error).mock.calls,
			...vi.mocked(console.warn).mock.calls,
			...vi.mocked(console.log).mock.calls,
		]);
		for (const sensitiveFragment of sensitiveProviderError.split(" ")) {
			expect(logs).not.toContain(sensitiveFragment);
		}
	});
	});

describe("bound checkout snapshot paid-safe reconciliation", () => {
	test("does not cross the provider boundary before the scheduled time", async () => {
		const { t, row } = await seedBoundReservation();
		await t.run((ctx) => ctx.db.patch(row._id, {
			reconciliationNextAt: Date.now() + 8 * 60 * 60 * 1000,
		}));

		await t.action(internal.stripeFees.reconcileCheckoutSnapshotReservation, {
			reservationId: row._id,
			boundAt: row.boundAt!,
			attempt: 0,
		});

		expect(retrieveCheckoutSession).not.toHaveBeenCalled();
		expect(await t.run((ctx) => ctx.db.get(row._id))).not.toBeNull();
	});

	test("makes deleted-row scheduled work a provider no-op", async () => {
		const { t, row } = await seedBoundReservation();
		await t.run((ctx) => ctx.db.delete(row._id));

		await t.action(internal.stripeFees.reconcileCheckoutSnapshotReservation, {
			reservationId: row._id,
			boundAt: row.boundAt!,
			attempt: 0,
		});

		expect(retrieveCheckoutSession).not.toHaveBeenCalled();
	});

	test("deletes only after Stripe confirms expired and unpaid", async () => {
		const { t, row } = await seedBoundReservation();
		await t.action(internal.stripeFees.reconcileCheckoutSnapshotReservation, {
			reservationId: row._id, boundAt: row.boundAt!, attempt: 0,
		});
		expect(await t.run((ctx) => ctx.db.get(row._id))).toBeNull();
		expect(constructStripe).toHaveBeenCalledWith(stripeSecret, {
			apiVersion: "2026-01-28.clover",
		});
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
