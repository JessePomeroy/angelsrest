/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const SECRET = "account-history-webhook-secret";
const SITE = "zippymiggy.com";
const ACCOUNT = "acct_original123456789";
const NEXT = "acct_successor12345678";
const PLATFORM = "acct_platform123456789";
const SESSION = "cs_test_original1234567890";
const PAYMENT = "pi_original1234567890";
const snapshot = {
	schemaVersion: 1 as const,
	catalogProvider: "convex" as const,
	items: [
		{
			productKey: "product",
			revisionId: "revision",
			productKind: "print" as const,
			variantKey: "variant",
			materialOptionKey: null,
			sizeOptionKey: null,
			borderOptionKey: null,
			frameOptionKey: null,
		},
	],
};

beforeEach(() => {
	vi.useFakeTimers();
	vi.stubEnv("WEBHOOK_SECRET", SECRET);
	vi.stubEnv("ORDER_PRODUCERS_STATE", "open");
});
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllEnvs();
});

async function setup() {
	const t = convexTest(schema, modules);
	await t.run(async (ctx) =>
		ctx.db.insert("platformClients", {
			name: "Hub",
			siteUrl: "angelsrest.online",
			email: "creator@example.com",
			adminEmails: ["creator@example.com"],
			role: "creator",
			tier: "full",
			subscriptionStatus: "active",
		}),
	);
	const admin = t.withIdentity({
		subject: "creator",
		email: "creator@example.com",
		emailVerified: true,
	});
	const clientId = await admin.mutation(api.platform.createClient, {
		name: "Client",
		siteUrl: SITE,
		email: "owner@example.com",
		adminEmails: ["owner@example.com"],
		tier: "full",
		subscriptionStatus: "active",
	});
	const beginArgs = {
		clientId,
		platformAccountId: PLATFORM,
		livemode: false,
		webhookSecret: SECRET,
	};
	const prepared = await admin.mutation(api.platform.beginStripeConnectAccount, beginArgs);
	const bindArgs = {
		...beginArgs,
		attemptId: prepared.attempt.id,
		stripeConnectedAccountId: ACCOUNT,
	};
	await admin.mutation(api.platform.bindStripeConnectAccount, bindArgs);
	const tenantId = prepared.tenantId;
	const orderArgs = {
		siteUrl: SITE,
		tenantId,
		stripeSessionId: SESSION,
		stripePaymentIntentId: PAYMENT,
		stripeConnectedAccountId: ACCOUNT,
		customerEmail: "customer@example.com",
		items: [{ productName: "Print", quantity: 1, price: 1500 }],
		total: 1500,
		fulfillmentType: "self" as const,
	};
	const orderId = await t.run(async (ctx) =>
		ctx.db.insert("orders", {
			...orderArgs,
			orderNumber: "ORDER-HISTORY",
			status: "new",
		}),
	);
	const replace = async () => {
		// Exercise the state a future verified replacement would leave; no public reset is added.
		await t.run(async (ctx) =>
			ctx.db.patch(clientId, {
				stripeConnectedAccountId: undefined,
				stripeConnectAttempt: undefined,
			}),
		);
		const next = await admin.mutation(api.platform.beginStripeConnectAccount, beginArgs);
		await admin.mutation(api.platform.bindStripeConnectAccount, {
			...beginArgs,
			attemptId: next.attempt.id,
			stripeConnectedAccountId: NEXT,
		});
	};
	return { t, admin, clientId, tenantId, orderId, orderArgs, bindArgs, replace };
}

test("repeated binding keeps one immutable ownership record", async () => {
	const s = await setup();
	const before = await s.t.run((ctx) => ctx.db.query("stripeAccountBindings").unique());
	await Promise.all([
		s.admin.mutation(api.platform.bindStripeConnectAccount, s.bindArgs),
		s.admin.mutation(api.platform.bindStripeConnectAccount, s.bindArgs),
	]);
	expect(await s.t.run((ctx) => ctx.db.query("stripeAccountBindings").unique())).toEqual(before);
});

test("old order replay and delayed fee reads retain their account after replacement", async () => {
	const s = await setup();
	await s.replace();
	expect(await s.t.query(api.platform.getStripeAccountForSite, { siteUrl: SITE })).toMatchObject({
		stripeConnectedAccountId: NEXT,
	});
	expect(
		await s.t.query(api.orders.resolveCheckoutRouting, {
			stripeSessionId: SESSION,
			stripeConnectedAccountId: ACCOUNT,
			stripeTenantMetadataSiteUrl: SITE,
			stripeTenantMetadataTenantId: s.tenantId,
			webhookSecret: SECRET,
		}),
	).toMatchObject({ source: "order", siteUrl: SITE, stripeConnectedAccountId: ACCOUNT });
	expect(
		await s.t.mutation(api.orders.create, { ...s.orderArgs, webhookSecret: SECRET }),
	).toMatchObject({ alreadyExisted: true, _id: s.orderId, stripeConnectedAccountId: ACCOUNT });
	expect(
		await s.t.query(internal.stripeFeesStore.getOrderForFees, { orderId: s.orderId }),
	).toMatchObject({ stripeConnectedAccountId: ACCOUNT, stripePaymentIntentId: PAYMENT });
	await expect(
		s.t.query(api.orders.resolveCheckoutRouting, {
			stripeSessionId: SESSION,
			stripeConnectedAccountId: NEXT,
			webhookSecret: SECRET,
		}),
	).rejects.toThrow("routing facts conflict");
});

function refundArgs() {
	return {
		webhookSecret: SECRET,
		stripeEventId: "evt_history1234567890",
		stripeRefundId: "re_history1234567890",
		stripeChargeId: "ch_history1234567890",
		stripeSessionId: SESSION,
		stripePaymentIntentId: PAYMENT,
		stripeConnectedAccountId: ACCOUNT,
		stripeTenantMetadataSiteUrl: SITE,
		siteUrl: SITE,
		refundAmount: 1500,
		sessionAmountTotal: 1500,
		refundCurrency: "usd" as const,
		sessionCurrency: "usd" as const,
		eventLivemode: false,
		sessionLivemode: false,
	};
}

test.each([SITE, "https://www.zippymiggy.com/", "https://www.renamed.example/"])("manual refund reconciliation retains historical ownership at %s", async storedSite => {
	const s = await setup();
	await s.replace();
	await s.t.run(ctx => ctx.db.patch(s.clientId, { siteUrl: storedSite }));
	expect(
		await s.t.mutation(api.orders.reconcileSucceededManualRefund, {
			...refundArgs(),
			stripeConnectedAccountId: NEXT,
		}),
	).toMatchObject({ kind: "rejected", reason: "identity_conflict" });
	expect(await s.t.mutation(api.orders.reconcileSucceededManualRefund, refundArgs())).toMatchObject(
		{ kind: "reconciled" },
	);
	expect(await s.t.run((ctx) => ctx.db.get(s.orderId))).toMatchObject({
		stripeConnectedAccountId: ACCOUNT,
		stripeRefundId: refundArgs().stripeRefundId,
	});
});

test.each([SITE, "https://www.zippymiggy.com/", "https://www.renamed.example/"])("automated refund status reconciles in the original account at %s", async storedSite => {
	const s = await setup();
	await s.t.run((ctx) =>
		ctx.db.patch(s.orderId, {
			status: "fulfillment_error",
			fulfillmentError: "Supplier rejected order",
			fulfillmentRecoveryStatus: "refund_pending",
			automatedRefundId: refundArgs().stripeRefundId,
			automatedRefundStatus: "pending",
		}),
	);
	await s.replace();
	await s.t.run(ctx => ctx.db.patch(s.clientId, { siteUrl: storedSite }));
	const { stripeChargeId: _charge, ...identity } = refundArgs();
	const result = await s.t.mutation(api.orders.reconcileAutomatedFulfillmentRefund, {
		...identity,
		stripeRefundStatus: "succeeded",
		metadataOrderNumber: "ORDER-HISTORY",
		automationTag: "fulfillment_recovery_v1",
	});
	expect(result).not.toMatchObject({ kind: "rejected" });
	expect(await s.t.run((ctx) => ctx.db.get(s.orderId))).toMatchObject({
		fulfillmentRecoveryStatus: "refunded",
		stripeConnectedAccountId: ACCOUNT,
	});
});

test("reserved sessions can bind after replacement but new reservations need the current account", async () => {
	const s = await setup();
	const reserve = {
		siteUrl: SITE,
		tenantId: s.tenantId,
		handleHash: "old-handle",
		snapshotDigest: "digest",
		snapshot,
		stripeConnectedAccountId: ACCOUNT,
	};
	expect(await s.t.mutation(internal.orders.reserveCheckoutSnapshot, reserve)).toMatchObject({
		outcome: "created",
	});
	await s.replace();
	expect(await s.t.mutation(internal.orders.reserveCheckoutSnapshot, reserve)).toMatchObject({
		outcome: "replayed",
	});
	expect(
		await s.t.mutation(internal.orders.bindCheckoutSnapshot, {
			siteUrl: SITE,
			tenantId: s.tenantId,
			handleHash: "old-handle",
			stripeConnectedAccountId: ACCOUNT,
			stripeSessionId: "cs_test_reserved123456789",
			stripeExpiresAt: Math.floor(Date.now() / 1000) + 3600,
		}),
	).toMatchObject({ outcome: "bound" });
	expect(
		await s.t.mutation(internal.orders.reserveCheckoutSnapshot, {
			...reserve,
			handleHash: "new-old-account",
		}),
	).toMatchObject({ outcome: "routing_mismatch" });
	expect(
		await s.t.mutation(internal.orders.reserveCheckoutSnapshot, {
			...reserve,
			handleHash: "new-current-account",
			stripeConnectedAccountId: NEXT,
		}),
	).toMatchObject({ outcome: "created" });
});

test("an old admission may replay, but historical ownership cannot admit a new checkout", async () => {
	const s = await setup();
	await s.t.run((ctx) =>
		ctx.db.insert("commercePurposeControls", {
			siteUrl: SITE,
			purpose: "new_order_admission",
			state: "open",
			generation: 1,
			acceptedHostGeneration: 1,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		}),
	);
	const args = {
		siteUrl: SITE,
		tenantId: s.tenantId,
		stripeConnectedAccountId: ACCOUNT,
		attemptDigest: "a".repeat(64),
		proofClass: "signed_bridge_body" as const,
		admissionHandleHash: "b".repeat(64),
		requestFingerprint: "c".repeat(64),
		activeLeaseTokenHash: "d".repeat(64),
		hostGeneration: 1,
	};
	const admitted = await s.t.mutation(internal.commerceClosure.beginCheckoutSessionAdmission, args);
	await s.replace();
	expect(
		await s.t.mutation(internal.commerceClosure.beginCheckoutSessionAdmission, args),
	).toMatchObject({ outcome: "replayed", admissionId: admitted.admissionId });
	await expect(
		s.t.mutation(internal.commerceClosure.beginCheckoutSessionAdmission, {
			...args,
			attemptDigest: "e".repeat(64),
		}),
	).rejects.toThrow("current Stripe account");
	expect(
		await s.t.mutation(internal.commerceClosure.beginCheckoutSessionAdmission, {
			...args,
			attemptDigest: "e".repeat(64),
			stripeConnectedAccountId: NEXT,
		}),
	).toMatchObject({ outcome: "created" });
});

test.each([
	"duplicate",
	"tenant",
	"missing-client",
	"different-current-owner",
])("fails closed on %s ownership", async (kind) => {
	const s = await setup();
	await s.t.run(async (ctx) => {
		const binding = await ctx.db.query("stripeAccountBindings").unique();
		if (!binding) throw new Error("Missing binding fixture");
		if (kind === "duplicate") {
			const { _id, _creationTime, ...record } = binding;
			await ctx.db.insert("stripeAccountBindings", record);
		} else if (kind === "tenant") {
			await ctx.db.patch(binding._id, { tenantId: "another-tenant" });
		} else if (kind === "missing-client") {
			await ctx.db.delete(s.clientId);
		} else {
			await ctx.db.patch(s.clientId, { stripeConnectedAccountId: undefined });
			await ctx.db.insert("platformClients", {
				name: "Other",
				siteUrl: "other.example",
				email: "other@example.com",
				adminEmails: [],
				tier: "full",
				subscriptionStatus: "none",
				stripeConnectedAccountId: ACCOUNT,
			});
		}
	});
	expect(
		await s.t.query(api.platform.getByStripeConnectedAccountId, {
			stripeConnectedAccountId: ACCOUNT,
			webhookSecret: SECRET,
		}),
	).toBeNull();
	await expect(
		s.t.query(api.orders.resolveCheckoutRouting, {
			stripeSessionId: SESSION,
			stripeConnectedAccountId: ACCOUNT,
			webhookSecret: SECRET,
		}),
	).rejects.toThrow();
});
