/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const WEBHOOK_SECRET = "test-webhook-secret";
const ORDER_LOOKUP_SECRET = "test-order-lookup-secret";
const SITE_URL = "tenant-a.example";
const CLAIM_TOKEN_A = "123e4567-e89b-42d3-a456-426614174000";
const CLAIM_TOKEN_B = "123e4567-e89b-42d3-a456-426614174001";

beforeEach(() => {
	process.env.WEBHOOK_SECRET = WEBHOOK_SECRET;
	process.env.ORDER_LOOKUP_SECRET = ORDER_LOOKUP_SECRET;
});

afterEach(() => {
	delete process.env.WEBHOOK_SECRET;
	delete process.env.ORDER_LOOKUP_SECRET;
});

const checkoutSnapshot = {
	schemaVersion: 1 as const,
	catalogProvider: "sanity" as const,
	items: [
		{
			productKey: "sanity.catalog.print-one",
			revisionId: "immutable-revision-1",
			productKind: "print" as const,
			variantKey: "matte-8x10",
			materialOptionKey: "archival-matte",
			sizeOptionKey: "8x10",
			borderOptionKey: null,
			frameOptionKey: "none",
		},
		{
			productKey: "sanity.catalog.download-one",
			revisionId: "immutable-revision-2",
			productKind: "digital_download" as const,
			variantKey: null,
		},
	],
};

function orderArgs(stripeSessionId: string) {
	return {
		siteUrl: SITE_URL,
		webhookSecret: WEBHOOK_SECRET,
		stripeSessionId,
		customerEmail: "buyer@example.com",
		items: [{ productName: "Paid name", quantity: 2, price: 4200 }],
		total: 8400,
		fulfillmentType: "lumaprints" as const,
	};
}

const MANUAL_REFUND = {
	event: "evt_1234567890abcdef",
	refund: "re_1234567890abcdef",
	otherRefund: "re_abcdef1234567890",
	charge: "ch_1234567890abcdef",
	paymentIntent: "pi_1234567890abcdef",
	session: "cs_test_1234567890abcdef",
	account: "acct_1234567890abcdef",
};

function manualRefundArgs(overrides: Record<string, unknown> = {}) {
	return {
		webhookSecret: WEBHOOK_SECRET,
		stripeEventId: MANUAL_REFUND.event,
		stripeRefundId: MANUAL_REFUND.refund,
		stripeChargeId: MANUAL_REFUND.charge,
		stripeSessionId: MANUAL_REFUND.session,
		stripePaymentIntentId: MANUAL_REFUND.paymentIntent,
		siteUrl: SITE_URL,
		refundAmount: 8400,
		sessionAmountTotal: 8400,
		refundCurrency: "usd" as const,
		sessionCurrency: "usd" as const,
		eventLivemode: false,
		sessionLivemode: false,
		...overrides,
	};
}

async function seedLumaPrintsOrder() {
	const t = convexTest(schema, modules);
	const created = await t.mutation(api.orders.create, {
		siteUrl: SITE_URL,
		webhookSecret: WEBHOOK_SECRET,
		stripeSessionId: "cs_test_order",
		customerEmail: "customer@example.com",
		customerName: "Customer Name",
		items: [{ productName: "Test print", quantity: 1, price: 42 }],
		total: 42,
		fulfillmentType: "lumaprints",
	});
	await t.mutation(api.orders.updateStatus, {
		orderId: created._id,
		webhookSecret: WEBHOOK_SECRET,
		status: "printing",
		lumaprintsOrderNumber: "LP-123",
	});
	return { t, orderId: created._id };
}

describe("durable checkout snapshot", () => {
	test("keeps legacy rows absent and never backfills them on retry", async () => {
		const t = convexTest(schema, modules);
		const created = await t.mutation(api.orders.create, orderArgs("cs_legacy"));
		const before = await t.run((ctx) => ctx.db.get(created._id));
		expect(created.checkoutSnapshot).toBeUndefined();
		expect(before?.checkoutSnapshot).toBeUndefined();
		const retry = await t.mutation(api.orders.create, {
			...orderArgs("cs_legacy"),
			checkoutSnapshot,
		});
		expect(retry.checkoutSnapshot).toBeUndefined();
		expect(await t.run((ctx) => ctx.db.get(created._id))).toEqual(before);
	});

	test("persists the ordered snapshot exactly once across changed and absent retries", async () => {
		const t = convexTest(schema, modules);
		const created = await t.mutation(api.orders.create, {
			...orderArgs("cs_snapshot"),
			checkoutSnapshot,
		});
		const stored = await t.run((ctx) => ctx.db.get(created._id));
		expect(created.checkoutSnapshot).toEqual(checkoutSnapshot);
		expect(stored?.checkoutSnapshot).toEqual(checkoutSnapshot);

		const changed = {
			...checkoutSnapshot,
			catalogProvider: "convex" as const,
			items: [...checkoutSnapshot.items].reverse(),
		};
		for (const candidate of [changed, undefined]) {
			const retry = await t.mutation(api.orders.create, {
				...orderArgs("cs_snapshot"),
				checkoutSnapshot: candidate,
			});
			expect(retry.checkoutSnapshot).toEqual(checkoutSnapshot);
			expect(await t.run((ctx) => ctx.db.get(created._id))).toEqual(stored);
		}
	});

	test.each([
		["version", { ...checkoutSnapshot, schemaVersion: 2 }],
		["provider", { ...checkoutSnapshot, catalogProvider: "shadow" }],
		["kind", { ...checkoutSnapshot, items: [{ ...checkoutSnapshot.items[0], productKind: "book" }] }],
		["paid field", { ...checkoutSnapshot, items: [{ ...checkoutSnapshot.items[0], amount: 4200 }] }],
	])("rejects an invalid external %s shape", async (_label, candidate) => {
		const t = convexTest(schema, modules);
		await expect(t.mutation(api.orders.create, {
			...orderArgs(`cs_invalid_${_label}`),
			checkoutSnapshot: candidate,
		} as never)).rejects.toThrow();
	});
});

describe("print fulfillment fence", () => {
	test("uses global session IDs and makes claim/recovery CAS mutually exclusive", async () => {
		const t = convexTest(schema, modules);
		const create = (session: string, siteUrl = SITE_URL) => t.mutation(api.orders.create, {
			...orderArgs(session), siteUrl, orderNumber: "ORD-SAME",
		});
		const first = await create("cs_test_tenantAglobal1234");
		const second = await create("cs_test_tenantBglobal1234", "tenant-b.example");
		const claim = (orderId: typeof first._id) =>
			t.mutation(api.orders.claimPrintFulfillment, {
				orderId, webhookSecret: WEBHOOK_SECRET,
			});
		const duplicate = await Promise.all([claim(first._id), claim(first._id)]);
		expect(duplicate.map(({ kind }) => kind).sort()).toEqual(["claimed", "reconcile"]);
		expect(duplicate.every((result) => result.externalId === "cs_test_tenantAglobal1234")).toBe(true);
		await expect(claim(second._id)).resolves.toMatchObject({
			kind: "claimed", externalId: "cs_test_tenantBglobal1234",
		});
		for (const transition of [
			{ status: "refunded" }, { stripeRefundId: "re_test" },
			{ fulfillmentRecoveryStatus: "refund_pending" },
			{ fulfillmentRecoveryStatus: "refunded" },
		] as const) await expect(t.mutation(api.orders.updateStatus, {
			orderId: first._id, webhookSecret: WEBHOOK_SECRET, ...transition,
		})).rejects.toThrow("submission is in progress");

		const recovered = await create("cs_test_recoveryfirst1234");
		await t.mutation(api.orders.updateStatus, {
			orderId: recovered._id, webhookSecret: WEBHOOK_SECRET,
			status: "fulfillment_error", fulfillmentRecoveryStatus: "refund_pending",
		});
		await expect(claim(recovered._id)).resolves.toEqual({ kind: "busy" });

		const raced = await create("cs_test_concurrentcas1234");
		const [claimResult, recoveryResult] = await Promise.allSettled([
			claim(raced._id),
			t.mutation(api.orders.updateStatus, {
				orderId: raced._id, webhookSecret: WEBHOOK_SECRET,
				status: "fulfillment_error", fulfillmentRecoveryStatus: "refund_pending",
			}),
		]);
		const stored = await t.run((ctx) => ctx.db.get(raced._id));
		if (recoveryResult.status === "fulfilled") {
			expect(claimResult).toMatchObject({ status: "fulfilled", value: { kind: "busy" } });
			expect(stored).toMatchObject({ fulfillmentRecoveryStatus: "refund_pending" });
			expect(stored?.printFulfillmentClaim).toBeUndefined();
		} else {
			expect(claimResult).toMatchObject({ status: "fulfilled", value: { kind: "claimed" } });
			expect(stored?.printFulfillmentClaim).toBe(true);
			expect(stored?.fulfillmentRecoveryStatus).toBeUndefined();
		}
	});
});

describe("provider-authoritative manual refunds", () => {
	test("reconciles once, blocks paid access, and leaves the bound reservation unchanged", async () => {
		const t = convexTest(schema, modules);
		const created = await t.mutation(api.orders.create, {
			...orderArgs(MANUAL_REFUND.session),
			stripePaymentIntentId: MANUAL_REFUND.paymentIntent,
		});
		const reservationId = await t.run((ctx) =>
			ctx.db.insert("checkoutSnapshotReservations", {
				state: "bound",
				siteUrl: SITE_URL,
				handleHash: "hash",
				snapshotDigest: "digest",
				snapshot: {
					schemaVersion: 1,
					catalogProvider: "sanity",
					items: [{
						productKey: "print-one",
						revisionId: "revision-one",
						productKind: "print",
						variantKey: "8x10",
						materialOptionKey: "matte",
						sizeOptionKey: "8x10",
						borderOptionKey: null,
						frameOptionKey: null,
					}],
				},
				accountScope: "platform",
				stripeSessionId: MANUAL_REFUND.session,
				stripeExpiresAt: 1_800_000_000,
				unboundPurgeAt: 1_800_000_000_000,
				boundReconcileAt: 1_900_000_000_000,
				createdAt: 1,
				updatedAt: 2,
				boundAt: 2,
				reconciliationAttempt: 0,
				reconciliationNextAt: 1_900_000_000_000,
			}),
		);
		const reservationBefore = await t.run((ctx) => ctx.db.get(reservationId));

		await expect(
			t.mutation(api.orders.reconcileSucceededManualRefund, manualRefundArgs()),
		).resolves.toEqual({ kind: "reconciled" });
		const stored = await t.run((ctx) => ctx.db.get(created._id));
		expect(stored).toMatchObject({
			status: "refunded",
			stripeRefundId: MANUAL_REFUND.refund,
			stripeFeeCaptureStatus: "canceled",
		});
		expect(stored?.fulfillmentRecoveryStatus).toBeUndefined();
		expect(await t.run((ctx) => ctx.db.get(reservationId))).toEqual(reservationBefore);
		await expect(
			t.query(api.orders.resolvePaidDownloadOrder, {
				stripeSessionId: MANUAL_REFUND.session,
				webhookSecret: WEBHOOK_SECRET,
			}),
		).resolves.toMatchObject({ refunded: true });

		await expect(
			t.mutation(api.orders.reconcileSucceededManualRefund, manualRefundArgs()),
		).resolves.toEqual({ kind: "replayed" });
		await expect(t.mutation(api.orders.claimPrintFulfillment, {
			orderId: created._id,
			webhookSecret: WEBHOOK_SECRET,
		})).resolves.toEqual({ kind: "busy" });
		await expect(
			t.mutation(
				api.orders.reconcileSucceededManualRefund,
				manualRefundArgs({ stripeRefundId: MANUAL_REFUND.otherRefund }),
			),
		).resolves.toEqual({ kind: "rejected", reason: "identity_conflict" });
		expect(await t.run((ctx) => ctx.db.get(created._id))).toEqual(stored);
	});

	test("preserves terminal fee-capture diagnostics during reconciliation", async () => {
		const t = convexTest(schema, modules);
		const created = await t.mutation(api.orders.create, {
			...orderArgs(MANUAL_REFUND.session),
			stripePaymentIntentId: MANUAL_REFUND.paymentIntent,
		});
		await t.run((ctx) => ctx.db.patch(created._id, {
			stripeFeeCaptureStatus: "failed",
			stripeFeeCaptureError: "stripe_api_error",
			stripeFeeCaptureNextAttemptAt: undefined,
		}));

		await expect(t.mutation(api.orders.reconcileSucceededManualRefund, manualRefundArgs()))
			.resolves.toEqual({ kind: "reconciled" });
		expect(await t.run((ctx) => ctx.db.get(created._id))).toMatchObject({
			status: "refunded",
			stripeFeeCaptureStatus: "failed",
			stripeFeeCaptureError: "stripe_api_error",
		});
	});

	test("fences connected accounts and permits the explicit legacy identity bridge", async () => {
		for (const storesProviderIds of [true, false]) {
			const t = convexTest(schema, modules);
			await t.run((ctx) =>
				ctx.db.insert("platformClients", {
					name: "Tenant",
					email: "owner@tenant.example",
					siteUrl: SITE_URL,
					tier: "full",
					subscriptionStatus: "active",
					stripeConnectedAccountId: MANUAL_REFUND.account,
					adminEmails: ["owner@tenant.example"],
					role: "client",
				}),
			);
			await t.mutation(api.orders.create, {
				...orderArgs(MANUAL_REFUND.session),
				...(storesProviderIds
					? {
							stripePaymentIntentId: MANUAL_REFUND.paymentIntent,
							stripeConnectedAccountId: MANUAL_REFUND.account,
						}
					: {}),
			});
			await expect(
				t.mutation(
					api.orders.reconcileSucceededManualRefund,
					manualRefundArgs({ stripeConnectedAccountId: MANUAL_REFUND.account }),
				),
			).resolves.toEqual({ kind: "reconciled" });
		}
	});

	test.each([
		["event ID", { stripeEventId: "bad" }],
		["refund ID", { stripeRefundId: "bad" }],
		["charge ID", { stripeChargeId: "bad" }],
		["PaymentIntent", { stripePaymentIntentId: "pi_abcdef1234567890" }],
		["connected account", { stripeConnectedAccountId: "acct_abcdef1234567890" }],
		["tenant", { siteUrl: "other.example" }],
		["tenant marker", { stripeTenantMetadataSiteUrl: "other.example" }],
		["amount", { refundAmount: 4200, sessionAmountTotal: 4200 }],
		["Session amount", { sessionAmountTotal: 4200 }],
		["live mode", { sessionLivemode: true }],
	] as const)("rejects a conflicting %s without changing the order", async (_label, override) => {
		const t = convexTest(schema, modules);
		const created = await t.mutation(api.orders.create, {
			...orderArgs(MANUAL_REFUND.session),
			stripePaymentIntentId: MANUAL_REFUND.paymentIntent,
		});
		const before = await t.run((ctx) => ctx.db.get(created._id));
		await expect(
			t.mutation(api.orders.reconcileSucceededManualRefund, manualRefundArgs(override)),
		).resolves.toEqual({ kind: "rejected", reason: "identity_conflict" });
		expect(await t.run((ctx) => ctx.db.get(created._id))).toEqual(before);
	});

	test.each([
		["printing", { status: "printing" }],
		["provider order", { lumaprintsOrderNumber: "LP-123" }],
		["fulfillment error", { fulfillmentError: "provider failed" }],
		["recovery state", { fulfillmentRecoveryStatus: "refund_pending" }],
		["prior refund", { stripeRefundId: MANUAL_REFUND.otherRefund }],
	] as const)("rejects an order with %s", async (_label, patch) => {
		const t = convexTest(schema, modules);
		const created = await t.mutation(api.orders.create, {
			...orderArgs(MANUAL_REFUND.session),
			stripePaymentIntentId: MANUAL_REFUND.paymentIntent,
		});
		await t.run((ctx) => ctx.db.patch(created._id, patch));
		const before = await t.run((ctx) => ctx.db.get(created._id));
		await expect(
			t.mutation(api.orders.reconcileSucceededManualRefund, manualRefundArgs()),
		).resolves.toEqual({ kind: "rejected", reason: "state_conflict" });
		expect(await t.run((ctx) => ctx.db.get(created._id))).toEqual(before);
	});

	test("releases a pre-submission claim before refund reconciliation", async () => {
		const t = convexTest(schema, modules);
		const created = await t.mutation(api.orders.create, {
			...orderArgs(MANUAL_REFUND.session),
			stripePaymentIntentId: MANUAL_REFUND.paymentIntent,
		});
		await expect(
			t.mutation(api.orders.claimPrintFulfillmentV2, {
				orderId: created._id,
				claimToken: CLAIM_TOKEN_A,
				webhookSecret: WEBHOOK_SECRET,
			}),
		).resolves.toMatchObject({ kind: "claimed" });
		await expect(
			t.mutation(api.orders.releasePrintFulfillmentClaim, {
				orderId: created._id,
				claimToken: CLAIM_TOKEN_A,
				webhookSecret: WEBHOOK_SECRET,
			}),
		).resolves.toBe(true);
		await expect(
			t.mutation(api.orders.reconcileSucceededManualRefund, manualRefundArgs()),
		).resolves.toEqual({ kind: "reconciled" });
	});

	test("lets a preparation lease expire but fences its stale owner", async () => {
		const t = convexTest(schema, modules);
		const created = await t.mutation(api.orders.create, {
			...orderArgs(MANUAL_REFUND.session),
			stripePaymentIntentId: MANUAL_REFUND.paymentIntent,
		});
		await t.mutation(api.orders.claimPrintFulfillmentV2, {
			orderId: created._id,
			claimToken: CLAIM_TOKEN_A,
			webhookSecret: WEBHOOK_SECRET,
		});
		await t.run((ctx) => ctx.db.patch(created._id, { printFulfillmentLeaseExpiresAt: 0 }));
		await expect(t.mutation(api.orders.claimPrintFulfillmentV2, {
			orderId: created._id,
			claimToken: CLAIM_TOKEN_B,
			webhookSecret: WEBHOOK_SECRET,
		})).resolves.toMatchObject({ kind: "claimed" });
		await expect(t.mutation(api.orders.releasePrintFulfillmentClaim, {
			orderId: created._id,
			claimToken: CLAIM_TOKEN_A,
			webhookSecret: WEBHOOK_SECRET,
		})).resolves.toBe(false);
		await expect(t.mutation(api.orders.beginPrintFulfillmentSubmission, {
			orderId: created._id,
			claimToken: CLAIM_TOKEN_A,
			webhookSecret: WEBHOOK_SECRET,
		})).resolves.toEqual({ kind: "lost" });
	});

	test.each(["printing", "ready", "shipped", "delivered"] as const)(
		"does not lease a %s order",
		async (status) => {
			const t = convexTest(schema, modules);
			const created = await t.mutation(api.orders.create, {
				...orderArgs(MANUAL_REFUND.session),
				stripePaymentIntentId: MANUAL_REFUND.paymentIntent,
			});
			await t.run((ctx) => ctx.db.patch(created._id, { status }));
			await expect(t.mutation(api.orders.claimPrintFulfillmentV2, {
				orderId: created._id,
				claimToken: CLAIM_TOKEN_A,
				webhookSecret: WEBHOOK_SECRET,
			})).resolves.toEqual({ kind: "busy" });
			expect((await t.run((ctx) => ctx.db.get(created._id)))?.printFulfillmentClaim)
				.toBeUndefined();
		},
	);

	test("keeps a refund retryable after provider submission has started", async () => {
		const t = convexTest(schema, modules);
		const created = await t.mutation(api.orders.create, {
			...orderArgs(MANUAL_REFUND.session),
			stripePaymentIntentId: MANUAL_REFUND.paymentIntent,
		});
		await t.mutation(api.orders.claimPrintFulfillmentV2, {
			orderId: created._id,
			claimToken: CLAIM_TOKEN_A,
			webhookSecret: WEBHOOK_SECRET,
		});
		await expect(t.mutation(api.orders.beginPrintFulfillmentSubmission, {
			orderId: created._id,
			claimToken: CLAIM_TOKEN_A,
			webhookSecret: WEBHOOK_SECRET,
		})).resolves.toMatchObject({ kind: "submitting" });
		await expect(
			t.mutation(api.orders.reconcileSucceededManualRefund, manualRefundArgs()),
		).rejects.toThrow("submission is in progress");
	});

	test("rejects a stale connected-account mapping before storing an early intent", async () => {
		const t = convexTest(schema, modules);
		await t.run((ctx) => ctx.db.insert("platformClients", {
			name: "Other tenant",
			email: "owner@other.example",
			siteUrl: "other.example",
			tier: "full",
			subscriptionStatus: "active",
			stripeConnectedAccountId: MANUAL_REFUND.account,
			adminEmails: ["owner@other.example"],
			role: "client",
		}));
		await expect(t.mutation(
			api.orders.reconcileSucceededManualRefund,
			manualRefundArgs({ stripeConnectedAccountId: MANUAL_REFUND.account }),
		)).resolves.toEqual({ kind: "rejected", reason: "identity_conflict" });
		expect(await t.run((ctx) => ctx.db.query("manualRefundIntents").collect())).toEqual([]);
	});

	test("does not consume an intent after its connected-account mapping changes", async () => {
		const t = convexTest(schema, modules);
		const clientId = await t.run((ctx) => ctx.db.insert("platformClients", {
			name: "Tenant",
			email: "owner@tenant.example",
			siteUrl: SITE_URL,
			tier: "full",
			subscriptionStatus: "active",
			stripeConnectedAccountId: MANUAL_REFUND.account,
			adminEmails: ["owner@tenant.example"],
			role: "client",
		}));
		const refundArgs = manualRefundArgs({ stripeConnectedAccountId: MANUAL_REFUND.account });
		await expect(t.mutation(api.orders.reconcileSucceededManualRefund, refundArgs))
			.resolves.toEqual({ kind: "pending_order" });
		const intentBefore = (await t.run((ctx) => ctx.db.query("manualRefundIntents").collect()))[0];
		await t.run((ctx) => ctx.db.patch(clientId, { siteUrl: "other.example" }));

		await expect(t.mutation(api.orders.create, {
			...orderArgs(MANUAL_REFUND.session),
			stripePaymentIntentId: MANUAL_REFUND.paymentIntent,
			stripeConnectedAccountId: MANUAL_REFUND.account,
		})).rejects.toThrow("routing facts conflict");
		expect(await t.run((ctx) => ctx.db.query("orders").collect())).toEqual([]);
		expect(await t.run((ctx) => ctx.db.get(intentBefore._id))).toEqual(intentBefore);
	});

	test("persists an early refund intent and makes later order creation terminal", async () => {
		const t = convexTest(schema, modules);
		await expect(
			t.mutation(api.orders.reconcileSucceededManualRefund, manualRefundArgs()),
		).resolves.toEqual({ kind: "pending_order" });
		const intents = await t.run((ctx) => ctx.db.query("manualRefundIntents").collect());
		expect(intents).toHaveLength(1);
		expect(intents[0]).toMatchObject({
			stripeRefundId: MANUAL_REFUND.refund,
			stripeSessionId: MANUAL_REFUND.session,
		});

		const created = await t.mutation(api.orders.create, {
			...orderArgs(MANUAL_REFUND.session),
			stripePaymentIntentId: MANUAL_REFUND.paymentIntent,
		});
		expect(created).toMatchObject({
			alreadyExisted: true,
			status: "refunded",
			stripeRefundId: MANUAL_REFUND.refund,
		});
		const stored = await t.run((ctx) => ctx.db.get(created._id));
		expect(stored).toMatchObject({
			status: "refunded",
			stripeRefundId: MANUAL_REFUND.refund,
		});
		expect(stored?.stripeFeeCaptureStatus).toBe("canceled");
		expect(await t.run((ctx) => ctx.db.get(intents[0]._id))).toMatchObject({
			orderId: created._id,
		});
	});

	test("lets provider authority replace an automated refund_pending checkpoint", async () => {
		const t = convexTest(schema, modules);
		const created = await t.mutation(api.orders.create, {
			...orderArgs(MANUAL_REFUND.session),
			stripePaymentIntentId: MANUAL_REFUND.paymentIntent,
		});
		await t.mutation(api.orders.updateStatus, {
			orderId: created._id,
			webhookSecret: WEBHOOK_SECRET,
			status: "fulfillment_error",
			fulfillmentError: "provider rejected",
			fulfillmentRecoveryStatus: "refund_pending",
		});
		await expect(t.mutation(
			api.orders.reconcileSucceededManualRefund,
			manualRefundArgs(),
		)).resolves.toEqual({ kind: "reconciled" });
		expect(await t.run((ctx) => ctx.db.get(created._id))).toMatchObject({
			status: "refunded",
			stripeRefundId: MANUAL_REFUND.refund,
		});
		expect((await t.run((ctx) => ctx.db.get(created._id)))?.fulfillmentRecoveryStatus)
			.toBeUndefined();
	});

	test("claims a non-print success notification once and yields to a refund", async () => {
		const t = convexTest(schema, modules);
		const created = await t.mutation(api.orders.create, {
			...orderArgs(MANUAL_REFUND.session),
			fulfillmentType: "digital",
			stripePaymentIntentId: MANUAL_REFUND.paymentIntent,
		});
		await expect(t.mutation(api.orders.claimNonPrintOrderOutcome, {
			orderId: created._id,
			webhookSecret: WEBHOOK_SECRET,
		})).resolves.toEqual({ kind: "success" });
		await expect(t.mutation(api.orders.claimNonPrintOrderOutcome, {
			orderId: created._id,
			webhookSecret: WEBHOOK_SECRET,
		})).resolves.toEqual({ kind: "none" });
		await t.mutation(api.orders.reconcileSucceededManualRefund, manualRefundArgs());
		await expect(t.mutation(api.orders.claimNonPrintOrderOutcome, {
			orderId: created._id,
			webhookSecret: WEBHOOK_SECRET,
		})).resolves.toEqual({
			kind: "manual_refunded",
			stripeRefundId: MANUAL_REFUND.refund,
		});
	});

	test("requires webhook authority and makes print claim/refund races mutually exclusive", async () => {
		const t = convexTest(schema, modules);
		const created = await t.mutation(api.orders.create, {
			...orderArgs(MANUAL_REFUND.session),
			stripePaymentIntentId: MANUAL_REFUND.paymentIntent,
		});
		await expect(
			t.mutation(
				api.orders.reconcileSucceededManualRefund,
				manualRefundArgs({ webhookSecret: "wrong" }),
			),
		).rejects.toThrow();

		const [claimResult, refundResult] = await Promise.allSettled([
			t.mutation(api.orders.claimPrintFulfillmentV2, {
				orderId: created._id,
				claimToken: CLAIM_TOKEN_A,
				webhookSecret: WEBHOOK_SECRET,
			}),
			t.mutation(api.orders.reconcileSucceededManualRefund, manualRefundArgs()),
		]);
		const stored = await t.run((ctx) => ctx.db.get(created._id));
		expect(stored).toMatchObject({
			status: "refunded",
			stripeRefundId: MANUAL_REFUND.refund,
		});
		expect(stored?.printFulfillmentClaim).toBeUndefined();
		expect(refundResult).toMatchObject({ status: "fulfilled", value: { kind: "reconciled" } });
		expect(claimResult.status).toBe("fulfilled");
	});

	test("prevents authenticated admins from asserting refund facts", async () => {
		const t = convexTest(schema, modules);
		await t.run((ctx) =>
			ctx.db.insert("platformClients", {
				name: "Tenant",
				email: "owner@tenant.example",
				siteUrl: SITE_URL,
				tier: "full",
				subscriptionStatus: "active",
				adminEmails: ["owner@tenant.example"],
				role: "client",
			}),
		);
		const created = await t.mutation(api.orders.create, orderArgs(MANUAL_REFUND.session));
		const admin = t.withIdentity({ email: "owner@tenant.example" });
		for (const transition of [
			{ status: "refunded" as const },
			{ stripeRefundId: MANUAL_REFUND.refund },
			{ fulfillmentRecoveryStatus: "refunded" as const },
		]) {
			await expect(
				admin.mutation(api.orders.updateStatus, { orderId: created._id, ...transition }),
			).rejects.toThrow("Stripe refund facts require webhook authority");
		}
		await t.mutation(api.orders.reconcileSucceededManualRefund, manualRefundArgs());
		for (const fulfillmentFact of [
			{ lumaprintsOrderNumber: "LP-ADMIN" },
			{ trackingNumber: "TRACK-ADMIN" },
			{ trackingUrl: "https://tracking.example/order" },
		]) {
			await expect(admin.mutation(api.orders.updateStatus, {
				orderId: created._id,
				...fulfillmentFact,
			})).rejects.toThrow("Refunded order fulfillment is terminal");
		}
	});

	test("prevents status regression after provider-authoritative reconciliation", async () => {
		const t = convexTest(schema, modules);
		const created = await t.mutation(api.orders.create, {
			...orderArgs(MANUAL_REFUND.session),
			stripePaymentIntentId: MANUAL_REFUND.paymentIntent,
		});
		await t.mutation(api.orders.reconcileSucceededManualRefund, manualRefundArgs());
		await expect(
			t.mutation(api.orders.updateStatus, {
				orderId: created._id,
				webhookSecret: WEBHOOK_SECRET,
				status: "printing",
			}),
		).rejects.toThrow("Refunded order fulfillment is terminal");
	});
});

describe("authorized customer order lookup", () => {
	test("returns the bounded customer view only with the dedicated capability", async () => {
		const t = convexTest(schema, modules);
		const order = {
			orderNumber: "ORD-001",
			customerEmail: "Buyer@Example.com",
			customerName: "Private Buyer Name",
			shippingAddress: {
				line1: "123 Private Street",
				city: "Detroit",
				state: "MI",
				postalCode: "48201",
				country: "US",
			},
			items: [{ productName: "Test print", quantity: 1, price: 4200 }],
			total: 4200,
			fulfillmentType: "lumaprints" as const,
			checkoutSnapshot,
		};
		await t.mutation(api.orders.create, {
			siteUrl: SITE_URL,
			webhookSecret: WEBHOOK_SECRET,
			stripeSessionId: "cs_customer_lookup",
			...order,
		});
		await t.mutation(api.orders.create, {
			siteUrl: "tenant-b.example",
			webhookSecret: WEBHOOK_SECRET,
			stripeSessionId: "cs_other_tenant_same_order_number",
			...order,
		});

		const result = await t.query(api.orders.lookupForCustomer, {
			siteUrl: SITE_URL,
			email: "buyer@example.com",
			orderNumber: "ORD-001",
			lookupSecret: ORDER_LOOKUP_SECRET,
		});
		expect(result).toEqual({
			orderNumber: "ORD-001",
			status: "new",
			items: [{ productName: "Test print", quantity: 1, price: 4200 }],
			total: 4200,
			trackingNumber: undefined,
			trackingUrl: undefined,
		});
		await expect(
			t.query(api.orders.lookupForCustomer, {
				siteUrl: SITE_URL,
				email: "someone-else@example.com",
				orderNumber: "ORD-001",
				lookupSecret: ORDER_LOOKUP_SECRET,
			}),
		).resolves.toBeNull();
	});

	test("rejects missing, wrong, and unconfigured capabilities", async () => {
		const t = convexTest(schema, modules);
		const args = {
			siteUrl: SITE_URL,
			email: "buyer@example.com",
			orderNumber: "ORD-001",
		};

		await expect(
			t.query(api.orders.lookupForCustomer, {
				...args,
				lookupSecret: "wrong-secret",
			}),
		).rejects.toThrow("Not authorized");
		await expect(t.query(api.orders.lookupForCustomer, args as never)).rejects.toThrow();

		delete process.env.ORDER_LOOKUP_SECRET;
		await expect(
			t.query(api.orders.lookupForCustomer, {
				...args,
				lookupSecret: ORDER_LOOKUP_SECRET,
			}),
		).rejects.toThrow("not configured");
	});

	test("fails closed when a tenant has a duplicate order number", async () => {
		const t = convexTest(schema, modules);
		for (const stripeSessionId of ["cs_lookup_duplicate_1", "cs_lookup_duplicate_2"]) {
			await t.mutation(api.orders.create, {
				siteUrl: SITE_URL,
				webhookSecret: WEBHOOK_SECRET,
				stripeSessionId,
				orderNumber: "ORD-DUPLICATE",
				customerEmail: "buyer@example.com",
				items: [{ productName: "Test print", quantity: 1, price: 4200 }],
				total: 4200,
				fulfillmentType: "lumaprints",
			});
		}

		await expect(
			t.query(api.orders.lookupForCustomer, {
				siteUrl: SITE_URL,
				email: "buyer@example.com",
				orderNumber: "ORD-DUPLICATE",
				lookupSecret: ORDER_LOOKUP_SECRET,
			}),
		).rejects.toThrow("Duplicate order number for tenant");
	});
});

describe("order Stripe fee capture initialization", () => {
	test("creates a pending checkpoint before scheduling fee capture", async () => {
		const t = convexTest(schema, modules);
		const created = await t.mutation(api.orders.create, {
			siteUrl: SITE_URL,
			webhookSecret: WEBHOOK_SECRET,
			stripeSessionId: "cs_fee_checkpoint",
			stripePaymentIntentId: "pi_fee_checkpoint",
			customerEmail: "customer@example.com",
			items: [{ productName: "Digital file", quantity: 1, price: 1000 }],
			total: 1000,
			fulfillmentType: "digital",
		});

		const order = await t.run(async (ctx) => ctx.db.get(created._id));
		expect(created).toMatchObject({
			stripeFeeCaptureStatus: "pending",
			stripeFeeCaptureAttempts: 0,
			stripeFeeCaptureNextAttemptAt: expect.any(Number),
		});
		expect(order).toMatchObject({
			stripeFeeCaptureStatus: "pending",
			stripeFeeCaptureAttempts: 0,
			stripeFeeCaptureNextAttemptAt: expect.any(Number),
		});
	});

	test("does not invent fee-capture state without a payment intent", async () => {
		const t = convexTest(schema, modules);
		const created = await t.mutation(api.orders.create, {
			siteUrl: SITE_URL,
			webhookSecret: WEBHOOK_SECRET,
			stripeSessionId: "cs_without_payment_intent",
			customerEmail: "customer@example.com",
			items: [{ productName: "Manual order", quantity: 1, price: 1000 }],
			total: 1000,
			fulfillmentType: "self",
		});

		const order = await t.run(async (ctx) => ctx.db.get(created._id));
		expect(order?.stripeFeeCaptureStatus).toBeUndefined();
		expect(order?.stripeFeeCaptureAttempts).toBeUndefined();
		expect(order?.stripeFeeCaptureNextAttemptAt).toBeUndefined();
	});
});

describe("order shipment email claim", () => {
	test("lets the hub claim a globally unique LumaPrints order without caller-supplied tenant scope", async () => {
		const { t, orderId } = await seedLumaPrintsOrder();

		const claim = await t.mutation(api.orders.claimShipmentEmailNotificationByOrderNumber, {
			webhookSecret: WEBHOOK_SECRET,
			lumaprintsOrderNumber: "LP-123",
			trackingNumber: "GLOBAL-TRACKING",
		});

		expect(claim).toMatchObject({
			claimed: true,
			order: {
				siteUrl: SITE_URL,
				orderNumber: "ORD-001",
				customerEmail: "customer@example.com",
			},
		});
		const order = await t.run(async (ctx) => ctx.db.get(orderId));
		expect(order).toMatchObject({ status: "shipped", trackingNumber: "GLOBAL-TRACKING" });
	});

	test("rejects ambiguous global LumaPrints order numbers across tenants", async () => {
		const { t } = await seedLumaPrintsOrder();
		const duplicate = await t.mutation(api.orders.create, {
			siteUrl: "tenant-b.example",
			webhookSecret: WEBHOOK_SECRET,
			stripeSessionId: "cs_other_tenant",
			customerEmail: "other@example.com",
			items: [{ productName: "Other print", quantity: 1, price: 42 }],
			total: 42,
			fulfillmentType: "lumaprints",
		});
		await t.mutation(api.orders.updateStatus, {
			orderId: duplicate._id,
			webhookSecret: WEBHOOK_SECRET,
			status: "printing",
			lumaprintsOrderNumber: "LP-123",
		});

		await expect(
			t.mutation(api.orders.claimShipmentEmailNotificationByOrderNumber, {
				webhookSecret: WEBHOOK_SECRET,
				lumaprintsOrderNumber: "LP-123",
			}),
		).rejects.toThrow("Duplicate LumaPrints order number across tenants");
	});

	test("claims shipment email exactly once while updating shipment tracking", async () => {
		const { t, orderId } = await seedLumaPrintsOrder();

		const firstClaim = await t.mutation(api.orders.claimShipmentEmailNotification, {
			siteUrl: SITE_URL,
			webhookSecret: WEBHOOK_SECRET,
			lumaprintsOrderNumber: "LP-123",
			trackingNumber: "1Z999",
			trackingUrl: "https://carrier.example/track/1Z999",
		});

		expect(firstClaim).toMatchObject({
			claimed: true,
			order: {
				orderNumber: "ORD-001",
				customerEmail: "customer@example.com",
			},
		});
		const afterFirstClaim = await t.run(async (ctx) => await ctx.db.get(orderId));
		expect(afterFirstClaim).toMatchObject({
			status: "shipped",
			trackingNumber: "1Z999",
			trackingUrl: "https://carrier.example/track/1Z999",
			shipmentEmailDeliveryStatus: "pending",
		});
		expect(afterFirstClaim?.shipmentEmailSentAt).toEqual(expect.any(Number));

		const secondClaim = await t.mutation(api.orders.claimShipmentEmailNotification, {
			siteUrl: SITE_URL,
			webhookSecret: WEBHOOK_SECRET,
			lumaprintsOrderNumber: "LP-123",
			trackingNumber: "1Z999",
		});

		expect(secondClaim).toMatchObject({
			claimed: false,
			order: {
				orderNumber: "ORD-001",
				customerEmail: "customer@example.com",
			},
		});
		const afterSecondClaim = await t.run(async (ctx) => await ctx.db.get(orderId));
		expect(afterSecondClaim?.shipmentEmailSentAt).toBe(afterFirstClaim?.shipmentEmailSentAt);
	});

	test("does not claim email for already shipped orders without a legacy claim marker", async () => {
		const { t, orderId } = await seedLumaPrintsOrder();
		await t.mutation(api.orders.updateStatus, {
			orderId,
			webhookSecret: WEBHOOK_SECRET,
			status: "shipped",
		});

		const claim = await t.mutation(api.orders.claimShipmentEmailNotification, {
			siteUrl: SITE_URL,
			webhookSecret: WEBHOOK_SECRET,
			lumaprintsOrderNumber: "LP-123",
			trackingNumber: "1Z999",
		});

		expect(claim?.claimed).toBe(false);
		const order = await t.run(async (ctx) => await ctx.db.get(orderId));
		expect(order?.shipmentEmailSentAt).toBeUndefined();
		expect(order?.trackingNumber).toBe("1Z999");
	});

	test.each(["delivered", "refunded", "fulfillment_error"] as const)(
		"does not regress %s orders or claim shipment emails",
		async (status) => {
			const { t, orderId } = await seedLumaPrintsOrder();
			await t.mutation(api.orders.updateStatus, {
				orderId,
				webhookSecret: WEBHOOK_SECRET,
				status,
			});

			const claim = await t.mutation(api.orders.claimShipmentEmailNotification, {
				siteUrl: SITE_URL,
				webhookSecret: WEBHOOK_SECRET,
				lumaprintsOrderNumber: "LP-123",
				trackingNumber: "1Z999",
				trackingUrl: "https://carrier.example/track/1Z999",
			});

			expect(claim?.claimed).toBe(false);
			const order = await t.run(async (ctx) => await ctx.db.get(orderId));
			expect(order).toMatchObject({
				status,
				trackingNumber: "1Z999",
				trackingUrl: "https://carrier.example/track/1Z999",
			});
			expect(order?.shipmentEmailSentAt).toBeUndefined();
		},
	);

	test("returns null when no LumaPrints order exists for the site", async () => {
		const { t } = await seedLumaPrintsOrder();

		const claim = await t.mutation(api.orders.claimShipmentEmailNotification, {
			siteUrl: SITE_URL,
			webhookSecret: WEBHOOK_SECRET,
			lumaprintsOrderNumber: "LP-unknown",
		});

		expect(claim).toBeNull();
	});

	test("rejects duplicate LumaPrints order numbers for the same site", async () => {
		const { t } = await seedLumaPrintsOrder();
		const duplicate = await t.mutation(api.orders.create, {
			siteUrl: SITE_URL,
			webhookSecret: WEBHOOK_SECRET,
			stripeSessionId: "cs_test_duplicate",
			customerEmail: "other@example.com",
			customerName: "Other Customer",
			items: [{ productName: "Test print", quantity: 1, price: 42 }],
			total: 42,
			fulfillmentType: "lumaprints",
		});
		await t.mutation(api.orders.updateStatus, {
			orderId: duplicate._id,
			webhookSecret: WEBHOOK_SECRET,
			status: "printing",
			lumaprintsOrderNumber: "LP-123",
		});

		await expect(
			t.mutation(api.orders.claimShipmentEmailNotification, {
				siteUrl: SITE_URL,
				webhookSecret: WEBHOOK_SECRET,
				lumaprintsOrderNumber: "LP-123",
			}),
		).rejects.toThrow("Duplicate LumaPrints order number");
	});

	test("requires the webhook secret for unauthenticated callers", async () => {
		const { t } = await seedLumaPrintsOrder();

		await expect(
			t.mutation(api.orders.claimShipmentEmailNotification, {
				siteUrl: SITE_URL,
				webhookSecret: "wrong-secret",
				lumaprintsOrderNumber: "LP-123",
			}),
		).rejects.toThrow("Not authorized");
	});
});

describe("order shipment email delivery recording", () => {
	test("lets the hub record delivery by globally unique LumaPrints order number", async () => {
		const { t, orderId } = await seedLumaPrintsOrder();

		const result = await t.mutation(api.orders.recordShipmentEmailDeliveryByOrderNumber, {
			webhookSecret: WEBHOOK_SECRET,
			lumaprintsOrderNumber: "LP-123",
			status: "sent",
		});

		expect(result).toMatchObject({
			recorded: true,
			order: { siteUrl: SITE_URL, orderNumber: "ORD-001" },
		});
		const order = await t.run(async (ctx) => ctx.db.get(orderId));
		expect(order?.shipmentEmailDeliveryStatus).toBe("sent");
	});

	test("records successful shipment email delivery after a claim", async () => {
		const { t, orderId } = await seedLumaPrintsOrder();
		await t.mutation(api.orders.claimShipmentEmailNotification, {
			siteUrl: SITE_URL,
			webhookSecret: WEBHOOK_SECRET,
			lumaprintsOrderNumber: "LP-123",
		});

		const result = await t.mutation(api.orders.recordShipmentEmailDelivery, {
			siteUrl: SITE_URL,
			webhookSecret: WEBHOOK_SECRET,
			lumaprintsOrderNumber: "LP-123",
			status: "sent",
		});

		expect(result).toMatchObject({
			recorded: true,
			order: { orderNumber: "ORD-001" },
		});
		const order = await t.run(async (ctx) => await ctx.db.get(orderId));
		expect(order).toMatchObject({
			shipmentEmailDeliveryStatus: "sent",
			shipmentEmailDeliveryAttemptedAt: expect.any(Number),
		});
		expect(order?.shipmentEmailDeliveryError).toBeUndefined();
	});

	test("records failed shipment email delivery with bounded error detail", async () => {
		const { t, orderId } = await seedLumaPrintsOrder();
		await t.mutation(api.orders.claimShipmentEmailNotification, {
			siteUrl: SITE_URL,
			webhookSecret: WEBHOOK_SECRET,
			lumaprintsOrderNumber: "LP-123",
		});

		await t.mutation(api.orders.recordShipmentEmailDelivery, {
			siteUrl: SITE_URL,
			webhookSecret: WEBHOOK_SECRET,
			lumaprintsOrderNumber: "LP-123",
			status: "failed",
			error: "x".repeat(1200),
		});

		const order = await t.run(async (ctx) => await ctx.db.get(orderId));
		expect(order?.shipmentEmailDeliveryStatus).toBe("failed");
		expect(order?.shipmentEmailDeliveryAttemptedAt).toEqual(expect.any(Number));
		expect(order?.shipmentEmailDeliveryError).toHaveLength(1000);
		expect(order?.shipmentEmailDeliveryError?.endsWith("...")).toBe(true);
	});

	test("records a generic failure detail when none is provided", async () => {
		const { t, orderId } = await seedLumaPrintsOrder();

		await t.mutation(api.orders.recordShipmentEmailDelivery, {
			siteUrl: SITE_URL,
			webhookSecret: WEBHOOK_SECRET,
			lumaprintsOrderNumber: "LP-123",
			status: "failed",
		});

		const order = await t.run(async (ctx) => await ctx.db.get(orderId));
		expect(order?.shipmentEmailDeliveryStatus).toBe("failed");
		expect(order?.shipmentEmailDeliveryError).toBe(
			"Shipment email delivery failed without error detail",
		);
	});

	test("clears stale shipment email delivery errors when recording success", async () => {
		const { t, orderId } = await seedLumaPrintsOrder();
		await t.mutation(api.orders.recordShipmentEmailDelivery, {
			siteUrl: SITE_URL,
			webhookSecret: WEBHOOK_SECRET,
			lumaprintsOrderNumber: "LP-123",
			status: "failed",
			error: "Resend unavailable",
		});

		await t.mutation(api.orders.recordShipmentEmailDelivery, {
			siteUrl: SITE_URL,
			webhookSecret: WEBHOOK_SECRET,
			lumaprintsOrderNumber: "LP-123",
			status: "sent",
		});

		const order = await t.run(async (ctx) => await ctx.db.get(orderId));
		expect(order?.shipmentEmailDeliveryStatus).toBe("sent");
		expect(order?.shipmentEmailDeliveryError).toBeUndefined();
	});

	test("records skipped shipment email delivery when no email can be sent", async () => {
		const { t, orderId } = await seedLumaPrintsOrder();

		await t.mutation(api.orders.recordShipmentEmailDelivery, {
			siteUrl: SITE_URL,
			webhookSecret: WEBHOOK_SECRET,
			lumaprintsOrderNumber: "LP-123",
			status: "skipped",
		});

		const order = await t.run(async (ctx) => await ctx.db.get(orderId));
		expect(order?.shipmentEmailDeliveryStatus).toBe("skipped");
		expect(order?.shipmentEmailDeliveryAttemptedAt).toEqual(expect.any(Number));
	});

	test("returns null when recording delivery for an unknown LumaPrints order", async () => {
		const { t } = await seedLumaPrintsOrder();

		const result = await t.mutation(api.orders.recordShipmentEmailDelivery, {
			siteUrl: SITE_URL,
			webhookSecret: WEBHOOK_SECRET,
			lumaprintsOrderNumber: "LP-unknown",
			status: "failed",
			error: "No recipient",
		});

		expect(result).toBeNull();
	});

	test("rejects duplicate LumaPrints order numbers when recording delivery", async () => {
		const { t } = await seedLumaPrintsOrder();
		const duplicate = await t.mutation(api.orders.create, {
			siteUrl: SITE_URL,
			webhookSecret: WEBHOOK_SECRET,
			stripeSessionId: "cs_test_delivery_duplicate",
			customerEmail: "other@example.com",
			customerName: "Other Customer",
			items: [{ productName: "Test print", quantity: 1, price: 42 }],
			total: 42,
			fulfillmentType: "lumaprints",
		});
		await t.mutation(api.orders.updateStatus, {
			orderId: duplicate._id,
			webhookSecret: WEBHOOK_SECRET,
			status: "printing",
			lumaprintsOrderNumber: "LP-123",
		});

		await expect(
			t.mutation(api.orders.recordShipmentEmailDelivery, {
				siteUrl: SITE_URL,
				webhookSecret: WEBHOOK_SECRET,
				lumaprintsOrderNumber: "LP-123",
				status: "sent",
			}),
		).rejects.toThrow("Duplicate LumaPrints order number");
	});

	test("requires the webhook secret when recording shipment email delivery", async () => {
		const { t } = await seedLumaPrintsOrder();

		await expect(
			t.mutation(api.orders.recordShipmentEmailDelivery, {
				siteUrl: SITE_URL,
				webhookSecret: "wrong-secret",
				lumaprintsOrderNumber: "LP-123",
				status: "sent",
			}),
		).rejects.toThrow("Not authorized");
	});
});

describe("legacy LumaPrints order lookup", () => {
	test("returns matching order data for a unique LumaPrints order number", async () => {
		const { t } = await seedLumaPrintsOrder();

		const order = await t.query(api.orders.getByLumaprintsOrderNumber, {
			siteUrl: SITE_URL,
			webhookSecret: WEBHOOK_SECRET,
			lumaprintsOrderNumber: "LP-123",
		});

		expect(order).toMatchObject({
			orderNumber: "ORD-001",
			status: "printing",
			customerEmail: "customer@example.com",
		});
	});

	test("rejects duplicate LumaPrints order numbers instead of first-matching", async () => {
		const { t } = await seedLumaPrintsOrder();
		const duplicate = await t.mutation(api.orders.create, {
			siteUrl: SITE_URL,
			webhookSecret: WEBHOOK_SECRET,
			stripeSessionId: "cs_test_lookup_duplicate",
			customerEmail: "other@example.com",
			customerName: "Other Customer",
			items: [{ productName: "Test print", quantity: 1, price: 42 }],
			total: 42,
			fulfillmentType: "lumaprints",
		});
		await t.mutation(api.orders.updateStatus, {
			orderId: duplicate._id,
			webhookSecret: WEBHOOK_SECRET,
			status: "printing",
			lumaprintsOrderNumber: "LP-123",
		});

		await expect(
			t.query(api.orders.getByLumaprintsOrderNumber, {
				siteUrl: SITE_URL,
				webhookSecret: WEBHOOK_SECRET,
				lumaprintsOrderNumber: "LP-123",
			}),
		).rejects.toThrow("Duplicate LumaPrints order number");
	});
});
