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
	process.env.STRIPE_REFUND_RECOVERY_ID = MANUAL_REFUND_RECOVERY_ID;
	process.env.CONVEX_CLOUD_URL = "https://loyal-swan-967.convex.cloud";
});

afterEach(() => {
	delete process.env.WEBHOOK_SECRET;
	delete process.env.ORDER_LOOKUP_SECRET;
	delete process.env.STRIPE_REFUND_RECOVERY_ID;
	delete process.env.CONVEX_CLOUD_URL;
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

const MANUAL_REFUND_RECOVERY_ID = "angelsrest-refund-event-selection-gap-v1";
const ADMIN_RECOVERY = {
	siteUrl: "angelsrest.online",
	context: "acct_1SzVXnEdZA9bU4XS",
	event: "evt_3TzgMtEdZA9bU4XS1UakYelP",
	refund: "re_3TzgMtEdZA9bU4XS18G1xdUE",
	charge: "ch_3TzgMtEdZA9bU4XS16dVR60J",
	paymentIntent: "pi_3TzgMtEdZA9bU4XS1mivC9KA",
	session: "cs_live_a1F5xkFjDxDIQ3Qjikpdo3Oo4OEwwM2jfpiAP589tBByIWZ5iDBLIBzlL0",
	amount: 1500,
} as const;

const MANUAL_REFUND = {
	event: "evt_1234567890abcdef",
	refund: "re_1234567890abcdef",
	otherRefund: "re_abcdef1234567890",
	charge: "ch_1234567890abcdef",
	paymentIntent: "pi_1234567890abcdef",
	session: "cs_test_1234567890abcdef",
	account: "acct_1234567890abcdef",
};

function manualRefundRecoveryClaimArgs(overrides: Record<string, unknown> = {}) {
	return {
		webhookSecret: WEBHOOK_SECRET,
		recoveryId: MANUAL_REFUND_RECOVERY_ID,
		manifestVersion: 1,
		siteUrl: ADMIN_RECOVERY.siteUrl,
		stripeContext: ADMIN_RECOVERY.context,
		stripeEventId: ADMIN_RECOVERY.event,
		stripeEventType: "refund.updated" as const,
		stripeEventApiVersion: "2026-01-28.clover",
		stripeRefundId: ADMIN_RECOVERY.refund,
		stripeChargeId: ADMIN_RECOVERY.charge,
		stripePaymentIntentId: ADMIN_RECOVERY.paymentIntent,
		stripeSessionId: ADMIN_RECOVERY.session,
		stripeTenantMetadataSiteUrl: ADMIN_RECOVERY.siteUrl,
		amount: ADMIN_RECOVERY.amount,
		currency: "usd" as const,
		livemode: true,
		...overrides,
	};
}

function manualRefundRecoveryProjectionArgs(overrides: Record<string, unknown> = {}) {
	return manualRefundArgs({
		eventLivemode: true,
		sessionLivemode: true,
		refundRecoveryId: MANUAL_REFUND_RECOVERY_ID,
		refundRecoveryManifestVersion: 1,
		refundRecoveryStripeContext: ADMIN_RECOVERY.context,
		refundRecoveryEventApiVersion: "2026-01-28.clover",
		refundRecoveryProviderEvidence: {
			verifiedAt: Date.now(),
			currentRefundStatus: "succeeded" as const,
			currentRefundHasAutomatedMetadata: false as const,
			currentRefundHasRecoveryAuditMetadata: false as const,
			paymentIntentStatus: "succeeded" as const,
			paymentIntentAmount: ADMIN_RECOVERY.amount,
			paymentIntentAmountReceived: ADMIN_RECOVERY.amount,
			paymentIntentCurrency: "usd" as const,
			paymentIntentLivemode: true as const,
			paymentIntentLatestChargeId: ADMIN_RECOVERY.charge,
			sessionMode: "payment" as const,
			sessionStatus: "complete" as const,
			sessionPaymentStatus: "paid" as const,
		},
		stripeEventId: ADMIN_RECOVERY.event,
		stripeRefundId: ADMIN_RECOVERY.refund,
		stripeChargeId: ADMIN_RECOVERY.charge,
		stripeSessionId: ADMIN_RECOVERY.session,
		stripePaymentIntentId: ADMIN_RECOVERY.paymentIntent,
		siteUrl: ADMIN_RECOVERY.siteUrl,
		refundAmount: ADMIN_RECOVERY.amount,
		sessionAmountTotal: ADMIN_RECOVERY.amount,
		stripeTenantMetadataSiteUrl: ADMIN_RECOVERY.siteUrl,
		...overrides,
	});
}

async function createRecoveryAdmin(t: ReturnType<typeof convexTest>) {
	const email = "refund-recovery-admin@example.com";
	await t.run((ctx) => ctx.db.insert("platformClients", {
		name: "Angels Rest",
		email,
		siteUrl: ADMIN_RECOVERY.siteUrl,
		tier: "full",
		subscriptionStatus: "active",
		adminEmails: [email],
		role: "client",
	}));
	return t.withIdentity({ subject: email, email });
}

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
	test("claims only the exact incident under site-admin and webhook authority", async () => {
		const t = convexTest(schema, modules);
		const admin = await createRecoveryAdmin(t);
		const claimArgs = manualRefundRecoveryClaimArgs();

		const claims = await Promise.all([
			admin.mutation(api.orders.claimManualRefundRecovery, claimArgs),
			admin.mutation(api.orders.claimManualRefundRecovery, claimArgs),
		]);

		expect(claims.map(({ claimed }) => claimed).sort()).toEqual([false, true]);
		const recoveries = await t.run((ctx) => ctx.db.query("manualRefundRecoveries").take(2));
		expect(recoveries).toHaveLength(1);
		expect(recoveries[0]).toMatchObject({
			recoveryId: MANUAL_REFUND_RECOVERY_ID,
			manifestVersion: 1,
			siteUrl: ADMIN_RECOVERY.siteUrl,
			stripeEventId: ADMIN_RECOVERY.event,
			stripeRefundId: ADMIN_RECOVERY.refund,
			stripeSessionId: ADMIN_RECOVERY.session,
			state: "claimed",
		});
		expect(recoveries[0].claimedByTokenIdentifier).toContain("refund-recovery-admin@example.com");
		await expect(t.mutation(api.orders.claimManualRefundRecovery, claimArgs)).rejects.toThrow();
		await expect(admin.mutation(api.orders.claimManualRefundRecovery, {
			...claimArgs,
			amount: ADMIN_RECOVERY.amount + 1,
		})).rejects.toThrow("Invalid manual refund recovery claim");
		await expect(admin.mutation(api.orders.claimManualRefundRecovery, {
			...claimArgs,
			webhookSecret: "wrong",
		})).rejects.toThrow();
	});

	test("completes the evidence-bound recovery claim atomically with reconciliation", async () => {
		const t = convexTest(schema, modules);
		const admin = await createRecoveryAdmin(t);
		const created = await t.mutation(api.orders.create, {
			...orderArgs(ADMIN_RECOVERY.session),
			siteUrl: ADMIN_RECOVERY.siteUrl,
			items: [{ productName: "Historical print", quantity: 1, price: ADMIN_RECOVERY.amount }],
			total: ADMIN_RECOVERY.amount,
			stripePaymentIntentId: ADMIN_RECOVERY.paymentIntent,
		});
		await admin.mutation(api.orders.claimManualRefundRecovery, manualRefundRecoveryClaimArgs());

		await expect(admin.mutation(
			api.orders.reconcileSucceededManualRefund,
			manualRefundRecoveryProjectionArgs(),
		)).resolves.toEqual({ kind: "reconciled" });
		const recovery = (await t.run((ctx) =>
			ctx.db.query("manualRefundRecoveries").withIndex(
				"by_recoveryId",
				(q) => q.eq("recoveryId", MANUAL_REFUND_RECOVERY_ID),
			).unique()))!;
		expect(recovery).toMatchObject({
			state: "completed",
			resultKind: "reconciled",
			providerEvidence: expect.objectContaining({ paymentIntentStatus: "succeeded" }),
		});
		if (recovery.state !== "completed") throw new Error("Expected completed recovery");
		expect(recovery.completedAt).toEqual(expect.any(Number));
		expect(await t.run((ctx) => ctx.db.get(created._id))).toMatchObject({
			status: "refunded",
			stripeRefundId: ADMIN_RECOVERY.refund,
		});
		await expect(admin.mutation(
			api.orders.reconcileSucceededManualRefund,
			manualRefundRecoveryProjectionArgs(),
		)).rejects.toThrow("claim is unavailable");
		await expect(admin.mutation(api.orders.failManualRefundRecovery, {
			webhookSecret: WEBHOOK_SECRET,
			recoveryId: MANUAL_REFUND_RECOVERY_ID,
			siteUrl: ADMIN_RECOVERY.siteUrl,
			resultReason: "late_failure",
			failureStage: "execution",
		})).resolves.toEqual({ completed: false });
	});

	test("rejects evidence or actor changes from the immutable recovery claim", async () => {
		const t = convexTest(schema, modules);
		const admin = await createRecoveryAdmin(t);
		await t.mutation(api.orders.create, {
			...orderArgs(ADMIN_RECOVERY.session),
			siteUrl: ADMIN_RECOVERY.siteUrl,
			items: [{ productName: "Historical print", quantity: 1, price: ADMIN_RECOVERY.amount }],
			total: ADMIN_RECOVERY.amount,
			stripePaymentIntentId: ADMIN_RECOVERY.paymentIntent,
		});
		await admin.mutation(api.orders.claimManualRefundRecovery, manualRefundRecoveryClaimArgs());

		await expect(admin.mutation(
			api.orders.reconcileSucceededManualRefund,
			manualRefundRecoveryProjectionArgs({
				stripeSessionId: "cs_test_differentsession1234",
			}),
		)).rejects.toThrow("claim is unavailable");
		const otherAdmin = t.withIdentity({
			subject: "other-refund-admin@example.com",
			email: "refund-recovery-admin@example.com",
		});
		await expect(otherAdmin.mutation(
			api.orders.reconcileSucceededManualRefund,
			manualRefundRecoveryProjectionArgs(),
		)).rejects.toThrow("claim is unavailable");
		const recovery = (await t.run((ctx) =>
			ctx.db.query("manualRefundRecoveries").take(1)))[0];
		expect(recovery).toMatchObject({ state: "claimed" });
	});

	test("fails closed without the Convex recovery gate or an existing order", async () => {
		const t = convexTest(schema, modules);
		const admin = await createRecoveryAdmin(t);
		const claimArgs = manualRefundRecoveryClaimArgs();
		delete process.env.STRIPE_REFUND_RECOVERY_ID;
		await expect(admin.mutation(api.orders.claimManualRefundRecovery, claimArgs)).rejects.toThrow(
			"Manual refund recovery is disabled",
		);
		process.env.STRIPE_REFUND_RECOVERY_ID = MANUAL_REFUND_RECOVERY_ID;
		await admin.mutation(api.orders.claimManualRefundRecovery, claimArgs);

		await expect(admin.mutation(
			api.orders.reconcileSucceededManualRefund,
			manualRefundRecoveryProjectionArgs(),
		)).resolves.toEqual({ kind: "rejected", reason: "state_conflict" });
		await expect(t.run((ctx) => ctx.db.query("manualRefundIntents").collect())).resolves.toEqual([]);
	});

	test("rejects an ineligible existing order without creating a refund intent", async () => {
		const t = convexTest(schema, modules);
		const admin = await createRecoveryAdmin(t);
		const created = await t.mutation(api.orders.create, {
			...orderArgs(ADMIN_RECOVERY.session),
			siteUrl: ADMIN_RECOVERY.siteUrl,
			items: [{ productName: "Historical print", quantity: 1, price: ADMIN_RECOVERY.amount }],
			total: ADMIN_RECOVERY.amount,
			stripePaymentIntentId: ADMIN_RECOVERY.paymentIntent,
		});
		await t.run((ctx) => ctx.db.patch(created._id, { status: "shipped" }));
		await admin.mutation(api.orders.claimManualRefundRecovery, manualRefundRecoveryClaimArgs());

		await expect(admin.mutation(
			api.orders.reconcileSucceededManualRefund,
			manualRefundRecoveryProjectionArgs(),
		)).resolves.toEqual({ kind: "rejected", reason: "state_conflict" });
		await expect(t.run((ctx) => ctx.db.query("manualRefundIntents").collect())).resolves.toEqual([]);
		expect(await t.run((ctx) => ctx.db.get(created._id))).toMatchObject({ status: "shipped" });
	});

	test("records a failed one-use recovery without making it claimable again", async () => {
		const t = convexTest(schema, modules);
		const admin = await createRecoveryAdmin(t);
		const claimArgs = manualRefundRecoveryClaimArgs();
		await admin.mutation(api.orders.claimManualRefundRecovery, claimArgs);

		await expect(admin.mutation(api.orders.failManualRefundRecovery, {
			webhookSecret: WEBHOOK_SECRET,
			recoveryId: MANUAL_REFUND_RECOVERY_ID,
			siteUrl: ADMIN_RECOVERY.siteUrl,
			resultReason: "provider_evidence_rejected",
			failureStage: "provider_evidence",
			providerFailureObservations: {
				observedAt: Date.now(),
				failedChecks: ["current_refund.automated_metadata"],
			},
		})).resolves.toEqual({ completed: true });
		const recovery = (await t.run((ctx) =>
			ctx.db.query("manualRefundRecoveries").take(1)))[0];
		expect(recovery).toMatchObject({
			state: "completed",
			resultKind: "failed",
			resultReason: "provider_evidence_rejected",
			failureStage: "provider_evidence",
			providerFailureObservations: {
				failedChecks: ["current_refund.automated_metadata"],
			},
		});
		await expect(admin.mutation(api.orders.claimManualRefundRecovery, claimArgs)).resolves.toEqual({
			claimed: false,
		});
		await expect(admin.mutation(api.orders.failManualRefundRecovery, {
			webhookSecret: "wrong",
			recoveryId: MANUAL_REFUND_RECOVERY_ID,
			siteUrl: ADMIN_RECOVERY.siteUrl,
			resultReason: "wrong_authority",
			failureStage: "execution",
		})).rejects.toThrow();
	});

	test("converges concurrent refunds for the retained legacy order and preserves its reservation", async () => {
		const t = convexTest(schema, modules);
		const created = await t.mutation(api.orders.create, {
			...orderArgs(MANUAL_REFUND.session),
			items: [{ productName: "Archival Matte 4×6", quantity: 1, price: 1500 }],
			total: 1500,
			fulfillmentType: "self",
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
						variantKey: "4x6",
						materialOptionKey: "archival-matte",
						sizeOptionKey: "4x6",
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
		const refundArgs = manualRefundArgs({ refundAmount: 1500, sessionAmountTotal: 1500 });

		const concurrent = await Promise.all([
			t.mutation(api.orders.reconcileSucceededManualRefund, refundArgs),
			t.mutation(api.orders.reconcileSucceededManualRefund, refundArgs),
		]);
		expect(concurrent.map(({ kind }) => kind).sort()).toEqual(["reconciled", "replayed"]);

		const stored = await t.run((ctx) => ctx.db.get(created._id));
		expect(stored).toMatchObject({
			status: "refunded",
			fulfillmentType: "self",
			stripeRefundId: MANUAL_REFUND.refund,
			stripeFeeCaptureStatus: "canceled",
		});
		expect(stored?.checkoutSnapshot).toBeUndefined();
		expect(stored?.lumaprintsOrderNumber).toBeUndefined();
		expect(stored?.printFulfillmentClaim).toBeUndefined();
		expect(stored?.fulfillmentRecoveryStatus).toBeUndefined();
		expect(await t.run((ctx) => ctx.db.get(reservationId))).toEqual(reservationBefore);
		const intents = await t.run((ctx) => ctx.db.query("manualRefundIntents").collect());
		expect(intents).toHaveLength(1);
		expect(intents[0]).toMatchObject({
			stripeEventId: MANUAL_REFUND.event,
			stripeRefundId: MANUAL_REFUND.refund,
			orderId: created._id,
		});
		await expect(
			t.query(api.orders.resolvePaidDownloadOrder, {
				stripeSessionId: MANUAL_REFUND.session,
				webhookSecret: WEBHOOK_SECRET,
			}),
		).resolves.toMatchObject({ refunded: true });
		await expect(
			t.mutation(api.orders.reconcileSucceededManualRefund, refundArgs),
		).resolves.toEqual({ kind: "replayed" });
		await expect(t.mutation(api.orders.claimPrintFulfillment, {
			orderId: created._id,
			webhookSecret: WEBHOOK_SECRET,
		})).resolves.toEqual({ kind: "busy" });
		await expect(
			t.mutation(
				api.orders.reconcileSucceededManualRefund,
				{ ...refundArgs, stripeRefundId: MANUAL_REFUND.otherRefund },
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

describe("payment-failure email claim", () => {
	const claimArgs = {
		webhookSecret: WEBHOOK_SECRET,
		stripeEventId: "evt_1234567890failure",
	};

	test("claims each signed event and account scope once", async () => {
		const t = convexTest(schema, modules);

		await expect(t.mutation(api.orders.claimPaymentFailureEmail, claimArgs)).resolves.toBe(true);
		await expect(t.mutation(api.orders.claimPaymentFailureEmail, claimArgs)).resolves.toBe(false);
		await expect(
			t.mutation(api.orders.claimPaymentFailureEmail, {
				...claimArgs,
				stripeConnectedAccountId: "acct_1234567890abcdef",
			}),
		).resolves.toBe(true);

		const claims = await t.run((ctx) => ctx.db.query("stripePaymentFailureEmailClaims").collect());
		expect(claims).toHaveLength(2);
		expect(claims.map(({ accountScope }) => accountScope).sort()).toEqual([
			"connected:acct_1234567890abcdef",
			"platform",
		]);
		expect(claims.every(({ claimedAt }) => Number.isFinite(claimedAt))).toBe(true);
	});

	test("makes concurrent claims converge on one email attempt", async () => {
		const t = convexTest(schema, modules);

		const outcomes = await Promise.all([
			t.mutation(api.orders.claimPaymentFailureEmail, claimArgs),
			t.mutation(api.orders.claimPaymentFailureEmail, claimArgs),
		]);

		expect(outcomes.sort()).toEqual([false, true]);
		const claims = await t.run((ctx) => ctx.db.query("stripePaymentFailureEmailClaims").collect());
		expect(claims).toHaveLength(1);
	});

	test("rejects invalid provider identity and webhook authority", async () => {
		const t = convexTest(schema, modules);

		await expect(
			t.mutation(api.orders.claimPaymentFailureEmail, {
				...claimArgs,
				stripeEventId: "not-an-event",
			}),
		).rejects.toThrow("Invalid Stripe event ID");
		await expect(
			t.mutation(api.orders.claimPaymentFailureEmail, {
				...claimArgs,
				stripeConnectedAccountId: "not-an-account",
			}),
		).rejects.toThrow("Invalid Stripe connected account ID");
		await expect(
			t.mutation(api.orders.claimPaymentFailureEmail, {
				...claimArgs,
				webhookSecret: "wrong-secret",
			}),
		).rejects.toThrow();
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
