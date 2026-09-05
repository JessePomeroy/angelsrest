/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import { reservationHandleHash, reservationSnapshotDigest } from "./helpers/checkoutSnapshot";
import schema from "./schema";
import {
	createGraph,
	graphDraft,
	setup as setupCatalog,
	SITE_A as CATALOG_SITE,
} from "../test/catalogProductGraphFixtures";

const modules = import.meta.glob("./**/*.ts");
const WEBHOOK_SECRET = "test-webhook-secret";
const ORDER_LOOKUP_SECRET = "test-order-lookup-secret";
const SITE_URL = "tenant-a.example";
const CLAIM_TOKEN_A = "123e4567-e89b-42d3-a456-426614174000";
const CLAIM_TOKEN_B = "123e4567-e89b-42d3-a456-426614174001";

beforeEach(() => {
	process.env.WEBHOOK_SECRET = WEBHOOK_SECRET;
	process.env.ORDER_LOOKUP_SECRET = ORDER_LOOKUP_SECRET;
	process.env.ORDER_PRODUCERS_STATE = "open";
});

afterEach(() => {
	delete process.env.WEBHOOK_SECRET;
	delete process.env.ORDER_LOOKUP_SECRET;
	delete process.env.ORDER_PRODUCERS_STATE;
});

const checkoutSnapshot = {
	schemaVersion: 1 as const,
	catalogProvider: "convex" as const,
	items: [
		{
			productKey: "catalog.print-one",
			revisionId: "immutable-revision-1",
			productKind: "print" as const,
			variantKey: "matte-8x10",
			materialOptionKey: "archival-matte",
			sizeOptionKey: "8x10",
			borderOptionKey: null,
			frameOptionKey: "none",
		},
		{
			productKey: "catalog.download-one",
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
		stripePaymentCurrency: "usd",
		stripePaymentLivemode: false,
		customerEmail: "buyer@example.com",
		items: [{ productName: "Paid name", quantity: 2, price: 4200 }],
		total: 8400,
		fulfillmentType: "lumaprints" as const,
	};
}

function retainedOrder(orderNumber: string, stripeSessionId: string, siteUrl = SITE_URL) {
	return {
		siteUrl,
		orderNumber,
		stripeSessionId,
		customerEmail: "buyer@example.com",
		items: [{ productName: "Retained order", quantity: 1, price: 4200 }],
		total: 4200,
		fulfillmentType: "lumaprints" as const,
		status: "new" as const,
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

function automatedRefundReconciliationArgs(
	metadataOrderNumber: string,
	stripeRefundStatus: "pending" | "requires_action" | "succeeded" | "failed" | "canceled",
	overrides: Record<string, unknown> = {},
) {
	return {
		webhookSecret: WEBHOOK_SECRET,
		stripeEventId: "evt_automated1234567890",
		stripeRefundId: "re_automated1234567890",
		stripeRefundStatus,
		stripeSessionId: MANUAL_REFUND.session,
		stripePaymentIntentId: MANUAL_REFUND.paymentIntent,
		siteUrl: SITE_URL,
		metadataOrderNumber,
		automationTag: "fulfillment_recovery_v1" as const,
		refundAmount: 8400,
		sessionAmountTotal: 8400,
		refundCurrency: "usd" as const,
		sessionCurrency: "usd" as const,
		eventLivemode: false,
		sessionLivemode: false,
		...overrides,
	};
}

async function seedRawLegacyPrintOrder(
	t: ReturnType<typeof convexTest>,
	version: "V1" | "V2",
) {
	return await t.run((ctx) => ctx.db.insert("orders", {
		siteUrl: SITE_URL,
		orderNumber: version === "V1" ? "RAW-V1" : "RAW-V2",
		stripeSessionId: MANUAL_REFUND.session,
		stripePaymentIntentId: MANUAL_REFUND.paymentIntent,
		customerEmail: "buyer@example.com",
		items: [{ productName: "Paid name", quantity: 2, price: 4200 }],
		total: 8400,
		fulfillmentType: "lumaprints",
		status: "new",
		printFulfillmentClaim: true,
		...(version === "V1"
			? {}
			: {
					printFulfillmentClaimToken: CLAIM_TOKEN_A,
					printFulfillmentPhase: "submitting" as const,
					printFulfillmentClaimedAt: Date.now(),
					printFulfillmentResolution: "submission_uncertain" as const,
				}),
	}));
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
	await t.mutation(api.orders.claimPrintFulfillment, {
		orderId: created._id,
		webhookSecret: WEBHOOK_SECRET,
	});
	await t.mutation(api.orders.updateStatus, {
		orderId: created._id,
		webhookSecret: WEBHOOK_SECRET,
		lumaprintsOrderNumber: "123",
	});
	await t.mutation(api.orders.updateStatus, {
		orderId: created._id,
		webhookSecret: WEBHOOK_SECRET,
		status: "printing",
	});
	return { t, orderId: created._id };
}

describe("order numbering", () => {
	test("starts at ORD-001 and transitions from ORD-999 to ORD-1000", async () => {
		const t = convexTest(schema, modules);
		const first = await t.mutation(api.orders.create, orderArgs("cs_number_first"));
		expect(first.orderNumber).toBe("ORD-001");

		const transitionSite = "transition.example";
		await t.run((ctx) =>
			ctx.db.insert(
				"orders",
				retainedOrder("ORD-999", "cs_number_999", transitionSite),
			),
		);
		const next = await t.mutation(api.orders.create, {
			...orderArgs("cs_number_1000"),
			siteUrl: transitionSite,
		});
		expect(next.orderNumber).toBe("ORD-1000");
	});

	test.each([
		["malformed", "ORD-NaN", "Newest order number is not canonical"],
		[
			"maximum safe integer",
			`ORD-${Number.MAX_SAFE_INTEGER}`,
			"Newest order number cannot be incremented safely",
		],
	])("fails closed for a %s newest retained row", async (_label, orderNumber, error) => {
		const t = convexTest(schema, modules);
		await t.run((ctx) =>
			ctx.db.insert("orders", retainedOrder(orderNumber, `cs_number_${_label}`)),
		);

		await expect(
			t.mutation(api.orders.create, orderArgs(`cs_number_after_${_label}`)),
		).rejects.toThrow(error);
		const orders = await t.run((ctx) =>
			ctx.db
				.query("orders")
				.withIndex("by_siteUrl", (q) => q.eq("siteUrl", SITE_URL))
				.take(2),
		);
		expect(orders).toHaveLength(1);
	});

	test("rejects an occupied generated candidate instead of skipping it", async () => {
		const t = convexTest(schema, modules);
		await t.run((ctx) =>
			ctx.db.insert("orders", retainedOrder("ORD-010", "cs_number_candidate")),
		);
		await t.run((ctx) =>
			ctx.db.insert("orders", retainedOrder("ORD-009", "cs_number_newest")),
		);

		await expect(
			t.mutation(api.orders.create, orderArgs("cs_number_collision")),
		).rejects.toThrow("Order number already exists for tenant");
		const orders = await t.run((ctx) =>
			ctx.db
				.query("orders")
				.withIndex("by_siteUrl", (q) => q.eq("siteUrl", SITE_URL))
				.take(3),
		);
		expect(orders.map(({ orderNumber }) => orderNumber).sort()).toEqual([
			"ORD-009",
			"ORD-010",
		]);
	});

	test.each([
		["empty", ""],
		["zero", "ORD-000"],
		["unpadded", "ORD-1"],
		["overpadded", "ORD-0001"],
		["not a number", "ORD-NaN"],
		["partial suffix", "ORD-001x"],
		["whitespace", " ORD-001 "],
		["unsafe integer", "ORD-9007199254740992"],
	])("rejects a %s supplied order number", async (label, orderNumber) => {
		const t = convexTest(schema, modules);
		await expect(
			t.mutation(api.orders.create, {
				...orderArgs(`cs_number_supplied_${label}`),
				orderNumber,
			}),
		).rejects.toThrow("Invalid order number");
		expect(await t.run((ctx) => ctx.db.query("orders").take(1))).toEqual([]);
	});

	test("rejects a supplied tenant duplicate but permits the same number for another tenant", async () => {
		const t = convexTest(schema, modules);
		const supplied = await t.mutation(api.orders.create, {
			...orderArgs("cs_number_supplied_first"),
			orderNumber: "ORD-005",
		});
		expect(supplied.orderNumber).toBe("ORD-005");
		await expect(
			t.mutation(api.orders.create, {
				...orderArgs("cs_number_supplied_duplicate"),
				orderNumber: "ORD-005",
			}),
		).rejects.toThrow("Order number already exists for tenant");
		await expect(
			t.mutation(api.orders.create, {
				...orderArgs("cs_number_supplied_other_tenant"),
				siteUrl: "tenant-b.example",
				orderNumber: "ORD-005",
			}),
		).resolves.toMatchObject({ orderNumber: "ORD-005" });
	});

	test("allocates distinct consecutive numbers for concurrent generated creates", async () => {
		const t = convexTest(schema, modules);
		const created = await Promise.all([
			t.mutation(api.orders.create, orderArgs("cs_number_concurrent_a")),
			t.mutation(api.orders.create, orderArgs("cs_number_concurrent_b")),
		]);
		expect(created.map(({ orderNumber }) => orderNumber).sort()).toEqual([
			"ORD-001",
			"ORD-002",
		]);
	});

	test("allows only one concurrent same-tenant supplied create", async () => {
		const t = convexTest(schema, modules);
		const results = await Promise.allSettled([
			t.mutation(api.orders.create, {
				...orderArgs("cs_number_concurrent_supplied_a"),
				orderNumber: "ORD-005",
			}),
			t.mutation(api.orders.create, {
				...orderArgs("cs_number_concurrent_supplied_b"),
				orderNumber: "ORD-005",
			}),
		]);
		const fulfilled = results.filter((result) => result.status === "fulfilled");
		const rejected = results.filter((result) => result.status === "rejected");
		expect(fulfilled).toHaveLength(1);
		expect(rejected).toHaveLength(1);
		expect(String(rejected[0]?.reason)).toContain("Order number already exists for tenant");
		expect(await t.run((ctx) => ctx.db.query("orders").take(2))).toHaveLength(1);
	});

	test("returns a Stripe-session replay before validating a changed supplied number", async () => {
		const t = convexTest(schema, modules);
		const created = await t.mutation(api.orders.create, {
			...orderArgs("cs_number_replay"),
			orderNumber: "ORD-005",
		});
		await expect(
			t.mutation(api.orders.create, {
				...orderArgs("cs_number_replay"),
				orderNumber: "ORD-NaN",
			}),
		).resolves.toMatchObject({
			_id: created._id,
			orderNumber: "ORD-005",
			alreadyExisted: true,
		});
		expect(await t.run((ctx) => ctx.db.query("orders").take(2))).toHaveLength(1);
	});
});

function setOrderProducersState(state: string | undefined) {
	if (state === undefined) delete process.env.ORDER_PRODUCERS_STATE;
	else process.env.ORDER_PRODUCERS_STATE = state;
}

describe("order producer gate", () => {
	test.each([
		["missing", undefined],
		["explicit closed", "closed"],
		["invalid", "true"],
		["malformed", " open "],
		["unknown", "paused"],
	] as const)("rejects a new order for %s state without a write", async (_label, state) => {
		setOrderProducersState(state);
		const t = convexTest(schema, modules);

		await expect(
			t.mutation(api.orders.create, orderArgs(`cs_gate_${_label.replaceAll(" ", "_")}`)),
		).rejects.toThrow("Order producers are closed");
		expect(await t.run((ctx) => ctx.db.query("orders").take(1))).toEqual([]);
	});

	test("creates an order only for the explicit open state", async () => {
		process.env.ORDER_PRODUCERS_STATE = "open";
		const t = convexTest(schema, modules);

		const created = await t.mutation(api.orders.create, orderArgs("cs_gate_open"));

		expect(await t.run((ctx) => ctx.db.get(created._id))).toMatchObject({
			stripeSessionId: "cs_gate_open",
			status: "new",
		});
	});

	test("replays an existing row before closed-gate and supplied-number validation", async () => {
		const t = convexTest(schema, modules);
		const args = {
			...orderArgs("cs_gate_replay"),
			orderNumber: "ORD-005",
		};
		const created = await t.mutation(api.orders.create, args);
		const before = await t.run((ctx) => ctx.db.get(created._id));
		process.env.ORDER_PRODUCERS_STATE = "closed";

		const replay = await t.mutation(api.orders.create, {
			...args,
			orderNumber: "ORD-NaN",
		});

		expect(replay).toMatchObject({
			_id: created._id,
			orderNumber: "ORD-005",
			alreadyExisted: true,
		});
		expect(await t.run((ctx) => ctx.db.query("orders").take(2))).toEqual([before]);
	});
});

describe("durable checkout snapshot", () => {
	test("derives provider fulfillment from the immutable revision and repairs a safe replay", async () => {
		const fixture = await setupCatalog(modules);
		const product = await createGraph(
			fixture.adminA,
			CATALOG_SITE.siteUrl,
			"provider-order",
			graphDraft("print", fixture, "provider-order"),
		);
		const input = {
			siteUrl: CATALOG_SITE.siteUrl,
			stripeSessionId: "cs_test_provider_order",
			customerEmail: "buyer@example.com",
			items: [{ productName: "Provider print", quantity: 1, price: 4200 }],
			total: 4200,
			fulfillmentType: "self" as const,
			checkoutSnapshot: {
				schemaVersion: 1 as const,
				catalogProvider: "convex" as const,
				items: [{
					productKey: product.productId,
					revisionId: product.revisionId,
					productKind: "print" as const,
					variantKey: "matte-small",
					materialOptionKey: "archival-matte",
					sizeOptionKey: "8x10",
					borderOptionKey: "none",
					frameOptionKey: "none",
				}],
			},
		};
		const created = await fixture.adminA.mutation(api.orders.create, input);
		expect(created.fulfillmentType).toBe("lumaprints");
		await fixture.t.run((ctx) => ctx.db.patch(created._id, { fulfillmentType: "self" }));
		const replay = await fixture.adminA.mutation(api.orders.create, input);
		expect(replay).toMatchObject({ alreadyExisted: true, fulfillmentType: "lumaprints" });
		expect((await fixture.t.run((ctx) => ctx.db.get(created._id)))?.fulfillmentType).toBe(
			"lumaprints",
		);
	});

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

describe("immediate order receipts", () => {
	test("allows a pending print receipt with webhook authority and fences legacy confirmation", async () => {
		const t = convexTest(schema, modules);
		const orderId = await seedRawLegacyPrintOrder(t, "V2");
		const args = { orderId, webhookSecret: WEBHOOK_SECRET };
		await expect(t.mutation(api.orders.prepareOrderReceipt, {
			...args, webhookSecret: "invalid",
		})).rejects.toThrow();
		await expect(t.mutation(api.orders.completeOrderReceipt, {
			...args, audience: "customer", webhookSecret: "invalid",
		})).rejects.toThrow();
		await expect(t.mutation(api.orders.completeOrderReceipt, {
			...args, audience: "customer",
		})).resolves.toBe(false);
		await expect(t.mutation(api.orders.prepareOrderReceipt, args)).resolves.toEqual({
			kind: "send", customer: true, admin: true, expiresAt: expect.any(Number),
		});
		const order = await t.run((ctx) => ctx.db.get(orderId));
		expect(order?.orderReceiptStartedAt).toEqual(expect.any(Number));
		expect(order?.orderConfirmationClaimedAt).toBe(order?.orderReceiptStartedAt);
		expect(order?.printFulfillmentResolution).toBe("submission_uncertain");
	});

	test("does not restart historical confirmations or terminal and refund orders", async () => {
		const t = convexTest(schema, modules);
		for (const [index, state] of ([
			{ orderConfirmationClaimedAt: Date.now() },
			{ status: "canceled" }, { status: "refunded" }, { status: "fulfillment_error" },
			{ fulfillmentRecoveryStatus: "refund_pending" },
			{ stripeRefundId: MANUAL_REFUND.refund }, { automatedRefundId: MANUAL_REFUND.refund },
		] as const).entries()) {
			const orderId = await t.run((ctx) => ctx.db.insert("orders", {
				...retainedOrder(`ORD-${index}`, `cs_receipt_suppressed_${index}`), ...state,
			}));
			await expect(t.mutation(api.orders.prepareOrderReceipt, {
				orderId, webhookSecret: WEBHOOK_SECRET,
			})).resolves.toEqual({ kind: "unavailable" });
			expect((await t.run((ctx) => ctx.db.get(orderId)))?.orderReceiptStartedAt).toBeUndefined();
			if (!("orderConfirmationClaimedAt" in state)) {
				await t.run((ctx) => ctx.db.patch(orderId, { orderReceiptStartedAt: Date.now() }));
				await expect(t.mutation(api.orders.prepareOrderReceipt, {
					orderId, webhookSecret: WEBHOOK_SECRET,
				})).resolves.toEqual({ kind: "unavailable" });
			}
		}
	});

	test("retries only unsent audiences within the original 23-hour window", async () => {
		vi.useFakeTimers();
		const now = 1_750_000_000_000;
		vi.setSystemTime(now);
		try {
			const t = convexTest(schema, modules);
			const orderId = await seedRawLegacyPrintOrder(t, "V2");
			const args = { orderId, webhookSecret: WEBHOOK_SECRET };
			const expiresAt = now + 23 * 60 * 60 * 1000;
			const initial = { kind: "send", customer: true, admin: true, expiresAt };
			await expect(t.mutation(api.orders.prepareOrderReceipt, args)).resolves.toEqual(initial);
			await expect(t.mutation(api.orders.prepareOrderReceipt, args)).resolves.toEqual(initial);
			await t.mutation(api.orders.completeOrderReceipt, { ...args, audience: "customer" });
			vi.setSystemTime(expiresAt - 1);
			await t.mutation(api.orders.completeOrderReceipt, { ...args, audience: "customer" });
			await expect(t.mutation(api.orders.prepareOrderReceipt, args)).resolves.toEqual({
				...initial, customer: false,
			});
			vi.setSystemTime(expiresAt);
			await expect(t.mutation(api.orders.prepareOrderReceipt, args)).resolves.toEqual({
				kind: "uncertain",
			});
			const order = await t.run((ctx) => ctx.db.get(orderId));
			expect(order?.orderReceiptStartedAt).toBe(now);
			expect(order?.orderReceiptCustomerSentAt).toBe(now);
			expect(order?.orderReceiptAdminSentAt).toBeUndefined();
			// A delayed provider acknowledgement can still close an expired receipt.
			await t.mutation(api.orders.completeOrderReceipt, { ...args, audience: "admin" });
			await expect(t.mutation(api.orders.prepareOrderReceipt, args)).resolves.toEqual({ kind: "complete" });
		} finally {
			vi.useRealTimers();
		}
	});
});

describe("print fulfillment fence", () => {
	test("uses global session IDs and makes claim/recovery CAS mutually exclusive", async () => {
		const t = convexTest(schema, modules);
		const create = (session: string, siteUrl = SITE_URL, orderNumber?: string) =>
			t.mutation(api.orders.create, {
				...orderArgs(session),
				siteUrl,
				...(orderNumber === undefined ? {} : { orderNumber }),
			});
		const first = await create("cs_test_tenantAglobal1234", SITE_URL, "ORD-005");
		const second = await create(
			"cs_test_tenantBglobal1234",
			"tenant-b.example",
			"ORD-005",
		);
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

	test("accepts the exact baseline V1 and V2 webhook completion sequences", async () => {
		const t = convexTest(schema, modules);
		const v1 = await t.mutation(api.orders.create, orderArgs("cs_test_baselinev112345678"));
		await expect(t.mutation(api.orders.claimPrintFulfillment, {
			orderId: v1._id,
			webhookSecret: WEBHOOK_SECRET,
		})).resolves.toEqual({ kind: "claimed", externalId: "cs_test_baselinev112345678" });
		await expect(t.mutation(api.orders.updateStatus, {
			orderId: v1._id,
			webhookSecret: WEBHOOK_SECRET,
			lumaprintsOrderNumber: "1001",
		})).resolves.toBeNull();

		const v2 = await t.mutation(api.orders.create, orderArgs("cs_test_baselinev212345678"));
		await t.mutation(api.orders.claimPrintFulfillmentV2, {
			orderId: v2._id,
			claimToken: CLAIM_TOKEN_A,
			webhookSecret: WEBHOOK_SECRET,
		});
		await expect(t.mutation(api.orders.beginPrintFulfillmentSubmission, {
			orderId: v2._id,
			claimToken: CLAIM_TOKEN_A,
			webhookSecret: WEBHOOK_SECRET,
		})).resolves.toEqual({ kind: "submitting", externalId: "cs_test_baselinev212345678" });
		await expect(t.mutation(api.orders.updateStatus, {
			orderId: v2._id,
			webhookSecret: WEBHOOK_SECRET,
			lumaprintsOrderNumber: "1002",
		})).resolves.toBeNull();

		for (const [orderId, providerNumber] of [
			[v1._id, "1001"],
			[v2._id, "1002"],
		] as const) {
			const stored = await t.run((ctx) => ctx.db.get(orderId));
			expect(stored).toMatchObject({
				lumaprintsOrderNumber: providerNumber,
				printFulfillmentResolution: "resolved",
			});
				expect(stored?.printFulfillmentClaim).toBeUndefined();
				expect(stored?.printFulfillmentClaimToken).toBeUndefined();
				expect(stored?.printFulfillmentPhase).toBeUndefined();
				expect(stored?.printFulfillmentCoordinatorVersion).toBeUndefined();
				expect(stored?.orderConfirmationClaimedAt).toEqual(expect.any(Number));
				await expect(t.mutation(api.orders.claimOrderConfirmation, {
					orderId,
					webhookSecret: WEBHOOK_SECRET,
				})).resolves.toBe(false);
			await expect(t.mutation(api.orders.updateStatus, {
				orderId,
				webhookSecret: WEBHOOK_SECRET,
				lumaprintsOrderNumber: providerNumber,
			})).rejects.toThrow("cannot be replayed");
		}
	});

	test("accepts the baseline V2 GET-reconciliation retry sequence", async () => {
		const t = convexTest(schema, modules);
		const created = await t.mutation(
			api.orders.create,
			orderArgs("cs_test_baselinev2reconcile1234"),
		);
		await t.mutation(api.orders.claimPrintFulfillmentV2, {
			orderId: created._id,
			claimToken: CLAIM_TOKEN_A,
			webhookSecret: WEBHOOK_SECRET,
		});
		await t.mutation(api.orders.beginPrintFulfillmentSubmission, {
			orderId: created._id,
			claimToken: CLAIM_TOKEN_A,
			webhookSecret: WEBHOOK_SECRET,
		});
		await expect(t.mutation(api.orders.claimPrintFulfillmentV2, {
			orderId: created._id,
			claimToken: CLAIM_TOKEN_B,
			webhookSecret: WEBHOOK_SECRET,
		})).resolves.toEqual({
			kind: "reconcile",
			externalId: "cs_test_baselinev2reconcile1234",
		});
		await expect(t.mutation(api.orders.updateStatus, {
			orderId: created._id,
			webhookSecret: WEBHOOK_SECRET,
			lumaprintsOrderNumber: "1003",
		})).resolves.toBeNull();
		expect(await t.run((ctx) => ctx.db.get(created._id))).toMatchObject({
			lumaprintsOrderNumber: "1003",
			printFulfillmentResolution: "resolved",
		});
		});

	test.each(["", "0", "01", "+1", "1.0", "1e3", " 1", "1 ", "1".repeat(65)])(
		"rejects non-canonical provider number %j at every writer",
		async (providerNumber) => {
			const t = convexTest(schema, modules);
			const legacy = await t.mutation(
				api.orders.create,
				orderArgs(`cs_test_invalidlegacy${providerNumber.length}123456`),
			);
			await t.mutation(api.orders.claimPrintFulfillment, {
				orderId: legacy._id,
				webhookSecret: WEBHOOK_SECRET,
			});
			await expect(t.mutation(api.orders.updateStatus, {
				orderId: legacy._id,
				webhookSecret: WEBHOOK_SECRET,
				lumaprintsOrderNumber: providerNumber,
			})).rejects.toThrow("Invalid LumaPrints order number");

			const tokenized = await t.mutation(
				api.orders.create,
				orderArgs(`cs_test_invalidtoken${providerNumber.length}1234567`),
			);
			await t.mutation(api.orders.claimPrintFulfillmentV2, {
				orderId: tokenized._id,
				claimToken: CLAIM_TOKEN_A,
				webhookSecret: WEBHOOK_SECRET,
			});
			await t.mutation(api.orders.beginPrintFulfillmentSubmission, {
				orderId: tokenized._id,
				claimToken: CLAIM_TOKEN_A,
				webhookSecret: WEBHOOK_SECRET,
			});
			await expect(t.mutation(api.orders.completePrintFulfillmentSubmission, {
				orderId: tokenized._id,
				claimToken: CLAIM_TOKEN_A,
				externalId: `cs_test_invalidtoken${providerNumber.length}1234567`,
				lumaprintsOrderNumber: providerNumber,
				webhookSecret: WEBHOOK_SECRET,
			})).rejects.toThrow("Invalid print fulfillment result");
			await expect(t.mutation(api.orders.reconcilePrintFulfillmentSubmission, {
				orderId: legacy._id,
				externalId: `cs_test_invalidlegacy${providerNumber.length}123456`,
				lumaprintsOrderNumber: providerNumber,
				webhookSecret: WEBHOOK_SECRET,
			})).rejects.toThrow("Invalid print reconciliation result");
		},
	);

	test("accepts the 64-digit canonical provider-number boundary", async () => {
		const t = convexTest(schema, modules);
		const created = await t.mutation(
			api.orders.create,
			orderArgs("cs_test_providerboundary123456"),
		);
		await t.mutation(api.orders.claimPrintFulfillment, {
			orderId: created._id,
			webhookSecret: WEBHOOK_SECRET,
		});
		const providerNumber = "9".repeat(64);
		await expect(t.mutation(api.orders.updateStatus, {
			orderId: created._id,
			webhookSecret: WEBHOOK_SECRET,
			lumaprintsOrderNumber: providerNumber,
		})).resolves.toBeNull();
		expect(await t.run((ctx) => ctx.db.get(created._id))).toMatchObject({
			lumaprintsOrderNumber: providerNumber,
			printFulfillmentResolution: "resolved",
		});
	});

	test("rejects non-webhook, malformed, unclaimed, and conflicting legacy completions", async () => {
		const t = convexTest(schema, modules);
		await t.run((ctx) => ctx.db.insert("platformClients", {
			name: "Tenant",
			email: "owner@tenant.example",
			siteUrl: SITE_URL,
			tier: "full",
			subscriptionStatus: "active",
			adminEmails: ["owner@tenant.example"],
			role: "client",
		}));
		const admin = t.withIdentity({ email: "owner@tenant.example", emailVerified: true });
		const created = await t.mutation(api.orders.create, orderArgs("cs_test_rejectcompat123456"));
		await t.mutation(api.orders.claimPrintFulfillment, {
			orderId: created._id,
			webhookSecret: WEBHOOK_SECRET,
		});

		await expect(t.mutation(api.orders.updateStatus, {
			orderId: created._id,
			webhookSecret: WEBHOOK_SECRET,
			lumaprintsOrderNumber: "bad/provider/number",
		})).rejects.toThrow("Invalid LumaPrints order number");
		await expect(t.mutation(api.orders.updateStatus, {
			orderId: created._id,
			webhookSecret: WEBHOOK_SECRET,
			lumaprintsOrderNumber: "1004",
			status: "printing",
		})).rejects.toThrow("requires exact webhook completion");
		await expect(admin.mutation(api.orders.updateStatus, {
			orderId: created._id,
			lumaprintsOrderNumber: "1005",
		})).rejects.toThrow("LumaPrints order numbers require webhook authority");

		const preparing = await t.mutation(
			api.orders.create,
			orderArgs("cs_test_preparingnotsubmitted1234"),
		);
		await t.mutation(api.orders.claimPrintFulfillmentV2, {
			orderId: preparing._id,
			claimToken: CLAIM_TOKEN_A,
			webhookSecret: WEBHOOK_SECRET,
		});
		await expect(t.mutation(api.orders.updateStatus, {
			orderId: preparing._id,
			webhookSecret: WEBHOOK_SECRET,
			lumaprintsOrderNumber: "1006",
		})).rejects.toThrow("requires exact webhook completion");

			const unclaimed = await t.mutation(
				api.orders.create,
				orderArgs("cs_test_unclaimedprovider12345"),
			);
			await expect(t.mutation(api.orders.updateStatus, {
				orderId: unclaimed._id,
				webhookSecret: WEBHOOK_SECRET,
				lumaprintsOrderNumber: "1007",
			})).rejects.toThrow("requires a claimed or resolved submission");

			const other = await t.mutation(api.orders.create, orderArgs("cs_test_providerowner123456"));
			await t.mutation(api.orders.claimPrintFulfillment, {
				orderId: other._id,
				webhookSecret: WEBHOOK_SECRET,
			});
			await t.mutation(api.orders.updateStatus, {
				orderId: other._id,
				webhookSecret: WEBHOOK_SECRET,
			lumaprintsOrderNumber: "1007",
		});
		await expect(t.mutation(api.orders.updateStatus, {
			orderId: created._id,
			webhookSecret: WEBHOOK_SECRET,
			lumaprintsOrderNumber: "1007",
		})).rejects.toThrow("belongs to another order");

		await t.mutation(api.orders.updateStatus, {
			orderId: created._id,
			webhookSecret: WEBHOOK_SECRET,
			lumaprintsOrderNumber: "1008",
		});
		await expect(t.mutation(api.orders.updateStatus, {
			orderId: created._id,
			webhookSecret: WEBHOOK_SECRET,
			lumaprintsOrderNumber: "1009",
		})).rejects.toThrow("Print fulfillment result conflicts");
	});
});

describe("local fulfillment cancellation", () => {
	test("stops an unresolved print order without erasing its provider fence", async () => {
		const t = convexTest(schema, modules);
		await t.run((ctx) => ctx.db.insert("platformClients", {
			name: "Tenant",
			email: "owner@tenant.example",
			siteUrl: SITE_URL,
			tier: "full",
			subscriptionStatus: "active",
			adminEmails: ["owner@tenant.example"],
			role: "client",
		}));
		const created = await t.mutation(api.orders.create, orderArgs("cs_test_cancel12345678"));
		await t.run((ctx) => ctx.db.patch(created._id, {
			printFulfillmentClaim: true,
			printFulfillmentClaimToken: CLAIM_TOKEN_A,
			printFulfillmentPhase: "submitting",
			printFulfillmentResolution: "submission_uncertain",
		}));
		const admin = t.withIdentity({ email: "owner@tenant.example", emailVerified: true });

		await expect(admin.mutation(api.orders.cancelFulfillment, {
			orderId: created._id,
		})).resolves.toBe(true);
		await expect(admin.mutation(api.orders.cancelFulfillment, {
			orderId: created._id,
		})).resolves.toBe(false);
		expect(await t.run((ctx) => ctx.db.get(created._id))).toMatchObject({
			status: "canceled",
			printFulfillmentClaim: true,
			printFulfillmentClaimToken: CLAIM_TOKEN_A,
			printFulfillmentPhase: "submitting",
			printFulfillmentResolution: "submission_uncertain",
		});
		await expect(admin.mutation(api.orders.updateStatus, {
			orderId: created._id,
			status: "new",
		})).rejects.toThrow("Canceled order fulfillment is terminal");
	});
});

describe("provider-authoritative manual refunds", () => {
	test("converges concurrent refunds for an existing order and preserves its reservation", async () => {
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
					catalogProvider: "convex",
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
		["provider order", { lumaprintsOrderNumber: "123" }],
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

	test("keeps a released V3 row unavailable to legacy V1/V2 coordinators", async () => {
		const t = convexTest(schema, modules);
		const created = await t.mutation(api.orders.create, {
			...orderArgs(MANUAL_REFUND.session),
			stripePaymentIntentId: MANUAL_REFUND.paymentIntent,
		});
		await expect(t.mutation(api.orders.claimPrintFulfillmentV3, {
			orderId: created._id,
			claimToken: CLAIM_TOKEN_A,
			webhookSecret: WEBHOOK_SECRET,
		})).resolves.toMatchObject({ kind: "claimed" });
		await expect(t.mutation(api.orders.releasePrintFulfillmentClaim, {
			orderId: created._id,
			claimToken: CLAIM_TOKEN_A,
			webhookSecret: WEBHOOK_SECRET,
		})).resolves.toBe(true);
		expect(await t.run((ctx) => ctx.db.get(created._id))).toMatchObject({
			printFulfillmentCoordinatorVersion: 3,
		});
		await expect(t.mutation(api.orders.claimPrintFulfillment, {
			orderId: created._id,
			webhookSecret: WEBHOOK_SECRET,
		})).resolves.toEqual({ kind: "busy" });
		await expect(t.mutation(api.orders.claimPrintFulfillmentV2, {
			orderId: created._id,
			claimToken: CLAIM_TOKEN_B,
			webhookSecret: WEBHOOK_SECRET,
		})).resolves.toEqual({ kind: "busy" });
		await expect(t.mutation(api.orders.claimPrintFulfillmentV3, {
			orderId: created._id,
			claimToken: CLAIM_TOKEN_B,
			webhookSecret: WEBHOOK_SECRET,
		})).resolves.toMatchObject({ kind: "claimed" });
	});

	test("preserves every exact V2 return shape for the baseline host decoder", async () => {
		const t = convexTest(schema, modules);
		let sequence = 0;
		const makeOrder = async (patch: Record<string, unknown> = {}) => {
			sequence += 1;
			const created = await t.mutation(api.orders.create, orderArgs(
				`cs_test_v2compat${sequence}12345678`,
			));
			if (Object.keys(patch).length > 0) {
				await t.run((ctx) => ctx.db.patch(created._id, patch));
			}
			return created._id;
		};
		const claim = (orderId: Awaited<ReturnType<typeof makeOrder>>) =>
			t.mutation(api.orders.claimPrintFulfillmentV2, {
				orderId,
				claimToken: CLAIM_TOKEN_B,
				webhookSecret: WEBHOOK_SECRET,
			});

		await expect(claim(await makeOrder({
			lumaprintsOrderNumber: "2101",
			printFulfillmentResolution: "resolved",
		}))).resolves.toEqual({ kind: "fulfilled", orderNumber: "2101" });
		await expect(claim(await makeOrder({
			printFulfillmentClaim: true,
		}))).resolves.toEqual({
			kind: "reconcile",
			externalId: "cs_test_v2compat212345678",
		});
		await expect(claim(await makeOrder({
			status: "refunded",
			stripeRefundId: "re_manualcompat123456",
		}))).resolves.toEqual({
			kind: "manual_refunded",
			stripeRefundId: "re_manualcompat123456",
		});
		await expect(claim(await makeOrder({
			status: "fulfillment_error",
			fulfillmentError: "Provider rejected fulfillment",
			fulfillmentRecoveryStatus: "refunded",
			stripeRefundId: "re_autocompat12345678",
		}))).resolves.toEqual({
			kind: "automated_refunded",
			stripeRefundId: "re_autocompat12345678",
		});
		await expect(claim(await makeOrder({
			status: "fulfillment_error",
			fulfillmentError: "Provider rejected fulfillment",
			fulfillmentRecoveryStatus: "refund_pending",
		}))).resolves.toEqual({ kind: "busy" });
		await expect(claim(await makeOrder({
			printFulfillmentClaim: true,
			printFulfillmentClaimToken: CLAIM_TOKEN_A,
			printFulfillmentPhase: "submitting",
			printFulfillmentResolution: "reconciliation_blocked",
			printFulfillmentReconciliationClass: "response_contract",
		}))).resolves.toEqual({ kind: "busy" });
		await expect(claim(await makeOrder({
			printFulfillmentClaim: true,
			printFulfillmentClaimToken: CLAIM_TOKEN_A,
			printFulfillmentPhase: "preparing",
			printFulfillmentLeaseExpiresAt: Date.now() + 60_000,
		}))).resolves.toEqual({ kind: "preparing" });
		await expect(claim(await makeOrder())).resolves.toEqual({
			kind: "claimed",
			externalId: "cs_test_v2compat812345678",
			leaseExpiresAt: expect.any(Number),
		});
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

	test.each([
		["V1", "refund-first"],
		["V1", "completion-first"],
		["V2", "refund-first"],
		["V2", "completion-first"],
	] as const)(
		"converges the baseline %s completion and a verified refund when %s",
		async (version, ordering) => {
			const t = convexTest(schema, modules);
			const orderId = await seedRawLegacyPrintOrder(t, version);
			const providerNumber = version === "V1"
				? ordering === "refund-first" ? "1101" : "1102"
				: ordering === "refund-first" ? "1103" : "1104";
			const complete = () => t.mutation(api.orders.updateStatus, {
				orderId,
				webhookSecret: WEBHOOK_SECRET,
				lumaprintsOrderNumber: providerNumber,
			});
			const refund = () => t.mutation(
				api.orders.reconcileSucceededManualRefund,
				manualRefundArgs(),
			);
			if (ordering === "refund-first") {
				await expect(refund()).resolves.toEqual({
					kind: "retryable",
					reason: "print_submission_in_flight",
				});
				expect(await t.run((ctx) => ctx.db.query("manualRefundIntents").collect()))
					.toEqual([]);
				await expect(complete()).resolves.toBeNull();
				await expect(refund()).resolves.toEqual({ kind: "reconciled" });
			} else {
				await expect(complete()).resolves.toBeNull();
				await expect(refund()).resolves.toEqual({ kind: "reconciled" });
			}

			const stored = await t.run((ctx) => ctx.db.get(orderId));
			expect(stored).toMatchObject({
				status: "refunded",
				stripeRefundId: MANUAL_REFUND.refund,
				lumaprintsOrderNumber: providerNumber,
				printFulfillmentResolution: "resolved",
			});
			expect(stored?.fulfillmentRecoveryStatus).toBeUndefined();
			expect(stored?.printFulfillmentClaim).toBeUndefined();
			await expect(complete()).rejects.toThrow("cannot be replayed");
			await expect(refund()).resolves.toEqual({ kind: "replayed" });
		},
	);

	test("records the exact GET-confirmed provider result after the refund commits", async () => {
		const t = convexTest(schema, modules);
		const created = await t.mutation(api.orders.create, {
			...orderArgs(MANUAL_REFUND.session),
			stripePaymentIntentId: MANUAL_REFUND.paymentIntent,
		});
		await t.mutation(api.orders.claimPrintFulfillmentV3, {
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
		).resolves.toEqual({ kind: "reconciled" });
		expect(await t.run((ctx) => ctx.db.get(created._id))).toMatchObject({
			status: "refunded",
			stripeRefundId: MANUAL_REFUND.refund,
			stripeFeeCaptureStatus: "canceled",
			printFulfillmentClaim: true,
			printFulfillmentClaimToken: CLAIM_TOKEN_A,
			printFulfillmentPhase: "submitting",
			printFulfillmentResolution: "submission_uncertain",
			printFulfillmentCoordinatorVersion: 3,
		});
		await expect(t.mutation(api.orders.claimPrintFulfillmentV2, {
			orderId: created._id,
			claimToken: CLAIM_TOKEN_B,
			webhookSecret: WEBHOOK_SECRET,
		})).resolves.toEqual({ kind: "reconcile", externalId: MANUAL_REFUND.session });
		await expect(t.mutation(api.orders.reconcilePrintFulfillmentSubmission, {
			orderId: created._id,
			externalId: MANUAL_REFUND.session,
			lumaprintsOrderNumber: "1201",
			webhookSecret: WEBHOOK_SECRET,
		})).resolves.toEqual({
			kind: "manual_refunded",
			stripeRefundId: MANUAL_REFUND.refund,
		});
		expect(await t.run((ctx) => ctx.db.get(created._id))).toMatchObject({
			status: "refunded",
			stripeRefundId: MANUAL_REFUND.refund,
			lumaprintsOrderNumber: "1201",
			printFulfillmentResolution: "resolved",
		});
		await expect(
			t.mutation(api.orders.reconcileSucceededManualRefund, manualRefundArgs()),
		).resolves.toEqual({ kind: "replayed" });
	});

	test("projects the refund after the fenced provider result commits", async () => {
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
		await t.mutation(api.orders.beginPrintFulfillmentSubmission, {
			orderId: created._id,
			claimToken: CLAIM_TOKEN_A,
			webhookSecret: WEBHOOK_SECRET,
		});
		await expect(t.mutation(api.orders.completePrintFulfillmentSubmission, {
			orderId: created._id,
			claimToken: CLAIM_TOKEN_A,
			externalId: MANUAL_REFUND.session,
			lumaprintsOrderNumber: "1202",
			webhookSecret: WEBHOOK_SECRET,
		})).resolves.toEqual({ kind: "fulfilled" });

		await expect(t.mutation(
			api.orders.reconcileSucceededManualRefund,
			manualRefundArgs(),
		)).resolves.toEqual({ kind: "reconciled" });
		expect(await t.run((ctx) => ctx.db.get(created._id))).toMatchObject({
			status: "refunded",
			stripeRefundId: MANUAL_REFUND.refund,
			lumaprintsOrderNumber: "1202",
			printFulfillmentResolution: "resolved",
		});
		await expect(t.mutation(
			api.orders.reconcileSucceededManualRefund,
			manualRefundArgs(),
		)).resolves.toEqual({ kind: "replayed" });
	});

	test("serializes a manual refund against the provider submission fence", async () => {
		const t = convexTest(schema, modules);
		const created = await t.mutation(api.orders.create, {
			...orderArgs(MANUAL_REFUND.session),
			stripePaymentIntentId: MANUAL_REFUND.paymentIntent,
		});
		await t.mutation(api.orders.claimPrintFulfillmentV3, {
			orderId: created._id,
			claimToken: CLAIM_TOKEN_A,
			webhookSecret: WEBHOOK_SECRET,
		});

		const [submission, refund] = await Promise.all([
			t.mutation(api.orders.beginPrintFulfillmentSubmission, {
				orderId: created._id,
				claimToken: CLAIM_TOKEN_A,
				webhookSecret: WEBHOOK_SECRET,
			}),
			t.mutation(api.orders.reconcileSucceededManualRefund, manualRefundArgs()),
		]);
		expect(refund).toEqual({ kind: "reconciled" });
		expect(["submitting", "manual_refunded"]).toContain(submission.kind);

		const stored = await t.run((ctx) => ctx.db.get(created._id));
		expect(stored).toMatchObject({
			status: "refunded",
			stripeRefundId: MANUAL_REFUND.refund,
			stripeFeeCaptureStatus: "canceled",
		});
		if (submission.kind === "submitting") {
			expect(stored).toMatchObject({
				printFulfillmentClaim: true,
				printFulfillmentClaimToken: CLAIM_TOKEN_A,
				printFulfillmentPhase: "submitting",
			});
		} else {
			expect(submission).toEqual({
				kind: "manual_refunded",
				stripeRefundId: MANUAL_REFUND.refund,
			});
			expect(stored?.printFulfillmentClaim).toBeUndefined();
			expect(stored?.printFulfillmentPhase).toBeUndefined();
		}
		const retry = t.mutation(api.orders.claimPrintFulfillmentV2, {
			orderId: created._id,
			claimToken: CLAIM_TOKEN_B,
			webhookSecret: WEBHOOK_SECRET,
		});
		if (submission.kind === "submitting") {
			await expect(retry).resolves.toEqual({
				kind: "reconcile",
				externalId: MANUAL_REFUND.session,
			});
		} else {
			await expect(retry).resolves.toEqual({
				kind: "manual_refunded",
				stripeRefundId: MANUAL_REFUND.refund,
			});
		}
	});

	test("lets a verified manual refund clear a V3 preparation lease and block its POST fence", async () => {
		const t = convexTest(schema, modules);
		const created = await t.mutation(api.orders.create, {
			...orderArgs(MANUAL_REFUND.session),
			stripePaymentIntentId: MANUAL_REFUND.paymentIntent,
		});
		await expect(t.mutation(api.orders.claimPrintFulfillmentV3, {
			orderId: created._id,
			claimToken: CLAIM_TOKEN_A,
			webhookSecret: WEBHOOK_SECRET,
		})).resolves.toMatchObject({ kind: "claimed" });

		await expect(
			t.mutation(api.orders.reconcileSucceededManualRefund, manualRefundArgs()),
		).resolves.toEqual({ kind: "reconciled" });
		const stored = await t.run((ctx) => ctx.db.get(created._id));
		expect(stored).toMatchObject({
			status: "refunded",
			stripeRefundId: MANUAL_REFUND.refund,
			printFulfillmentCoordinatorVersion: 3,
		});
		expect(stored?.printFulfillmentClaim).toBeUndefined();
		expect(stored?.printFulfillmentClaimToken).toBeUndefined();
		expect(stored?.printFulfillmentPhase).toBeUndefined();
		expect(stored?.printFulfillmentClaimedAt).toBeUndefined();
		expect(stored?.printFulfillmentLeaseExpiresAt).toBeUndefined();
		expect(stored?.printFulfillmentResolution).toBeUndefined();
		await expect(t.mutation(api.orders.beginPrintFulfillmentSubmission, {
			orderId: created._id,
			claimToken: CLAIM_TOKEN_A,
			webhookSecret: WEBHOOK_SECRET,
		})).resolves.toEqual({
			kind: "manual_refunded",
			stripeRefundId: MANUAL_REFUND.refund,
		});
	});

	test("keeps an exact V1 phase-undefined claim uncertain until the old host completes", async () => {
		const t = convexTest(schema, modules);
		const created = await t.mutation(api.orders.create, {
			...orderArgs(MANUAL_REFUND.session),
			stripePaymentIntentId: MANUAL_REFUND.paymentIntent,
		});
		// V1 wrote only the boolean. Keep this fixture byte-for-byte at that shape.
		await t.run((ctx) => ctx.db.patch(created._id, { printFulfillmentClaim: true }));

		await expect(
			t.mutation(api.orders.reconcileSucceededManualRefund, manualRefundArgs()),
		).resolves.toEqual({
			kind: "retryable",
			reason: "print_submission_in_flight",
		});
		const uncertain = await t.run((ctx) => ctx.db.get(created._id));
		expect(uncertain).toMatchObject({
			status: "new",
			printFulfillmentClaim: true,
		});
		expect(uncertain?.printFulfillmentPhase).toBeUndefined();
		expect(uncertain?.printFulfillmentClaimedAt).toBeUndefined();
		expect(uncertain?.stripeRefundId).toBeUndefined();
		expect(await t.run((ctx) => ctx.db.query("manualRefundIntents").collect()))
			.toEqual([]);

		await expect(t.mutation(api.orders.updateStatus, {
			orderId: created._id,
			lumaprintsOrderNumber: "1203",
			webhookSecret: WEBHOOK_SECRET,
		})).resolves.toBeNull();
		await expect(
			t.mutation(api.orders.reconcileSucceededManualRefund, manualRefundArgs()),
		).resolves.toEqual({ kind: "reconciled" });
		expect(await t.run((ctx) => ctx.db.get(created._id))).toMatchObject({
			status: "refunded",
			stripeRefundId: MANUAL_REFUND.refund,
			lumaprintsOrderNumber: "1203",
			printFulfillmentResolution: "resolved",
		});
	});

	test("atomically checkpoints a token-bound definite provider rejection", async () => {
		const t = convexTest(schema, modules);
		const created = await t.mutation(
			api.orders.create,
			orderArgs("cs_test_definiterejection1234"),
		);
		await t.mutation(api.orders.claimPrintFulfillmentV2, {
			orderId: created._id,
			claimToken: CLAIM_TOKEN_A,
			webhookSecret: WEBHOOK_SECRET,
		});
		await t.mutation(api.orders.beginPrintFulfillmentSubmission, {
			orderId: created._id,
			claimToken: CLAIM_TOKEN_A,
			webhookSecret: WEBHOOK_SECRET,
		});

		await expect(t.mutation(api.orders.rejectPrintFulfillmentSubmission, {
			orderId: created._id,
			claimToken: CLAIM_TOKEN_B,
			externalId: "cs_test_definiterejection1234",
			webhookSecret: WEBHOOK_SECRET,
		})).rejects.toThrow("submission claim is unavailable");
		await expect(t.mutation(api.orders.rejectPrintFulfillmentSubmission, {
			orderId: created._id,
			claimToken: CLAIM_TOKEN_A,
			externalId: "cs_test_definiterejection1234",
			webhookSecret: WEBHOOK_SECRET,
		})).resolves.toEqual({ kind: "refund_pending" });

		const stored = await t.run((ctx) => ctx.db.get(created._id));
		expect(stored).toMatchObject({
			status: "fulfillment_error",
			fulfillmentError: "Print provider rejected fulfillment",
			fulfillmentRecoveryStatus: "refund_pending",
			automatedRefundPreRequestProtocol: "print_rejection_v1",
		});
		expect(stored?.printFulfillmentClaim).toBeUndefined();
		expect(stored?.printFulfillmentClaimToken).toBeUndefined();
		expect(stored?.printFulfillmentPhase).toBeUndefined();
		expect(stored?.printFulfillmentResolution).toBeUndefined();
		const refundClaimArgs = (claimToken: string) => ({
			orderId: created._id,
			claimToken,
			fulfillmentError: "Print provider rejected fulfillment",
			webhookSecret: WEBHOOK_SECRET,
		});
		await expect(t.mutation(
			api.orders.claimAutomatedFulfillmentRefundV2,
			refundClaimArgs(CLAIM_TOKEN_A),
		)).resolves.toMatchObject({ kind: "claimed" });
		expect((await t.run((ctx) => ctx.db.get(created._id)))?.automatedRefundPreRequestProtocol)
			.toBeUndefined();
		await t.run((ctx) => ctx.db.patch(created._id, { automatedRefundLeaseExpiresAt: 0 }));
		await expect(t.mutation(
			api.orders.claimAutomatedFulfillmentRefundV2,
			refundClaimArgs(CLAIM_TOKEN_B),
		)).resolves.toEqual({ kind: "unavailable" });
		await expect(t.mutation(api.orders.claimPrintFulfillmentV2, {
			orderId: created._id,
			claimToken: CLAIM_TOKEN_B,
			webhookSecret: WEBHOOK_SECRET,
		})).resolves.toEqual({ kind: "busy" });
	});

	test("clears a canceled order's exact-token provider fence", async () => {
		const t = convexTest(schema, modules);
		const externalId = "cs_test_canceledrejection123456";
		const created = await t.mutation(api.orders.create, orderArgs(externalId));
		await t.run((ctx) => ctx.db.patch(created._id, {
			printFulfillmentClaim: true,
			printFulfillmentClaimToken: CLAIM_TOKEN_A,
			printFulfillmentPhase: "submitting",
			printFulfillmentCoordinatorVersion: 5,
			printFulfillmentResolution: "submission_uncertain",
		}));
		await t.run((ctx) => ctx.db.patch(created._id, { status: "canceled" }));

		await expect(t.mutation(api.orders.rejectPrintFulfillmentSubmission, {
			orderId: created._id,
			claimToken: CLAIM_TOKEN_A,
			externalId,
			webhookSecret: WEBHOOK_SECRET,
		})).resolves.toEqual({ kind: "canceled" });
		const stored = await t.run((ctx) => ctx.db.get(created._id));
		expect(stored?.status).toBe("canceled");
		expect(stored).not.toHaveProperty("printFulfillmentClaim");
		expect(stored).not.toHaveProperty("printFulfillmentClaimToken");
		expect(stored).not.toHaveProperty("printFulfillmentPhase");
		expect(stored).not.toHaveProperty("printFulfillmentResolution");
	});

	test("lets a legacy host consume a definite-rejection refund marker only once", async () => {
		const t = convexTest(schema, modules);
		const created = await t.mutation(api.orders.create, {
			...orderArgs("cs_test_legacydefiniterejection123"),
			stripePaymentIntentId: MANUAL_REFUND.paymentIntent,
		});
		const fulfillmentError = "Print provider rejected fulfillment";
		await t.run((ctx) => ctx.db.patch(created._id, {
			status: "fulfillment_error",
			fulfillmentError,
			fulfillmentRecoveryStatus: "refund_pending",
			automatedRefundPreRequestProtocol: "print_rejection_v1",
		}));
		const args = (claimToken: string) => ({
			orderId: created._id,
			claimToken,
			fulfillmentError,
			webhookSecret: WEBHOOK_SECRET,
		});

		await expect(t.mutation(api.orders.claimAutomatedFulfillmentRefund, args(CLAIM_TOKEN_A)))
			.resolves.toMatchObject({ kind: "claimed" });
		expect((await t.run((ctx) => ctx.db.get(created._id)))?.automatedRefundPreRequestProtocol)
			.toBeUndefined();
		await t.run((ctx) => ctx.db.patch(created._id, { automatedRefundLeaseExpiresAt: 0 }));
		await expect(t.mutation(api.orders.claimAutomatedFulfillmentRefund, args(CLAIM_TOKEN_B)))
			.resolves.toEqual({ kind: "unavailable" });
		expect(await t.run((ctx) => ctx.db.get(created._id))).toMatchObject({
			fulfillmentRecoveryStatus: "refund_attention",
			automatedRefundAttentionReason: "request_outcome_unknown",
		});
	});

	test("preserves manual refund truth racing a definite provider rejection", async () => {
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
		await t.mutation(api.orders.beginPrintFulfillmentSubmission, {
			orderId: created._id,
			claimToken: CLAIM_TOKEN_A,
			webhookSecret: WEBHOOK_SECRET,
		});

		const [rejection, refund] = await Promise.all([
			t.mutation(api.orders.rejectPrintFulfillmentSubmission, {
				orderId: created._id,
				claimToken: CLAIM_TOKEN_A,
				externalId: MANUAL_REFUND.session,
				webhookSecret: WEBHOOK_SECRET,
			}),
			t.mutation(api.orders.reconcileSucceededManualRefund, manualRefundArgs()),
		]);
		expect(["refund_pending", "manual_refunded"]).toContain(rejection.kind);
		expect(refund).toEqual({ kind: "reconciled" });
		const stored = await t.run((ctx) => ctx.db.get(created._id));
		expect(stored).toMatchObject({
			status: "refunded",
			stripeRefundId: MANUAL_REFUND.refund,
		});
		expect(stored?.fulfillmentRecoveryStatus).toBeUndefined();
		expect(stored?.printFulfillmentClaim).toBeUndefined();
		expect(stored?.printFulfillmentResolution).toBeUndefined();
	});

	test("requires GET-only recovery after a deterministic reconciliation block", async () => {
		const t = convexTest(schema, modules);
		const created = await t.mutation(api.orders.create, {
			...orderArgs(MANUAL_REFUND.session),
			stripePaymentIntentId: MANUAL_REFUND.paymentIntent,
		});
		await t.mutation(api.orders.claimPrintFulfillmentV3, {
			orderId: created._id,
			claimToken: CLAIM_TOKEN_A,
			webhookSecret: WEBHOOK_SECRET,
		});
		await t.mutation(api.orders.beginPrintFulfillmentSubmission, {
			orderId: created._id,
			claimToken: CLAIM_TOKEN_A,
			webhookSecret: WEBHOOK_SECRET,
		});
		await expect(t.mutation(api.orders.blockPrintFulfillmentReconciliation, {
			orderId: created._id,
			externalId: MANUAL_REFUND.session,
			reconciliationClass: "response_contract",
			webhookSecret: WEBHOOK_SECRET,
		})).resolves.toBe(true);
		await expect(t.mutation(api.orders.claimPrintFulfillmentV2, {
			orderId: created._id,
			claimToken: CLAIM_TOKEN_B,
			webhookSecret: WEBHOOK_SECRET,
		})).resolves.toEqual({ kind: "busy" });
		await t.mutation(api.orders.reconcileSucceededManualRefund, manualRefundArgs());
		await expect(t.mutation(api.orders.reconcilePrintFulfillmentSubmission, {
			orderId: created._id,
			externalId: MANUAL_REFUND.session,
			lumaprintsOrderNumber: "1204",
			webhookSecret: WEBHOOK_SECRET,
		})).resolves.toEqual({
			kind: "manual_refunded",
			stripeRefundId: MANUAL_REFUND.refund,
		});
		expect(await t.run((ctx) => ctx.db.get(created._id))).toMatchObject({
			status: "refunded",
			lumaprintsOrderNumber: "1204",
			printFulfillmentResolution: "resolved",
		});
	});

	test("keeps one handle-v2 order and immutable snapshot across refund and checkout replays", async () => {
		const t = convexTest(schema, modules);
		const handle = "123e4567-e89b-42d3-a456-426614174099";
		const snapshot = {
			schemaVersion: 1 as const,
			catalogProvider: "convex" as const,
			items: [{
				productKey: "catalog.print",
				revisionId: "immutable-revision",
				productKind: "print" as const,
				variantKey: "paper-size",
				materialOptionKey: "paper",
				sizeOptionKey: "size",
				borderOptionKey: null,
				frameOptionKey: null,
			}],
		};
		const handleHash = await reservationHandleHash(SITE_URL, handle);
		const snapshotDigest = await reservationSnapshotDigest(snapshot);
		await t.run((ctx) => ctx.db.insert("checkoutSnapshotReservations", {
			state: "bound",
			siteUrl: SITE_URL,
			handleHash,
			snapshotDigest,
			snapshot,
			accountScope: "platform",
			stripeSessionId: MANUAL_REFUND.session,
			stripeExpiresAt: Math.floor(Date.now() / 1000) + 60 * 60,
			unboundPurgeAt: Date.now() + 60 * 60 * 1000,
			boundReconcileAt: Date.now() + 36 * 24 * 60 * 60 * 1000,
			createdAt: Date.now(),
			updatedAt: Date.now(),
			boundAt: Date.now(),
			reconciliationAttempt: 0,
			reconciliationNextAt: Date.now() + 36 * 24 * 60 * 60 * 1000,
		}));
		const createArgs = {
			...orderArgs(MANUAL_REFUND.session),
			items: [{ productName: "Immutable print", quantity: 1, price: 8400 }],
			stripePaymentIntentId: MANUAL_REFUND.paymentIntent,
			checkoutSnapshotReservation: { version: 2, handle },
		};
		const created = await t.mutation(api.orders.create, createArgs);
		expect(created.checkoutSnapshot).toEqual(snapshot);
		expect(await t.run((ctx) => ctx.db.query("checkoutSnapshotReservations").take(1)))
			.toEqual([]);

		// Reproduce the exact V1 durable row: the boolean exists and no lease field does.
		await t.run((ctx) => ctx.db.patch(created._id, { printFulfillmentClaim: true }));
		await expect(t.mutation(api.orders.claimPrintFulfillmentV2, {
			orderId: created._id,
			claimToken: CLAIM_TOKEN_A,
			webhookSecret: WEBHOOK_SECRET,
		})).resolves.toEqual({ kind: "reconcile", externalId: MANUAL_REFUND.session });

		const createdEvent = manualRefundArgs({ stripeEventId: "evt_created1234567890" });
		const updatedEvent = manualRefundArgs({ stripeEventId: "evt_updated1234567890" });
		await expect(t.mutation(api.orders.reconcileSucceededManualRefund, createdEvent))
			.resolves.toEqual({
				kind: "retryable",
				reason: "print_submission_in_flight",
			});
		await expect(t.mutation(api.orders.updateStatus, {
			orderId: created._id,
			lumaprintsOrderNumber: "1500",
			webhookSecret: WEBHOOK_SECRET,
		})).resolves.toBeNull();
		await expect(t.mutation(api.orders.reconcileSucceededManualRefund, createdEvent))
			.resolves.toEqual({ kind: "reconciled" });
		for (const delivery of [createdEvent, updatedEvent, updatedEvent]) {
			await expect(t.mutation(api.orders.reconcileSucceededManualRefund, delivery))
				.resolves.toEqual({ kind: "replayed" });
		}

		const replay = await t.mutation(api.orders.create, createArgs);
		expect(replay).toMatchObject({ _id: created._id, alreadyExisted: true, status: "refunded" });
		const orders = await t.run((ctx) => ctx.db.query("orders").take(2));
		expect(orders).toHaveLength(1);
		expect(orders[0]).toMatchObject({
			checkoutSnapshot: snapshot,
			lumaprintsOrderNumber: "1500",
			printFulfillmentResolution: "resolved",
			status: "refunded",
		});
		expect(orders[0].printFulfillmentClaim).toBeUndefined();
		expect(orders[0].orderConfirmationClaimedAt).toEqual(expect.any(Number));
		expect(await t.run((ctx) => ctx.db.query("manualRefundIntents").take(2)))
			.toHaveLength(1);
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
			// Terminal provider refund truth wins even over unusable compatibility input.
			stripeFees: -1,
		});
			expect(created).toMatchObject({
				alreadyExisted: true,
				status: "refunded",
				stripeRefundId: MANUAL_REFUND.refund,
				stripeFeeCaptureStatus: "canceled",
			});
			expect(created.stripeFees).toBeUndefined();
			expect(created.stripeFeeCaptureAttempts).toBeUndefined();
			expect(created.stripeFeeCaptureNextAttemptAt).toBeUndefined();
		const stored = await t.run((ctx) => ctx.db.get(created._id));
		expect(stored).toMatchObject({
			status: "refunded",
			stripeRefundId: MANUAL_REFUND.refund,
		});
			expect(stored?.stripeFeeCaptureStatus).toBe("canceled");
			expect(stored?.stripeFees).toBeUndefined();
			expect(stored?.stripeFeeProvenance).toBeUndefined();
			expect(stored?.stripeFeeCaptureAttempts).toBeUndefined();
			expect(stored?.stripeFeeCaptureNextAttemptAt).toBeUndefined();
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
		await expect(t.mutation(api.orders.claimOrderConfirmation, {
			orderId: created._id,
			webhookSecret: WEBHOOK_SECRET,
		})).resolves.toBe(false);
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
		expect(claimResult.status).toBe("fulfilled");
		expect(refundResult.status).toBe("fulfilled");
		if (refundResult.status !== "fulfilled" || claimResult.status !== "fulfilled") return;
		if (refundResult.value.kind === "reconciled") {
			expect(stored).toMatchObject({
				status: "refunded",
				stripeRefundId: MANUAL_REFUND.refund,
			});
			expect(stored?.printFulfillmentClaim).toBeUndefined();
			expect(claimResult.value).toEqual({
				kind: "manual_refunded",
				stripeRefundId: MANUAL_REFUND.refund,
			});
		} else {
			expect(refundResult.value).toEqual({
				kind: "retryable",
				reason: "print_submission_in_flight",
			});
			expect(claimResult.value).toEqual({
				kind: "claimed",
				externalId: MANUAL_REFUND.session,
				leaseExpiresAt: expect.any(Number),
			});
			expect(stored).toMatchObject({ status: "new", printFulfillmentClaim: true });
			expect(stored?.stripeRefundId).toBeUndefined();
		}
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
		const admin = t.withIdentity({ email: "owner@tenant.example", emailVerified: true });
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
		await expect(admin.mutation(api.orders.updateStatus, {
			orderId: created._id,
			lumaprintsOrderNumber: "1501",
		})).rejects.toThrow("LumaPrints order numbers require webhook authority");
		for (const fulfillmentFact of [
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

describe("automated fulfillment refund claims", () => {
	test("persists pending before succeeded and leases each notification until sent", async () => {
		const t = convexTest(schema, modules);
		const created = await t.mutation(api.orders.create, {
			...orderArgs(MANUAL_REFUND.session),
			stripePaymentIntentId: MANUAL_REFUND.paymentIntent,
		});
		const fulfillmentError = "Fulfillment validation rejected";
		await expect(t.mutation(api.orders.claimAutomatedFulfillmentRefundV2, {
			orderId: created._id,
			claimToken: CLAIM_TOKEN_A,
			fulfillmentError,
			webhookSecret: WEBHOOK_SECRET,
		})).resolves.toMatchObject({ kind: "claimed", leaseExpiresAt: expect.any(Number) });
		expect(await t.run((ctx) => ctx.db.get(created._id))).toMatchObject({
			status: "fulfillment_error",
			fulfillmentError,
			fulfillmentRecoveryStatus: "refund_pending",
			automatedRefundClaimToken: CLAIM_TOKEN_A,
			automatedRefundLeaseExpiresAt: expect.any(Number),
		});
		await expect(t.mutation(api.orders.claimAutomatedFulfillmentRefundV2, {
			orderId: created._id,
			claimToken: CLAIM_TOKEN_B,
			fulfillmentError,
			webhookSecret: WEBHOOK_SECRET,
		})).resolves.toMatchObject({ kind: "busy", leaseExpiresAt: expect.any(Number) });
		await expect(t.mutation(api.orders.releaseAutomatedFulfillmentRefund, {
			orderId: created._id,
			claimToken: CLAIM_TOKEN_B,
			webhookSecret: WEBHOOK_SECRET,
		})).resolves.toBe(false);
		await expect(t.mutation(api.orders.claimAutomatedFulfillmentRefundV2, {
			orderId: created._id,
			claimToken: CLAIM_TOKEN_B,
			fulfillmentError: "Print fulfillment unavailable",
			webhookSecret: WEBHOOK_SECRET,
		})).resolves.toEqual({ kind: "unavailable" });
		await expect(t.mutation(api.orders.recordAutomatedFulfillmentRefund, {
			orderId: created._id,
			claimToken: CLAIM_TOKEN_A,
			stripeRefundId: "re_automatedrefund123456",
			stripeRefundStatus: "pending",
			webhookSecret: WEBHOOK_SECRET,
		})).resolves.toEqual({ kind: "pending", refundStatus: "pending" });
		expect(await t.run((ctx) => ctx.db.get(created._id))).toMatchObject({
			status: "fulfillment_error",
			fulfillmentError,
			fulfillmentRecoveryStatus: "refund_pending",
			automatedRefundId: "re_automatedrefund123456",
			automatedRefundStatus: "pending",
		});
		expect((await t.run((ctx) => ctx.db.get(created._id)))?.stripeRefundId).toBeUndefined();
		await expect(t.mutation(api.orders.claimAutomatedFulfillmentRefundV2, {
			orderId: created._id,
			claimToken: CLAIM_TOKEN_A,
			fulfillmentError,
			webhookSecret: WEBHOOK_SECRET,
		})).resolves.toMatchObject({
			kind: "claimed",
			stripeRefundId: "re_automatedrefund123456",
			refundStatus: "pending",
		});
		await expect(t.mutation(api.orders.recordAutomatedFulfillmentRefund, {
			orderId: created._id,
			claimToken: CLAIM_TOKEN_A,
			stripeRefundId: "re_automatedrefund123456",
			stripeRefundStatus: "succeeded",
			webhookSecret: WEBHOOK_SECRET,
		})).resolves.toMatchObject({
			kind: "succeeded",
			stripeRefundId: "re_automatedrefund123456",
		});
		for (const audience of ["admin", "customer"] as const) {
			await expect(t.mutation(api.orders.claimFulfillmentFailureNotification, {
				orderId: created._id,
				audience,
				webhookSecret: WEBHOOK_SECRET,
			})).resolves.toBe(false);
			await expect(t.mutation(api.orders.claimFulfillmentFailureNotificationV2, {
				orderId: created._id,
				audience,
				claimToken: CLAIM_TOKEN_A,
				webhookSecret: WEBHOOK_SECRET,
			})).resolves.toEqual({ kind: "claimed" });
			await expect(t.mutation(api.orders.claimFulfillmentFailureNotificationV2, {
				orderId: created._id,
				audience,
				claimToken: CLAIM_TOKEN_B,
				webhookSecret: WEBHOOK_SECRET,
			})).resolves.toMatchObject({ kind: "busy", leaseExpiresAt: expect.any(Number) });
			await expect(t.mutation(api.orders.releaseFulfillmentFailureNotificationV2, {
				orderId: created._id,
				audience,
				claimToken: CLAIM_TOKEN_A,
				webhookSecret: WEBHOOK_SECRET,
			})).resolves.toBe(true);
			await t.mutation(api.orders.claimFulfillmentFailureNotificationV2, {
				orderId: created._id,
				audience,
				claimToken: CLAIM_TOKEN_B,
				webhookSecret: WEBHOOK_SECRET,
			});
			await expect(t.mutation(api.orders.completeFulfillmentFailureNotificationV2, {
				orderId: created._id,
				audience,
				claimToken: CLAIM_TOKEN_B,
				webhookSecret: WEBHOOK_SECRET,
			})).resolves.toBe(true);
			await expect(t.mutation(api.orders.claimFulfillmentFailureNotificationV2, {
				orderId: created._id,
				audience,
				claimToken: CLAIM_TOKEN_A,
				webhookSecret: WEBHOOK_SECRET,
			})).resolves.toEqual({ kind: "unavailable" });
		}
	});

	test("stops refund notification sends at the bounded retry deadline", async () => {
		const t = convexTest(schema, modules);
		const created = await t.mutation(api.orders.create, {
			...orderArgs(MANUAL_REFUND.session),
			stripePaymentIntentId: MANUAL_REFUND.paymentIntent,
		});
		const firstAttemptAt = Date.now() - 23 * 60 * 60 * 1000;
		await t.run((ctx) => ctx.db.patch(created._id, {
			status: "fulfillment_error",
			fulfillmentError: "Fulfillment validation rejected",
			fulfillmentRecoveryStatus: "refunded",
			stripeRefundId: "re_notificationwindow123456",
			automatedRefundId: "re_notificationwindow123456",
			automatedRefundStatus: "succeeded",
			fulfillmentFailureNotificationProtocol: "leased_v1",
			fulfillmentFailureNotificationRetryProtocol: "bounded_23h_v1",
			fulfillmentFailureAdminNotificationClaimedAt: firstAttemptAt,
			fulfillmentFailureAdminNotificationClaimToken: CLAIM_TOKEN_A,
			fulfillmentFailureAdminNotificationLeaseExpiresAt: 0,
			fulfillmentFailureCustomerNotificationClaimedAt: firstAttemptAt,
			fulfillmentFailureCustomerNotificationClaimToken: CLAIM_TOKEN_A,
			fulfillmentFailureCustomerNotificationLeaseExpiresAt: 0,
		}));
		for (const audience of ["admin", "customer"] as const) {
			await expect(t.mutation(api.orders.claimFulfillmentFailureNotificationV2, {
				orderId: created._id,
				audience,
				claimToken: CLAIM_TOKEN_B,
				webhookSecret: WEBHOOK_SECRET,
			})).resolves.toEqual({ kind: "unavailable" });
			await expect(t.mutation(api.orders.isFulfillmentFailureNotificationDeliveryUncertain, {
				orderId: created._id,
				audience,
				webhookSecret: WEBHOOK_SECRET,
			})).resolves.toBe(true);
			await expect(t.mutation(api.orders.releaseFulfillmentFailureNotificationV2, {
				orderId: created._id,
				audience,
				claimToken: CLAIM_TOKEN_A,
				webhookSecret: WEBHOOK_SECRET,
			})).resolves.toBe(false);
			await expect(t.mutation(api.orders.completeFulfillmentFailureNotificationV2, {
				orderId: created._id,
				audience,
				claimToken: CLAIM_TOKEN_A,
				webhookSecret: WEBHOOK_SECRET,
			})).resolves.toBe(false);
		}
		const stored = await t.run((ctx) => ctx.db.get(created._id));
		expect(stored).toMatchObject({
			fulfillmentFailureAdminNotificationDeliveryUncertainAt: expect.any(Number),
			fulfillmentFailureCustomerNotificationDeliveryUncertainAt: expect.any(Number),
		});
		expect(stored?.fulfillmentFailureAdminNotificationClaimToken).toBeUndefined();
		expect(stored?.fulfillmentFailureCustomerNotificationClaimToken).toBeUndefined();
	});

	test("fails closed for a refund notification released before bounded retries", async () => {
		const t = convexTest(schema, modules);
		const created = await t.mutation(api.orders.create, {
			...orderArgs("cs_test_oldreleasednotice1234"),
			stripePaymentIntentId: MANUAL_REFUND.paymentIntent,
		});
		await t.run((ctx) => ctx.db.patch(created._id, {
			status: "fulfillment_error",
			fulfillmentError: "Fulfillment validation rejected",
			fulfillmentRecoveryStatus: "refunded",
			stripeRefundId: "re_oldreleasednotice1234",
			automatedRefundId: "re_oldreleasednotice1234",
			automatedRefundStatus: "succeeded",
			fulfillmentFailureNotificationProtocol: "leased_v1",
			fulfillmentFailureNotificationRetryProtocol: undefined,
			fulfillmentFailureAdminNotificationClaimedAt: undefined,
			fulfillmentFailureAdminNotificationClaimToken: undefined,
			fulfillmentFailureAdminNotificationLeaseExpiresAt: undefined,
		}));

		await expect(t.mutation(api.orders.claimFulfillmentFailureNotificationV2, {
			orderId: created._id,
			audience: "admin",
			claimToken: CLAIM_TOKEN_B,
			webhookSecret: WEBHOOK_SECRET,
		})).resolves.toEqual({ kind: "unavailable" });
		await expect(t.mutation(api.orders.isFulfillmentFailureNotificationDeliveryUncertain, {
			orderId: created._id,
			audience: "admin",
			webhookSecret: WEBHOOK_SECRET,
		})).resolves.toBe(true);
	});

	test("establishes the order-scoped attention key only on a new-host first send", async () => {
		vi.useFakeTimers();
		const now = Date.parse("2026-08-06T12:00:00Z");
		vi.setSystemTime(now);
		try {
			const t = convexTest(schema, modules);
			const created = await t.mutation(api.orders.create, {
				...orderArgs("cs_test_attentionkeyprotocol123"),
				stripePaymentIntentId: MANUAL_REFUND.paymentIntent,
			});
			await t.run((ctx) => ctx.db.patch(created._id, {
				status: "fulfillment_error",
				fulfillmentError: "Fulfillment validation rejected",
				fulfillmentRecoveryStatus: "refund_attention",
				automatedRefundId: "re_attentionkeyprotocol123",
				automatedRefundStatus: "pending",
				automatedRefundAttentionReason: "attempts_exhausted",
				fulfillmentFailureNotificationProtocol: "leased_v1",
				fulfillmentFailureNotificationRetryProtocol: "bounded_23h_v1",
			}));
			const args = (claimToken: string) => ({
				orderId: created._id,
				audience: "refund_attention" as const,
				claimToken,
				webhookSecret: WEBHOOK_SECRET,
			});

			await expect(t.mutation(api.orders.claimFulfillmentFailureNotificationV2, args(CLAIM_TOKEN_A)))
				.resolves.toEqual({ kind: "claimed" });
			await expect(t.mutation(
				api.orders.authorizeFulfillmentFailureNotificationSendV2,
				args(CLAIM_TOKEN_A),
			)).resolves.toBe(true);
			expect(await t.run((ctx) => ctx.db.get(created._id))).toMatchObject({
				automatedRefundAttentionNotificationKeyProtocol: "order_identity_v1",
			});
			vi.setSystemTime(now + 16 * 60 * 1000);
			await expect(t.mutation(
				api.orders.claimFulfillmentFailureNotificationV2,
				args(CLAIM_TOKEN_B),
			)).resolves.toEqual({ kind: "unavailable" });
			await expect(t.mutation(
				api.orders.claimFulfillmentFailureNotificationV3,
				args(CLAIM_TOKEN_B),
			)).resolves.toEqual({ kind: "claimed" });

			vi.setSystemTime(now);
			const legacy = await t.mutation(api.orders.create, {
				...orderArgs("cs_test_attentionoldhostkey123"),
				stripePaymentIntentId: MANUAL_REFUND.paymentIntent,
			});
			await t.run((ctx) => ctx.db.patch(legacy._id, {
				status: "fulfillment_error",
				fulfillmentError: "Fulfillment validation rejected",
				fulfillmentRecoveryStatus: "refund_attention",
				automatedRefundId: "re_attentionoldhostkey123",
				automatedRefundStatus: "pending",
				automatedRefundAttentionReason: "attempts_exhausted",
				fulfillmentFailureNotificationProtocol: "leased_v1",
				fulfillmentFailureNotificationRetryProtocol: "bounded_23h_v1",
			}));
			const legacyArgs = (claimToken: string) => ({
				orderId: legacy._id,
				audience: "refund_attention" as const,
				claimToken,
				webhookSecret: WEBHOOK_SECRET,
			});
			await expect(t.mutation(
				api.orders.claimFulfillmentFailureNotificationV2,
				legacyArgs(CLAIM_TOKEN_A),
			)).resolves.toEqual({ kind: "claimed" });
			vi.setSystemTime(now + 16 * 60 * 1000);
			await expect(t.mutation(
				api.orders.claimFulfillmentFailureNotificationV2,
				legacyArgs(CLAIM_TOKEN_B),
			)).resolves.toEqual({ kind: "claimed" });
			await expect(t.mutation(
				api.orders.authorizeFulfillmentFailureNotificationSendV2,
				legacyArgs(CLAIM_TOKEN_B),
			)).resolves.toBe(false);
			const stored = await t.run((ctx) => ctx.db.get(legacy._id));
			expect(stored?.automatedRefundAttentionNotificationKeyProtocol).toBeUndefined();
			expect(stored).toMatchObject({
				automatedRefundAttentionNotificationDeliveryUncertainAt: expect.any(Number),
			});
			expect(stored?.automatedRefundAttentionNotificationClaimToken).toBeUndefined();
		} finally {
			vi.useRealTimers();
		}
	});

	test("keeps an active notification lease busy across the retry deadline", async () => {
		vi.useFakeTimers();
		const now = Date.parse("2026-08-06T12:00:00Z");
		vi.setSystemTime(now);
		try {
			const t = convexTest(schema, modules);
			const created = await t.mutation(api.orders.create, {
				...orderArgs(MANUAL_REFUND.session),
				stripePaymentIntentId: MANUAL_REFUND.paymentIntent,
			});
			const firstAttemptAt = now - 23 * 60 * 60 * 1000 + 1;
			await t.run((ctx) => ctx.db.patch(created._id, {
				status: "fulfillment_error",
				fulfillmentError: "Fulfillment validation rejected",
				fulfillmentRecoveryStatus: "refunded",
				stripeRefundId: "re_notificationboundary123456",
				automatedRefundId: "re_notificationboundary123456",
				automatedRefundStatus: "succeeded",
				fulfillmentFailureNotificationProtocol: "leased_v1",
				fulfillmentFailureNotificationRetryProtocol: "bounded_23h_v1",
				fulfillmentFailureAdminNotificationClaimedAt: firstAttemptAt,
				fulfillmentFailureAdminNotificationClaimToken: CLAIM_TOKEN_A,
				fulfillmentFailureAdminNotificationLeaseExpiresAt: now + 60_000,
			}));
			vi.setSystemTime(now + 2);
			await expect(t.mutation(api.orders.claimFulfillmentFailureNotificationV2, {
				orderId: created._id,
				audience: "admin",
				claimToken: CLAIM_TOKEN_B,
				webhookSecret: WEBHOOK_SECRET,
			})).resolves.toMatchObject({ kind: "busy" });
			await expect(t.mutation(api.orders.authorizeFulfillmentFailureNotificationSendV2, {
				orderId: created._id,
				audience: "admin",
				claimToken: CLAIM_TOKEN_A,
				webhookSecret: WEBHOOK_SECRET,
			})).resolves.toBe(false);
			await expect(t.mutation(api.orders.isFulfillmentFailureNotificationDeliveryUncertain, {
				orderId: created._id,
				audience: "admin",
				webhookSecret: WEBHOOK_SECRET,
			})).resolves.toBe(true);
		} finally {
			vi.useRealTimers();
		}
	});

	test("marks an unknown refund request outcome immediately and rejects stale ownership", async () => {
		const t = convexTest(schema, modules);
		const created = await t.mutation(api.orders.create, {
			...orderArgs(MANUAL_REFUND.session),
			stripePaymentIntentId: MANUAL_REFUND.paymentIntent,
		});
		const fulfillmentError = "Fulfillment validation rejected";
		await t.mutation(api.orders.claimAutomatedFulfillmentRefundV2, {
			orderId: created._id,
			claimToken: CLAIM_TOKEN_A,
			fulfillmentError,
			webhookSecret: WEBHOOK_SECRET,
		});
		await expect(t.mutation(api.orders.markAutomatedFulfillmentRefundRequestUncertain, {
			orderId: created._id,
			claimToken: CLAIM_TOKEN_B,
			webhookSecret: WEBHOOK_SECRET,
		})).resolves.toBe(false);
		await expect(t.mutation(api.orders.markAutomatedFulfillmentRefundRequestUncertain, {
			orderId: created._id,
			claimToken: CLAIM_TOKEN_A,
			webhookSecret: WEBHOOK_SECRET,
		})).resolves.toBe(true);
		await expect(t.mutation(api.orders.releaseAutomatedFulfillmentRefund, {
			orderId: created._id,
			claimToken: CLAIM_TOKEN_A,
			webhookSecret: WEBHOOK_SECRET,
		})).resolves.toBe(false);
		await expect(t.mutation(api.orders.recordAutomatedFulfillmentRefund, {
			orderId: created._id,
			claimToken: CLAIM_TOKEN_A,
			stripeRefundId: "re_stalecompletion123456",
			stripeRefundStatus: "succeeded",
			webhookSecret: WEBHOOK_SECRET,
		})).rejects.toThrow("Automated refund claim is unavailable");
		await expect(t.mutation(api.orders.claimAutomatedFulfillmentRefundV2, {
			orderId: created._id,
			claimToken: CLAIM_TOKEN_B,
			fulfillmentError,
			webhookSecret: WEBHOOK_SECRET,
		})).resolves.toEqual({ kind: "unavailable" });
		await expect(t.mutation(api.orders.isAutomatedFulfillmentRefundRequestUncertain, {
			orderId: created._id,
			webhookSecret: WEBHOOK_SECRET,
		})).resolves.toBe(true);
		expect(await t.run((ctx) => ctx.db.get(created._id))).toMatchObject({
			fulfillmentRecoveryStatus: "refund_attention",
			automatedRefundAttentionReason: "request_outcome_unknown",
			automatedRefundAttentionAt: expect.any(Number),
		});
		await expect(t.mutation(
			api.orders.reconcileAutomatedFulfillmentRefund,
			automatedRefundReconciliationArgs(created.orderNumber, "pending"),
		)).resolves.toEqual({ kind: "pending", refundStatus: "pending" });
		const reconciled = await t.run((ctx) => ctx.db.get(created._id));
		expect(reconciled).toMatchObject({
			fulfillmentRecoveryStatus: "refund_pending",
			automatedRefundId: "re_automated1234567890",
			automatedRefundStatus: "pending",
		});
		expect(reconciled?.automatedRefundAttentionReason).toBeUndefined();
		expect(reconciled?.automatedRefundAttentionAt).toBeUndefined();
	});

	test.each(["succeeded", "failed", "canceled"] as const)(
		"lets a signed %s refund resolve request uncertainty",
		async (status) => {
			const t = convexTest(schema, modules);
			const sessionId = `cs_test_unknownrefund${status}123`;
			const created = await t.mutation(api.orders.create, {
				...orderArgs(sessionId),
				stripePaymentIntentId: MANUAL_REFUND.paymentIntent,
			});
			await t.run((ctx) => ctx.db.patch(created._id, {
				status: "fulfillment_error",
				fulfillmentError: "Fulfillment validation rejected",
				fulfillmentRecoveryStatus: "refund_attention",
				automatedRefundAttempts: 1,
				automatedRefundFirstAttemptAt: Date.now(),
				automatedRefundAttentionAt: Date.now(),
				automatedRefundAttentionReason: "request_outcome_unknown",
				fulfillmentFailureNotificationProtocol: "leased_v1",
			}));

			await expect(t.mutation(
				api.orders.reconcileAutomatedFulfillmentRefund,
				automatedRefundReconciliationArgs(created.orderNumber, status, {
					stripeSessionId: sessionId,
				}),
			)).resolves.toMatchObject({
				kind: status === "succeeded" ? "succeeded" : "refund_failed",
			});
			const stored = await t.run((ctx) => ctx.db.get(created._id));
			expect(stored).toMatchObject({
				fulfillmentRecoveryStatus: status === "succeeded" ? "refunded" : "refund_failed",
				automatedRefundId: "re_automated1234567890",
				automatedRefundStatus: status,
			});
			expect(stored?.automatedRefundAttentionReason).toBeUndefined();
			expect(stored?.automatedRefundAttentionAt).toBeUndefined();
		},
	);

	test.each([
		["succeeded", "submission_uncertain"],
		["failed", "submission_uncertain"],
		["canceled", "submission_uncertain"],
		["succeeded", "reconciliation_blocked"],
		["failed", "reconciliation_blocked"],
		["canceled", "reconciliation_blocked"],
	] as const)(
		"lets signed %s refund evidence preserve a %s print fence",
		async (status, printResolution) => {
			const t = convexTest(schema, modules);
			const sessionId = `cs_test_unknownprint${status}${printResolution === "submission_uncertain" ? "u" : "b"}`;
			const created = await t.mutation(api.orders.create, {
				...orderArgs(sessionId),
				stripePaymentIntentId: MANUAL_REFUND.paymentIntent,
			});
			await t.run((ctx) => ctx.db.patch(created._id, {
				status: "fulfillment_error",
				fulfillmentError: "Fulfillment validation rejected",
				fulfillmentRecoveryStatus: "refund_attention",
				automatedRefundAttentionAt: Date.now(),
				automatedRefundAttentionReason: "request_outcome_unknown",
				printFulfillmentClaim: true,
				printFulfillmentClaimToken: CLAIM_TOKEN_A,
				printFulfillmentPhase: "submitting",
				printFulfillmentResolution: printResolution,
				...(printResolution === "reconciliation_blocked"
					? { printFulfillmentReconciliationClass: "response_contract" as const }
					: {}),
			}));

			const reconcileArgs = automatedRefundReconciliationArgs(created.orderNumber, status, {
				stripeSessionId: sessionId,
			});
			for (let delivery = 0; delivery < 2; delivery += 1) {
				await expect(t.mutation(
					api.orders.reconcileAutomatedFulfillmentRefund,
					reconcileArgs,
				)).resolves.toMatchObject({
					kind: status === "succeeded" ? "succeeded" : "refund_failed",
				});
			}
			const stored = await t.run((ctx) => ctx.db.get(created._id));
			expect(stored).toMatchObject({
				fulfillmentRecoveryStatus: status === "succeeded" ? "refunded" : "refund_failed",
				printFulfillmentClaim: true,
				printFulfillmentClaimToken: CLAIM_TOKEN_A,
				printFulfillmentPhase: "submitting",
				printFulfillmentResolution: printResolution,
			});
			expect(stored?.lumaprintsOrderNumber).toBeUndefined();
			expect(stored?.orderConfirmationClaimedAt).toBeUndefined();
		},
	);

	test("keeps terminal signed convergence available after pending evidence finds the refund ID", async () => {
		const t = convexTest(schema, modules);
		const sessionId = "cs_test_unknownprintpending123";
		const created = await t.mutation(api.orders.create, {
			...orderArgs(sessionId),
			stripePaymentIntentId: MANUAL_REFUND.paymentIntent,
		});
		await t.run((ctx) => ctx.db.patch(created._id, {
			status: "fulfillment_error",
			fulfillmentError: "Fulfillment validation rejected",
			fulfillmentRecoveryStatus: "refund_attention",
			automatedRefundAttentionReason: "request_outcome_unknown",
			printFulfillmentClaim: true,
			printFulfillmentClaimToken: CLAIM_TOKEN_A,
			printFulfillmentPhase: "submitting",
			printFulfillmentResolution: "submission_uncertain",
		}));
		const args = (status: "pending" | "succeeded") =>
			automatedRefundReconciliationArgs(created.orderNumber, status, {
				stripeSessionId: sessionId,
			});

		await expect(t.mutation(api.orders.reconcileAutomatedFulfillmentRefund, args("pending")))
			.resolves.toEqual({ kind: "pending", refundStatus: "pending" });
		await expect(t.mutation(api.orders.reconcileAutomatedFulfillmentRefund, args("succeeded")))
			.resolves.toMatchObject({ kind: "succeeded" });
		expect(await t.run((ctx) => ctx.db.get(created._id))).toMatchObject({
			fulfillmentRecoveryStatus: "refunded",
			printFulfillmentClaim: true,
			printFulfillmentPhase: "submitting",
			printFulfillmentResolution: "submission_uncertain",
		});
	});

	test.each([
		["succeeded", "print_first", "1701"],
		["failed", "print_first", "1702"],
		["canceled", "print_first", "1703"],
		["succeeded", "refund_first", "1704"],
		["failed", "refund_first", "1705"],
		["canceled", "refund_first", "1706"],
	] as const)(
		"converges signed %s refund evidence after %s print resolution",
		async (status, sequence, lumaprintsOrderNumber) => {
			const t = convexTest(schema, modules);
			const sessionId = `cs_test_refundprintorder${lumaprintsOrderNumber}123`;
			const created = await t.mutation(api.orders.create, {
				...orderArgs(sessionId),
				stripePaymentIntentId: MANUAL_REFUND.paymentIntent,
			});
			await t.run((ctx) => ctx.db.patch(created._id, {
				status: "fulfillment_error",
				fulfillmentError: "Fulfillment validation rejected",
				fulfillmentRecoveryStatus: "refund_attention",
				automatedRefundAttentionReason: "request_outcome_unknown",
				printFulfillmentClaim: true,
				printFulfillmentClaimToken: CLAIM_TOKEN_A,
				printFulfillmentPhase: "submitting",
				printFulfillmentResolution: "submission_uncertain",
			}));
			const args = (refundStatus: "pending" | typeof status) =>
				automatedRefundReconciliationArgs(created.orderNumber, refundStatus, {
					stripeSessionId: sessionId,
				});

			if (sequence === "refund_first") {
				await expect(t.mutation(api.orders.reconcileAutomatedFulfillmentRefund, args("pending")))
					.resolves.toEqual({ kind: "pending", refundStatus: "pending" });
			}
			await expect(t.mutation(api.orders.reconcilePrintFulfillmentSubmission, {
				orderId: created._id,
				externalId: sessionId,
				lumaprintsOrderNumber,
				webhookSecret: WEBHOOK_SECRET,
			})).resolves.toEqual({ kind: "fulfilled" });
			await expect(t.mutation(api.orders.reconcileAutomatedFulfillmentRefund, args(status)))
				.resolves.toMatchObject({
					kind: status === "succeeded" ? "succeeded" : "refund_failed",
				});
			expect(await t.run((ctx) => ctx.db.get(created._id))).toMatchObject({
				fulfillmentRecoveryStatus: status === "succeeded" ? "refunded" : "refund_failed",
				lumaprintsOrderNumber,
				printFulfillmentResolution: "resolved",
			});
		},
	);

	test.each(["succeeded", "failed", "canceled"] as const)(
		"resolves aged refund attention to signed %s while preserving print uncertainty",
		async (status) => {
			const t = convexTest(schema, modules);
			const sessionId = `cs_test_agedunknownprint${status}123`;
			const created = await t.mutation(api.orders.create, {
				...orderArgs(sessionId),
				stripePaymentIntentId: MANUAL_REFUND.paymentIntent,
			});
			await t.run((ctx) => ctx.db.patch(created._id, {
				status: "fulfillment_error",
				fulfillmentError: "Fulfillment validation rejected",
				fulfillmentRecoveryStatus: "refund_attention",
				automatedRefundFirstAttemptAt: Date.now() - 25 * 60 * 60 * 1000,
				automatedRefundAttentionReason: "request_outcome_unknown",
				printFulfillmentClaim: true,
				printFulfillmentClaimToken: CLAIM_TOKEN_A,
				printFulfillmentPhase: "submitting",
				printFulfillmentResolution: "submission_uncertain",
			}));
			const args = (refundStatus: "pending" | typeof status) =>
				automatedRefundReconciliationArgs(created.orderNumber, refundStatus, {
					stripeSessionId: sessionId,
				});

			await expect(t.mutation(api.orders.reconcileAutomatedFulfillmentRefund, args("pending")))
				.resolves.toMatchObject({ kind: "refund_attention", attentionReason: "age_exceeded" });
			await expect(t.mutation(api.orders.reconcileAutomatedFulfillmentRefund, args(status)))
				.resolves.toMatchObject({
					kind: status === "succeeded" ? "succeeded" : "refund_failed",
				});
			expect(await t.run((ctx) => ctx.db.get(created._id))).toMatchObject({
				fulfillmentRecoveryStatus: status === "succeeded" ? "refunded" : "refund_failed",
				printFulfillmentClaim: true,
				printFulfillmentPhase: "submitting",
				printFulfillmentResolution: "submission_uncertain",
			});
		},
	);

	test.each([
		["refund_failure", "failed", "refund_failed", "attempts_exhausted"],
		["refund_attention", "pending", "refund_attention", "age_exceeded"],
	] as const)(
		"does not opt a released pre-rollout %s notification into bounded retries",
		async (audience, refundStatus, recoveryStatus, attentionReason) => {
			const t = convexTest(schema, modules);
			const sessionId = `cs_test_oldreleased${audience}123`;
			const created = await t.mutation(api.orders.create, {
				...orderArgs(sessionId),
				stripePaymentIntentId: MANUAL_REFUND.paymentIntent,
			});
			await t.run((ctx) => ctx.db.patch(created._id, {
				status: "fulfillment_error",
				fulfillmentError: "Fulfillment validation rejected",
				fulfillmentRecoveryStatus: recoveryStatus,
				automatedRefundId: "re_oldreleasednotice123",
				automatedRefundStatus: refundStatus,
				automatedRefundAttentionReason:
					recoveryStatus === "refund_attention" ? attentionReason : undefined,
				fulfillmentFailureNotificationProtocol: "leased_v1",
				fulfillmentFailureNotificationRetryProtocol: undefined,
			}));

			await t.mutation(
				api.orders.reconcileAutomatedFulfillmentRefund,
				automatedRefundReconciliationArgs(created.orderNumber, refundStatus, {
					stripeSessionId: sessionId,
					stripeRefundId: "re_oldreleasednotice123",
				}),
			);
			await expect(t.mutation(api.orders.claimFulfillmentFailureNotificationV2, {
				orderId: created._id,
				audience,
				claimToken: CLAIM_TOKEN_A,
				webhookSecret: WEBHOOK_SECRET,
			})).resolves.toEqual({ kind: "unavailable" });
			const stored = await t.run((ctx) => ctx.db.get(created._id));
			expect(stored?.fulfillmentFailureNotificationRetryProtocol).toBeUndefined();
		},
	);

	test("fences an expired no-ID refund lease instead of submitting again", async () => {
		const t = convexTest(schema, modules);
		const created = await t.mutation(api.orders.create, {
			...orderArgs(MANUAL_REFUND.session),
			stripePaymentIntentId: MANUAL_REFUND.paymentIntent,
		});
		const fulfillmentError = "Fulfillment validation rejected";
		await expect(t.mutation(api.orders.claimAutomatedFulfillmentRefundV2, {
			orderId: created._id,
			claimToken: CLAIM_TOKEN_A,
			fulfillmentError,
			webhookSecret: WEBHOOK_SECRET,
		})).resolves.toMatchObject({ kind: "claimed" });
		await t.run((ctx) => ctx.db.patch(created._id, {
			automatedRefundLeaseExpiresAt: 0,
		}));
		await expect(t.mutation(api.orders.claimAutomatedFulfillmentRefundV2, {
			orderId: created._id,
			claimToken: CLAIM_TOKEN_B,
			fulfillmentError,
			webhookSecret: WEBHOOK_SECRET,
		})).resolves.toEqual({ kind: "unavailable" });
		await expect(t.mutation(api.orders.isAutomatedFulfillmentRefundRequestUncertain, {
			orderId: created._id,
			webhookSecret: WEBHOOK_SECRET,
		})).resolves.toBe(true);
		expect(await t.run((ctx) => ctx.db.get(created._id))).toMatchObject({
			status: "fulfillment_error",
			fulfillmentError,
			fulfillmentRecoveryStatus: "refund_attention",
			automatedRefundAttentionReason: "request_outcome_unknown",
			automatedRefundAttempts: 1,
			automatedRefundFirstAttemptAt: expect.any(Number),
		});
		expect((await t.run((ctx) => ctx.db.get(created._id)))?.automatedRefundId)
			.toBeUndefined();
	});

	test("fences no-ID refund leases and retrieves known refunds despite print uncertainty", async () => {
		const t = convexTest(schema, modules);
		const fulfillmentError = "Fulfillment validation rejected";
		const noId = await t.mutation(api.orders.create, {
			...orderArgs("cs_test_printrefundlease123"),
			stripePaymentIntentId: MANUAL_REFUND.paymentIntent,
		});
		const claim = (orderId: typeof noId._id, claimToken: string) =>
			t.mutation(api.orders.claimAutomatedFulfillmentRefundV2, {
				orderId,
				claimToken,
				fulfillmentError,
				webhookSecret: WEBHOOK_SECRET,
			});
		await expect(claim(noId._id, CLAIM_TOKEN_A)).resolves.toMatchObject({ kind: "claimed" });
		await t.run((ctx) => ctx.db.patch(noId._id, {
			printFulfillmentClaim: true,
			printFulfillmentClaimToken: CLAIM_TOKEN_A,
			printFulfillmentPhase: "submitting",
			printFulfillmentResolution: "submission_uncertain",
		}));
		await expect(claim(noId._id, CLAIM_TOKEN_B)).resolves.toMatchObject({ kind: "busy" });
		await t.run((ctx) => ctx.db.patch(noId._id, { automatedRefundLeaseExpiresAt: 0 }));
		await expect(claim(noId._id, CLAIM_TOKEN_B)).resolves.toEqual({ kind: "unavailable" });
		expect(await t.run((ctx) => ctx.db.get(noId._id))).toMatchObject({
			fulfillmentRecoveryStatus: "refund_attention",
			automatedRefundAttentionReason: "request_outcome_unknown",
			printFulfillmentClaim: true,
			printFulfillmentPhase: "submitting",
			printFulfillmentResolution: "submission_uncertain",
		});

		const known = await t.mutation(api.orders.create, {
			...orderArgs("cs_test_printrefundretrieve123"),
			stripePaymentIntentId: MANUAL_REFUND.paymentIntent,
		});
		await t.run((ctx) => ctx.db.patch(known._id, {
			status: "fulfillment_error",
			fulfillmentError,
			fulfillmentRecoveryStatus: "refund_pending",
			automatedRefundId: "re_printrefundretrieve123",
			automatedRefundStatus: "pending",
			printFulfillmentClaim: true,
			printFulfillmentClaimToken: CLAIM_TOKEN_A,
			printFulfillmentPhase: "submitting",
			printFulfillmentResolution: "submission_uncertain",
		}));
		await expect(claim(known._id, CLAIM_TOKEN_B)).resolves.toMatchObject({
			kind: "claimed",
			stripeRefundId: "re_printrefundretrieve123",
			refundStatus: "pending",
		});
	});

	test("turns an old-host no-ID release into durable request uncertainty", async () => {
		const t = convexTest(schema, modules);
		const created = await t.mutation(api.orders.create, {
			...orderArgs("cs_test_oldhostrefundrelease123"),
			stripePaymentIntentId: MANUAL_REFUND.paymentIntent,
		});
		const fulfillmentError = "Fulfillment validation rejected";
		await t.mutation(api.orders.claimAutomatedFulfillmentRefundV2, {
			orderId: created._id,
			claimToken: CLAIM_TOKEN_A,
			fulfillmentError,
			webhookSecret: WEBHOOK_SECRET,
		});
		await expect(t.mutation(api.orders.releaseAutomatedFulfillmentRefund, {
			orderId: created._id,
			claimToken: CLAIM_TOKEN_A,
			webhookSecret: WEBHOOK_SECRET,
		})).resolves.toBe(true);
		await expect(t.mutation(api.orders.claimAutomatedFulfillmentRefundV2, {
			orderId: created._id,
			claimToken: CLAIM_TOKEN_B,
			fulfillmentError,
			webhookSecret: WEBHOOK_SECRET,
		})).resolves.toEqual({ kind: "unavailable" });
		expect(await t.run((ctx) => ctx.db.get(created._id))).toMatchObject({
			fulfillmentRecoveryStatus: "refund_attention",
			automatedRefundAttentionReason: "request_outcome_unknown",
			automatedRefundFirstAttemptAt: expect.any(Number),
		});
	});

	test("keeps legacy claims inert for a known pending refund", async () => {
		const t = convexTest(schema, modules);
		const created = await t.mutation(api.orders.create, {
			...orderArgs("cs_test_legacyknownrefund123"),
			stripePaymentIntentId: MANUAL_REFUND.paymentIntent,
		});
		const fulfillmentError = "Fulfillment validation rejected";
		await t.run((ctx) => ctx.db.patch(created._id, {
			status: "fulfillment_error",
			fulfillmentError,
			fulfillmentRecoveryStatus: "refund_pending",
			automatedRefundId: "re_legacyknownrefund123",
			automatedRefundStatus: "pending",
			automatedRefundClaimToken: CLAIM_TOKEN_A,
			automatedRefundLeaseExpiresAt: 0,
		}));

		await expect(t.mutation(api.orders.claimAutomatedFulfillmentRefund, {
			orderId: created._id,
			claimToken: CLAIM_TOKEN_B,
			fulfillmentError,
			webhookSecret: WEBHOOK_SECRET,
		})).resolves.toEqual({ kind: "unavailable" });
		expect(await t.run((ctx) => ctx.db.get(created._id))).toMatchObject({
			fulfillmentRecoveryStatus: "refund_pending",
			automatedRefundId: "re_legacyknownrefund123",
			automatedRefundStatus: "pending",
		});
		expect((await t.run((ctx) => ctx.db.get(created._id)))?.automatedRefundAttentionReason)
			.toBeUndefined();
	});

	test("fences a raw baseline no-ID refund checkpoint without new attempt counters", async () => {
		const t = convexTest(schema, modules);
		const created = await t.mutation(api.orders.create, {
			...orderArgs("cs_test_legacyrefundpending123"),
			stripePaymentIntentId: MANUAL_REFUND.paymentIntent,
		});
		const fulfillmentError = "Fulfillment validation rejected";
		await t.run((ctx) => ctx.db.patch(created._id, {
			status: "fulfillment_error",
			fulfillmentError,
			fulfillmentRecoveryStatus: "refund_pending",
			automatedRefundClaimedAt: undefined,
			automatedRefundClaimToken: undefined,
			automatedRefundLeaseExpiresAt: undefined,
			automatedRefundAttempts: undefined,
			automatedRefundFirstAttemptAt: undefined,
			automatedRefundLastAttemptAt: undefined,
		}));

		await expect(t.mutation(api.orders.claimAutomatedFulfillmentRefund, {
			orderId: created._id,
			claimToken: CLAIM_TOKEN_A,
			fulfillmentError,
			webhookSecret: WEBHOOK_SECRET,
		})).resolves.toEqual({ kind: "unavailable" });
		await expect(t.mutation(api.orders.isAutomatedFulfillmentRefundRequestUncertain, {
			orderId: created._id,
			webhookSecret: WEBHOOK_SECRET,
		})).resolves.toBe(true);
		expect(await t.run((ctx) => ctx.db.get(created._id))).toMatchObject({
			fulfillmentRecoveryStatus: "refund_attention",
			automatedRefundAttentionReason: "request_outcome_unknown",
		});
	});

	test("escalates a long-running pending refund once and accepts later signed resolution", async () => {
		const t = convexTest(schema, modules);
		const created = await t.mutation(api.orders.create, {
			...orderArgs(MANUAL_REFUND.session),
			stripePaymentIntentId: MANUAL_REFUND.paymentIntent,
		});
		const fulfillmentError = "Provider submission failed";
		for (let attempt = 0; attempt < 5; attempt += 1) {
			const claimToken = attempt % 2 === 0 ? CLAIM_TOKEN_A : CLAIM_TOKEN_B;
			await expect(t.mutation(api.orders.claimAutomatedFulfillmentRefundV2, {
				orderId: created._id,
				claimToken,
				fulfillmentError,
				webhookSecret: WEBHOOK_SECRET,
			})).resolves.toMatchObject({ kind: "claimed" });
			const recorded = await t.mutation(api.orders.recordAutomatedFulfillmentRefund, {
				orderId: created._id,
				claimToken,
				stripeRefundId: "re_attention1234567890",
				stripeRefundStatus: attempt % 2 === 0 ? "pending" : "requires_action",
				webhookSecret: WEBHOOK_SECRET,
			});
			if (attempt < 4) expect(recorded).toMatchObject({ kind: "pending" });
			else {
				expect(recorded).toEqual({
					kind: "refund_attention",
					orderId: created._id,
					orderNumber: created.orderNumber,
					customerEmail: "buyer@example.com",
					total: 8400,
					errorSummary: fulfillmentError,
					stripeRefundId: "re_attention1234567890",
					refundStatus: "pending",
					attentionReason: "attempts_exhausted",
				});
			}
		}
		for (const audience of ["admin", "customer", "refund_failure"] as const) {
			await expect(t.mutation(api.orders.claimFulfillmentFailureNotificationV2, {
				orderId: created._id,
				audience,
				claimToken: CLAIM_TOKEN_A,
				webhookSecret: WEBHOOK_SECRET,
			})).resolves.toEqual({ kind: "unavailable" });
		}
		await expect(t.mutation(api.orders.claimFulfillmentFailureNotificationV2, {
			orderId: created._id,
			audience: "refund_attention",
			claimToken: CLAIM_TOKEN_A,
			webhookSecret: WEBHOOK_SECRET,
		})).resolves.toEqual({ kind: "claimed" });
		await expect(t.mutation(api.orders.claimFulfillmentFailureNotificationV2, {
			orderId: created._id,
			audience: "refund_attention",
			claimToken: CLAIM_TOKEN_B,
			webhookSecret: WEBHOOK_SECRET,
		})).resolves.toMatchObject({ kind: "busy" });

		await expect(t.mutation(
			api.orders.reconcileAutomatedFulfillmentRefund,
			automatedRefundReconciliationArgs(created.orderNumber, "succeeded", {
				stripeRefundId: "re_attention1234567890",
			}),
		)).resolves.toMatchObject({ kind: "succeeded" });
		expect(await t.run((ctx) => ctx.db.get(created._id))).toMatchObject({
			fulfillmentRecoveryStatus: "refunded",
			automatedRefundStatus: "succeeded",
			stripeRefundId: "re_attention1234567890",
		});
	});

	test("escalates a pending refund by age before another provider request", async () => {
		const t = convexTest(schema, modules);
		const created = await t.mutation(api.orders.create, {
			...orderArgs(MANUAL_REFUND.session),
			stripePaymentIntentId: MANUAL_REFUND.paymentIntent,
		});
		await t.run((ctx) => ctx.db.patch(created._id, {
			status: "fulfillment_error",
			fulfillmentError: "Provider submission failed",
			fulfillmentRecoveryStatus: "refund_pending",
			automatedRefundId: "re_agedattention123456",
			automatedRefundStatus: "requires_action",
			automatedRefundAttempts: 1,
			automatedRefundFirstAttemptAt: Date.now() - 25 * 60 * 60 * 1000,
		}));
		await expect(t.mutation(api.orders.claimAutomatedFulfillmentRefundV2, {
			orderId: created._id,
			claimToken: CLAIM_TOKEN_A,
			fulfillmentError: "Provider submission failed",
			webhookSecret: WEBHOOK_SECRET,
		})).resolves.toEqual({
			kind: "refund_attention",
			stripeRefundId: "re_agedattention123456",
			refundStatus: "requires_action",
			attentionReason: "age_exceeded",
		});
		expect(await t.run((ctx) => ctx.db.get(created._id))).toMatchObject({
			fulfillmentRecoveryStatus: "refund_attention",
			automatedRefundAttentionReason: "age_exceeded",
			automatedRefundAttempts: 1,
		});
	});

	test("keeps a known pending refund busy while its owner lease is active", async () => {
		const t = convexTest(schema, modules);
		const created = await t.mutation(api.orders.create, {
			...orderArgs(MANUAL_REFUND.session),
			stripePaymentIntentId: MANUAL_REFUND.paymentIntent,
		});
		const fulfillmentError = "Provider submission failed";
		await t.mutation(api.orders.claimAutomatedFulfillmentRefundV2, {
			orderId: created._id,
			claimToken: CLAIM_TOKEN_A,
			fulfillmentError,
			webhookSecret: WEBHOOK_SECRET,
		});
		await t.mutation(api.orders.recordAutomatedFulfillmentRefund, {
			orderId: created._id,
			claimToken: CLAIM_TOKEN_A,
			stripeRefundId: "re_activepending123456",
			stripeRefundStatus: "pending",
			webhookSecret: WEBHOOK_SECRET,
		});
		await t.mutation(api.orders.claimAutomatedFulfillmentRefundV2, {
			orderId: created._id,
			claimToken: CLAIM_TOKEN_B,
			fulfillmentError,
			webhookSecret: WEBHOOK_SECRET,
		});
		await t.run((ctx) => ctx.db.patch(created._id, {
			automatedRefundFirstAttemptAt: Date.now() - 25 * 60 * 60 * 1000,
		}));

		await expect(t.mutation(api.orders.claimAutomatedFulfillmentRefundV2, {
			orderId: created._id,
			claimToken: CLAIM_TOKEN_A,
			fulfillmentError,
			webhookSecret: WEBHOOK_SECRET,
		})).resolves.toMatchObject({ kind: "busy" });
		expect(await t.run((ctx) => ctx.db.get(created._id))).toMatchObject({
			fulfillmentRecoveryStatus: "refund_pending",
			automatedRefundClaimToken: CLAIM_TOKEN_B,
		});
	});

	test("manual refund truth invalidates an active automated-refund lease", async () => {
		const t = convexTest(schema, modules);
		const created = await t.mutation(api.orders.create, {
			...orderArgs(MANUAL_REFUND.session),
			stripePaymentIntentId: MANUAL_REFUND.paymentIntent,
		});
		const fulfillmentError = "Fulfillment validation rejected";
		await expect(t.mutation(api.orders.claimAutomatedFulfillmentRefundV2, {
			orderId: created._id,
			claimToken: CLAIM_TOKEN_A,
			fulfillmentError,
			webhookSecret: WEBHOOK_SECRET,
		})).resolves.toMatchObject({ kind: "claimed" });

		await expect(t.mutation(
			api.orders.reconcileSucceededManualRefund,
			manualRefundArgs(),
		)).resolves.toEqual({ kind: "reconciled" });
		const afterManualRefund = await t.run((ctx) => ctx.db.get(created._id));
		expect(afterManualRefund).toMatchObject({
			status: "refunded",
			stripeRefundId: MANUAL_REFUND.refund,
		});
		expect(afterManualRefund).not.toHaveProperty("fulfillmentRecoveryStatus");
		expect(afterManualRefund).not.toHaveProperty("automatedRefundClaimToken");
		expect(afterManualRefund).not.toHaveProperty("automatedRefundLeaseExpiresAt");
		await expect(t.mutation(api.orders.releaseAutomatedFulfillmentRefund, {
			orderId: created._id,
			claimToken: CLAIM_TOKEN_A,
			webhookSecret: WEBHOOK_SECRET,
		})).resolves.toBe(false);
		await expect(t.mutation(api.orders.recordAutomatedFulfillmentRefund, {
			orderId: created._id,
			claimToken: CLAIM_TOKEN_A,
			stripeRefundId: "re_automatedrefund123456",
			stripeRefundStatus: "succeeded",
			webhookSecret: WEBHOOK_SECRET,
		})).rejects.toThrow("Automated refund claim is unavailable");
		await expect(t.mutation(api.orders.claimAutomatedFulfillmentRefundV2, {
			orderId: created._id,
			claimToken: CLAIM_TOKEN_B,
			fulfillmentError,
			webhookSecret: WEBHOOK_SECRET,
		})).resolves.toEqual({ kind: "unavailable" });
	});

	test("lets signed automation metadata reconcile pending to succeeded without a lease", async () => {
		const t = convexTest(schema, modules);
		const created = await t.mutation(api.orders.create, {
			...orderArgs(MANUAL_REFUND.session),
			stripePaymentIntentId: MANUAL_REFUND.paymentIntent,
		});
		await t.mutation(api.orders.claimAutomatedFulfillmentRefundV2, {
			orderId: created._id,
			claimToken: CLAIM_TOKEN_A,
			fulfillmentError: "Provider submission failed",
			webhookSecret: WEBHOOK_SECRET,
		});
		await expect(t.mutation(
			api.orders.reconcileAutomatedFulfillmentRefund,
			automatedRefundReconciliationArgs(created.orderNumber, "pending"),
		)).resolves.toEqual({ kind: "pending", refundStatus: "pending" });
		expect((await t.run((ctx) => ctx.db.get(created._id)))?.stripeRefundId).toBeUndefined();
		await expect(t.mutation(
			api.orders.reconcileAutomatedFulfillmentRefund,
			automatedRefundReconciliationArgs(created.orderNumber, "succeeded"),
		)).resolves.toMatchObject({
			kind: "succeeded",
			orderId: created._id,
			stripeRefundId: "re_automated1234567890",
		});
		expect(await t.run((ctx) => ctx.db.get(created._id))).toMatchObject({
			fulfillmentRecoveryStatus: "refunded",
			automatedRefundStatus: "succeeded",
			stripeRefundId: "re_automated1234567890",
			fulfillmentFailureNotificationProtocol: "leased_v1",
		});
	});

	test.each(["failed", "canceled"] as const)(
		"stores a %s provider refund as operator-blocked without customer success",
		async (stripeRefundStatus) => {
			const t = convexTest(schema, modules);
			const created = await t.mutation(api.orders.create, {
				...orderArgs(`cs_test_refund${stripeRefundStatus}123456`),
				stripePaymentIntentId: MANUAL_REFUND.paymentIntent,
			});
			await t.mutation(api.orders.claimAutomatedFulfillmentRefundV2, {
				orderId: created._id,
				claimToken: CLAIM_TOKEN_A,
				fulfillmentError: "Provider submission failed",
				webhookSecret: WEBHOOK_SECRET,
			});
			await expect(t.mutation(api.orders.recordAutomatedFulfillmentRefund, {
				orderId: created._id,
				claimToken: CLAIM_TOKEN_A,
				stripeRefundId: `re_${stripeRefundStatus}refund123456`,
				stripeRefundStatus,
				webhookSecret: WEBHOOK_SECRET,
			})).resolves.toMatchObject({
				kind: "refund_failed",
				refundStatus: stripeRefundStatus,
			});
			const stored = await t.run((ctx) => ctx.db.get(created._id));
			expect(stored).toMatchObject({
				status: "fulfillment_error",
				fulfillmentRecoveryStatus: "refund_failed",
				automatedRefundStatus: stripeRefundStatus,
				fulfillmentFailureNotificationProtocol: "leased_v1",
			});
			expect(stored?.stripeRefundId).toBeUndefined();
			for (const audience of ["admin", "customer"] as const) {
				await expect(t.mutation(api.orders.claimFulfillmentFailureNotificationV2, {
					orderId: created._id,
					audience,
					claimToken: CLAIM_TOKEN_A,
					webhookSecret: WEBHOOK_SECRET,
				})).resolves.toEqual({ kind: "unavailable" });
			}
			await expect(t.mutation(api.orders.claimFulfillmentFailureNotificationV2, {
				orderId: created._id,
				audience: "refund_failure",
				claimToken: CLAIM_TOKEN_A,
				webhookSecret: WEBHOOK_SECRET,
			})).resolves.toEqual({ kind: "claimed" });
		},
	);

	test("keeps legacy automated refund success and customer notices suppressed", async () => {
		const t = convexTest(schema, modules);
		const created = await t.mutation(api.orders.create, {
			...orderArgs(MANUAL_REFUND.session),
			stripePaymentIntentId: MANUAL_REFUND.paymentIntent,
		});
		await t.run((ctx) => ctx.db.patch(created._id, {
			status: "fulfillment_error",
			fulfillmentError: "Legacy terminal failure",
			fulfillmentRecoveryStatus: "refunded",
			stripeRefundId: "re_automated1234567890",
		}));
		await expect(t.mutation(
			api.orders.reconcileAutomatedFulfillmentRefund,
			automatedRefundReconciliationArgs(created.orderNumber, "pending"),
		)).resolves.toEqual({ kind: "pending", refundStatus: "pending" });
		expect(await t.run((ctx) => ctx.db.get(created._id))).toMatchObject({
			fulfillmentRecoveryStatus: "refund_pending",
			automatedRefundStatus: "pending",
			legacyAutomatedRefundNotificationsSuppressed: true,
		});
		expect((await t.run((ctx) => ctx.db.get(created._id)))?.stripeRefundId).toBeUndefined();
		await expect(t.mutation(
			api.orders.reconcileAutomatedFulfillmentRefund,
			automatedRefundReconciliationArgs(created.orderNumber, "succeeded"),
		)).resolves.toMatchObject({ kind: "succeeded" });
		expect((await t.run((ctx) => ctx.db.get(created._id)))
			?.fulfillmentFailureNotificationProtocol).toBeUndefined();
		for (const audience of ["admin", "customer"] as const) {
			await expect(t.mutation(api.orders.claimFulfillmentFailureNotification, {
				orderId: created._id,
				audience,
				webhookSecret: WEBHOOK_SECRET,
			})).resolves.toBe(false);
			await expect(t.mutation(api.orders.claimFulfillmentFailureNotificationV2, {
				orderId: created._id,
				audience,
				claimToken: CLAIM_TOKEN_A,
				webhookSecret: WEBHOOK_SECRET,
			})).resolves.toEqual({ kind: "unavailable" });
		}
	});

	test.each(["failed", "canceled"] as const)(
		"authorizes one operator-only %s alert after a legacy pending refund",
		async (status) => {
			const t = convexTest(schema, modules);
			const created = await t.mutation(api.orders.create, {
				...orderArgs(MANUAL_REFUND.session),
				stripePaymentIntentId: MANUAL_REFUND.paymentIntent,
			});
			await t.run((ctx) => ctx.db.patch(created._id, {
				status: "fulfillment_error",
				fulfillmentError: "Legacy terminal failure",
				fulfillmentRecoveryStatus: "refunded",
				stripeRefundId: "re_automated1234567890",
			}));
			await t.mutation(
				api.orders.reconcileAutomatedFulfillmentRefund,
				automatedRefundReconciliationArgs(created.orderNumber, "pending"),
			);
			await expect(t.mutation(
				api.orders.reconcileAutomatedFulfillmentRefund,
				automatedRefundReconciliationArgs(created.orderNumber, status),
			)).resolves.toMatchObject({ kind: "refund_failed", refundStatus: status });
			for (const audience of ["admin", "customer", "refund_attention"] as const) {
				await expect(t.mutation(api.orders.claimFulfillmentFailureNotificationV2, {
					orderId: created._id,
					audience,
					claimToken: CLAIM_TOKEN_A,
					webhookSecret: WEBHOOK_SECRET,
				})).resolves.toEqual({ kind: "unavailable" });
			}
			await expect(t.mutation(api.orders.claimFulfillmentFailureNotificationV2, {
				orderId: created._id,
				audience: "refund_failure",
				claimToken: CLAIM_TOKEN_A,
				webhookSecret: WEBHOOK_SECRET,
			})).resolves.toEqual({ kind: "claimed" });
			await expect(t.mutation(api.orders.claimFulfillmentFailureNotificationV2, {
				orderId: created._id,
				audience: "refund_failure",
				claimToken: CLAIM_TOKEN_B,
				webhookSecret: WEBHOOK_SECRET,
			})).resolves.toMatchObject({ kind: "busy" });
		},
	);
});

describe("order confirmation claim", () => {
	test("authorizes durable resolved provider fields independent of fulfillmentType", async () => {
		const t = convexTest(schema, modules);
		const created = await t.mutation(api.orders.create, {
			...orderArgs("cs_test_confirmationdurable1234"),
			fulfillmentType: "self",
		});
		await t.run((ctx) => ctx.db.patch(created._id, {
			lumaprintsOrderNumber: "1600",
			printFulfillmentResolution: "resolved",
		}));
		await expect(t.mutation(api.orders.claimOrderConfirmation, {
			orderId: created._id,
			webhookSecret: WEBHOOK_SECRET,
		})).resolves.toBe(true);
	});

	test("claims once after GET reconciliation on an ordinary existing-order retry", async () => {
		const t = convexTest(schema, modules);
		const args = orderArgs("cs_test_confirmationreconcile1234");
		const created = await t.mutation(api.orders.create, args);
		await t.mutation(api.orders.claimPrintFulfillment, {
			orderId: created._id,
			webhookSecret: WEBHOOK_SECRET,
		});
		await expect(t.mutation(api.orders.reconcilePrintFulfillmentSubmission, {
			orderId: created._id,
			externalId: args.stripeSessionId,
			lumaprintsOrderNumber: "1601",
			webhookSecret: WEBHOOK_SECRET,
		})).resolves.toEqual({ kind: "fulfilled" });

		const retry = await t.mutation(api.orders.create, args);
		expect(retry).toMatchObject({ _id: created._id, alreadyExisted: true });
		const claims = await Promise.all([
			t.mutation(api.orders.claimOrderConfirmation, {
				orderId: retry._id,
				webhookSecret: WEBHOOK_SECRET,
			}),
			t.mutation(api.orders.claimOrderConfirmation, {
				orderId: retry._id,
				webhookSecret: WEBHOOK_SECRET,
			}),
		]);
		expect(claims.sort()).toEqual([false, true]);
		expect((await t.run((ctx) => ctx.db.get(created._id)))?.orderConfirmationClaimedAt)
			.toEqual(expect.any(Number));
	});

	test("does not authorize a normal confirmation for refunded or unresolved print orders", async () => {
		const t = convexTest(schema, modules);
		const unresolved = await t.mutation(
			api.orders.create,
			orderArgs("cs_test_confirmationunresolved1234"),
		);
		await t.mutation(api.orders.claimPrintFulfillment, {
			orderId: unresolved._id,
			webhookSecret: WEBHOOK_SECRET,
		});
		await expect(t.mutation(api.orders.claimOrderConfirmation, {
			orderId: unresolved._id,
			webhookSecret: WEBHOOK_SECRET,
		})).resolves.toBe(false);

		const refunded = await t.mutation(api.orders.create, {
			...orderArgs(MANUAL_REFUND.session),
			stripePaymentIntentId: MANUAL_REFUND.paymentIntent,
		});
		await t.mutation(api.orders.claimPrintFulfillment, {
			orderId: refunded._id,
			webhookSecret: WEBHOOK_SECRET,
		});
		await t.mutation(api.orders.reconcilePrintFulfillmentSubmission, {
			orderId: refunded._id,
			externalId: MANUAL_REFUND.session,
			lumaprintsOrderNumber: "1602",
			webhookSecret: WEBHOOK_SECRET,
		});
		await t.mutation(api.orders.reconcileSucceededManualRefund, manualRefundArgs());
		await expect(t.mutation(api.orders.claimOrderConfirmation, {
			orderId: refunded._id,
			webhookSecret: WEBHOOK_SECRET,
		})).resolves.toBe(false);
		await expect(t.mutation(api.orders.claimOrderConfirmation, {
			orderId: refunded._id,
			webhookSecret: "wrong-secret",
		})).rejects.toThrow("Not authorized");
	});
});

describe("print reconciliation operator alert claim", () => {
	test("escalates prolonged inconclusive GETs without refunding, reposting, or claiming absence", async () => {
		const t = convexTest(schema, modules);
		const externalId = "cs_test_prolongedget12345678";
		const created = await t.mutation(api.orders.create, orderArgs(externalId));
		await t.mutation(api.orders.claimPrintFulfillmentV3, {
			orderId: created._id,
			claimToken: CLAIM_TOKEN_A,
			webhookSecret: WEBHOOK_SECRET,
		});
		await t.mutation(api.orders.beginPrintFulfillmentSubmission, {
			orderId: created._id,
			claimToken: CLAIM_TOKEN_A,
			webhookSecret: WEBHOOK_SECRET,
		});
		const inconclusiveClasses = [
			"transport",
			"rate_or_server",
			"resource_bound",
			"client_exception",
			"result_not_observed",
		] as const;
		for (let attempt = 1; attempt < inconclusiveClasses.length; attempt += 1) {
			await expect(t.mutation(api.orders.recordPrintFulfillmentReconciliationPending, {
				orderId: created._id,
				externalId,
				reason: inconclusiveClasses[attempt - 1],
				webhookSecret: WEBHOOK_SECRET,
			})).resolves.toEqual({ kind: "pending", attempts: attempt });
			await t.run((ctx) => ctx.db.patch(created._id, {
				printFulfillmentReconciliationLastAttemptAt: 0,
			}));
		}
		await expect(t.mutation(api.orders.recordPrintFulfillmentReconciliationPending, {
			orderId: created._id,
			externalId,
			reason: inconclusiveClasses[4],
			webhookSecret: WEBHOOK_SECRET,
		})).resolves.toEqual({
			kind: "reconciliation_blocked",
			reconciliationClass: "client_error",
			escalationReason: "result_not_observed",
		});
		const stored = await t.run((ctx) => ctx.db.get(created._id));
		expect(stored).toMatchObject({
			status: "new",
			printFulfillmentClaim: true,
			printFulfillmentPhase: "submitting",
			printFulfillmentResolution: "reconciliation_blocked",
			printFulfillmentReconciliationEscalationReason: "result_not_observed",
			printFulfillmentReconciliationLastAttemptClass: "result_not_observed",
			printFulfillmentReconciliationPendingClassCounts: {
				transport: 1,
				rate_or_server: 1,
				resource_bound: 1,
				client_exception: 1,
				result_not_observed: 1,
			},
		});
		expect(stored?.lumaprintsOrderNumber).toBeUndefined();
		expect(stored?.stripeRefundId).toBeUndefined();
		expect(stored?.fulfillmentRecoveryStatus).toBeUndefined();
		await expect(t.mutation(api.orders.claimPrintFulfillmentV3, {
			orderId: created._id,
			claimToken: CLAIM_TOKEN_B,
			webhookSecret: WEBHOOK_SECRET,
		})).resolves.toEqual({
			kind: "reconciliation_blocked",
			reconciliationClass: "client_error",
			escalationReason: "result_not_observed",
		});
	});

	test("uses age to escalate a resource-bound GET while preserving the fence", async () => {
		const t = convexTest(schema, modules);
		const externalId = "cs_test_agedresourceget123456";
		const created = await t.mutation(api.orders.create, orderArgs(externalId));
		await t.mutation(api.orders.claimPrintFulfillmentV3, {
			orderId: created._id,
			claimToken: CLAIM_TOKEN_A,
			webhookSecret: WEBHOOK_SECRET,
		});
		await t.mutation(api.orders.beginPrintFulfillmentSubmission, {
			orderId: created._id,
			claimToken: CLAIM_TOKEN_A,
			webhookSecret: WEBHOOK_SECRET,
		});
		await t.run((ctx) => ctx.db.patch(created._id, {
			printFulfillmentReconciliationPendingFirstAt: Date.now() - 25 * 60 * 60 * 1000,
			printFulfillmentReconciliationPendingAttempts: 1,
		}));
		await expect(t.mutation(api.orders.recordPrintFulfillmentReconciliationPending, {
			orderId: created._id,
			externalId,
			reason: "resource_bound",
			webhookSecret: WEBHOOK_SECRET,
		})).resolves.toMatchObject({
			kind: "reconciliation_blocked",
			escalationReason: "resource_bound",
		});
		expect(await t.run((ctx) => ctx.db.get(created._id))).toMatchObject({
			printFulfillmentClaim: true,
			printFulfillmentPhase: "submitting",
			printFulfillmentReconciliationEscalationReason: "resource_bound",
		});
	});

	test("authorizes one alert while preserving the no-refund and no-new-POST fence", async () => {
		const t = convexTest(schema, modules);
		const externalId = "cs_test_alertclaim12345678";
		const created = await t.mutation(api.orders.create, orderArgs(externalId));
		await t.mutation(api.orders.claimPrintFulfillmentV2, {
			orderId: created._id,
			claimToken: CLAIM_TOKEN_A,
			webhookSecret: WEBHOOK_SECRET,
		});
		await t.mutation(api.orders.beginPrintFulfillmentSubmission, {
			orderId: created._id,
			claimToken: CLAIM_TOKEN_A,
			webhookSecret: WEBHOOK_SECRET,
		});
		await expect(t.mutation(api.orders.blockPrintFulfillmentReconciliation, {
			orderId: created._id,
			externalId,
			reconciliationClass: "response_contract",
			webhookSecret: WEBHOOK_SECRET,
		})).resolves.toBe(true);
		await expect(t.mutation(api.orders.blockPrintFulfillmentReconciliation, {
			orderId: created._id,
			externalId,
			reconciliationClass: "provider_rejected",
			webhookSecret: WEBHOOK_SECRET,
		})).resolves.toBe(false);

		const alertAttempts = await Promise.all([
			[CLAIM_TOKEN_A, t.mutation(api.orders.claimPrintFulfillmentReconciliationAlert, {
				orderId: created._id,
				externalId,
				claimToken: CLAIM_TOKEN_A,
				webhookSecret: WEBHOOK_SECRET,
			})] as const,
			[CLAIM_TOKEN_B, t.mutation(api.orders.claimPrintFulfillmentReconciliationAlert, {
				orderId: created._id,
				externalId,
				claimToken: CLAIM_TOKEN_B,
				webhookSecret: WEBHOOK_SECRET,
			})] as const,
		]);
		const alerts = await Promise.all(
			alertAttempts.map(async ([claimToken, outcome]) => [claimToken, await outcome] as const),
		);
		expect(alerts.map(([, outcome]) => outcome.kind).sort()).toEqual(["busy", "claimed"]);
		const busy = alerts.find(([, outcome]) => outcome.kind === "busy")?.[1];
		expect(busy).toMatchObject({ kind: "busy", leaseExpiresAt: expect.any(Number) });
		const winningToken = alerts.find(([, outcome]) => outcome.kind === "claimed")?.[0];
		if (!winningToken) throw new Error("Expected one alert lease owner");
		await expect(t.mutation(api.orders.authorizePrintFulfillmentReconciliationAlertSend, {
			orderId: created._id,
			externalId,
			claimToken: winningToken,
			webhookSecret: WEBHOOK_SECRET,
		})).resolves.toBe(true);

		const stored = await t.run((ctx) => ctx.db.get(created._id));
		expect(stored).toMatchObject({
			status: "new",
			printFulfillmentClaim: true,
			printFulfillmentClaimToken: CLAIM_TOKEN_A,
			printFulfillmentPhase: "submitting",
			printFulfillmentResolution: "reconciliation_blocked",
			printFulfillmentReconciliationClass: "response_contract",
			printFulfillmentReconciliationAlertClaimedAt: expect.any(Number),
			printFulfillmentReconciliationAlertClaimToken: winningToken,
			printFulfillmentReconciliationAlertLeaseExpiresAt: expect.any(Number),
		});
		expect(stored?.lumaprintsOrderNumber).toBeUndefined();
		expect(stored?.stripeRefundId).toBeUndefined();
		expect(stored?.fulfillmentRecoveryStatus).toBeUndefined();
		await expect(t.mutation(api.orders.claimPrintFulfillmentV2, {
			orderId: created._id,
			claimToken: CLAIM_TOKEN_B,
			webhookSecret: WEBHOOK_SECRET,
		})).resolves.toEqual({ kind: "busy" });
		await expect(t.mutation(api.orders.beginPrintFulfillmentSubmission, {
			orderId: created._id,
			claimToken: CLAIM_TOKEN_B,
			webhookSecret: WEBHOOK_SECRET,
		})).resolves.toEqual({ kind: "lost" });
		await expect(t.mutation(api.orders.updateStatus, {
			orderId: created._id,
			webhookSecret: WEBHOOK_SECRET,
			status: "fulfillment_error",
			fulfillmentRecoveryStatus: "refund_pending",
		})).rejects.toThrow("submission is in progress");

		await expect(t.mutation(api.orders.releasePrintFulfillmentReconciliationAlert, {
			orderId: created._id,
			externalId,
			claimToken: winningToken,
			webhookSecret: WEBHOOK_SECRET,
		})).resolves.toBe(true);
		await expect(t.mutation(api.orders.claimPrintFulfillmentReconciliationAlert, {
			orderId: created._id,
			externalId,
			claimToken: CLAIM_TOKEN_B,
			webhookSecret: WEBHOOK_SECRET,
		})).resolves.toEqual({ kind: "claimed" });
		await t.run((ctx) => ctx.db.patch(created._id, {
			printFulfillmentReconciliationAlertLeaseExpiresAt: 0,
		}));
		await expect(t.mutation(api.orders.claimPrintFulfillmentReconciliationAlert, {
			orderId: created._id,
			externalId,
			claimToken: CLAIM_TOKEN_A,
			webhookSecret: WEBHOOK_SECRET,
		})).resolves.toEqual({ kind: "claimed" });
		await expect(t.mutation(api.orders.completePrintFulfillmentReconciliationAlert, {
			orderId: created._id,
			externalId,
			claimToken: CLAIM_TOKEN_A,
			webhookSecret: WEBHOOK_SECRET,
		})).resolves.toBe(true);
		await expect(t.mutation(api.orders.claimPrintFulfillmentReconciliationAlert, {
			orderId: created._id,
			externalId,
			claimToken: CLAIM_TOKEN_B,
			webhookSecret: WEBHOOK_SECRET,
		})).resolves.toEqual({ kind: "unavailable" });
		expect(await t.run((ctx) => ctx.db.get(created._id))).toMatchObject({
			printFulfillmentReconciliationAlertSentAt: expect.any(Number),
		});
	});

	test("does not authorize an alert after provider reconciliation resolves", async () => {
		const t = convexTest(schema, modules);
		const externalId = "cs_test_alertresolved123456";
		const created = await t.mutation(api.orders.create, orderArgs(externalId));
		await t.mutation(api.orders.claimPrintFulfillmentV2, {
			orderId: created._id,
			claimToken: CLAIM_TOKEN_A,
			webhookSecret: WEBHOOK_SECRET,
		});
		await t.mutation(api.orders.beginPrintFulfillmentSubmission, {
			orderId: created._id,
			claimToken: CLAIM_TOKEN_A,
			webhookSecret: WEBHOOK_SECRET,
		});
		await t.mutation(api.orders.blockPrintFulfillmentReconciliation, {
			orderId: created._id,
			externalId,
			reconciliationClass: "response_contract",
			webhookSecret: WEBHOOK_SECRET,
		});
		await t.mutation(api.orders.claimPrintFulfillmentReconciliationAlert, {
			orderId: created._id,
			externalId,
			claimToken: CLAIM_TOKEN_B,
			webhookSecret: WEBHOOK_SECRET,
		});
		await t.mutation(api.orders.completePrintFulfillmentSubmission, {
			orderId: created._id,
			claimToken: CLAIM_TOKEN_A,
			externalId,
			lumaprintsOrderNumber: "99101",
			webhookSecret: WEBHOOK_SECRET,
		});

		await expect(t.mutation(api.orders.authorizePrintFulfillmentReconciliationAlertSend, {
			orderId: created._id,
			externalId,
			claimToken: CLAIM_TOKEN_B,
			webhookSecret: WEBHOOK_SECRET,
		})).resolves.toBe(false);
	});

	test("stops reconciliation alert sends at the bounded retry deadline", async () => {
		const t = convexTest(schema, modules);
		const externalId = "cs_test_alertdedupewindow123";
		const created = await t.mutation(api.orders.create, orderArgs(externalId));
		await t.mutation(api.orders.claimPrintFulfillmentV2, {
			orderId: created._id,
			claimToken: CLAIM_TOKEN_A,
			webhookSecret: WEBHOOK_SECRET,
		});
		await t.mutation(api.orders.beginPrintFulfillmentSubmission, {
			orderId: created._id,
			claimToken: CLAIM_TOKEN_A,
			webhookSecret: WEBHOOK_SECRET,
		});
		await t.mutation(api.orders.blockPrintFulfillmentReconciliation, {
			orderId: created._id,
			externalId,
			reconciliationClass: "response_contract",
			webhookSecret: WEBHOOK_SECRET,
		});
		await t.mutation(api.orders.claimPrintFulfillmentReconciliationAlert, {
			orderId: created._id,
			externalId,
			claimToken: CLAIM_TOKEN_A,
			webhookSecret: WEBHOOK_SECRET,
		});
		const firstAttemptAt = Date.now() - 23 * 60 * 60 * 1000;
		await t.run((ctx) => ctx.db.patch(created._id, {
			printFulfillmentReconciliationAlertClaimedAt: firstAttemptAt,
			printFulfillmentReconciliationAlertLeaseExpiresAt: 0,
		}));
		await expect(t.mutation(api.orders.claimPrintFulfillmentReconciliationAlert, {
			orderId: created._id,
			externalId,
			claimToken: CLAIM_TOKEN_B,
			webhookSecret: WEBHOOK_SECRET,
		})).resolves.toEqual({ kind: "unavailable" });
		await expect(t.mutation(
			api.orders.isPrintFulfillmentReconciliationAlertDeliveryUncertain,
			{ orderId: created._id, externalId, webhookSecret: WEBHOOK_SECRET },
		)).resolves.toBe(true);
		await expect(t.mutation(api.orders.releasePrintFulfillmentReconciliationAlert, {
			orderId: created._id,
			externalId,
			claimToken: CLAIM_TOKEN_A,
			webhookSecret: WEBHOOK_SECRET,
		})).resolves.toBe(false);
		await expect(t.mutation(api.orders.completePrintFulfillmentReconciliationAlert, {
			orderId: created._id,
			externalId,
			claimToken: CLAIM_TOKEN_A,
			webhookSecret: WEBHOOK_SECRET,
		})).resolves.toBe(false);
		expect(await t.run((ctx) => ctx.db.get(created._id))).toMatchObject({
			printFulfillmentReconciliationAlertDeliveryUncertainAt: expect.any(Number),
		});
	});

	test("fails closed for a reconciliation alert released before bounded retries", async () => {
		const t = convexTest(schema, modules);
		const externalId = "cs_test_oldreleasedalert12345";
		const created = await t.mutation(api.orders.create, orderArgs(externalId));
		await t.run((ctx) => ctx.db.patch(created._id, {
			printFulfillmentClaim: true,
			printFulfillmentClaimToken: CLAIM_TOKEN_A,
			printFulfillmentPhase: "submitting",
			printFulfillmentResolution: "reconciliation_blocked",
			printFulfillmentReconciliationClass: "response_contract",
			printFulfillmentReconciliationAlertRetryProtocol: undefined,
			printFulfillmentReconciliationAlertClaimedAt: undefined,
			printFulfillmentReconciliationAlertClaimToken: undefined,
			printFulfillmentReconciliationAlertLeaseExpiresAt: undefined,
		}));

		await expect(t.mutation(api.orders.claimPrintFulfillmentReconciliationAlert, {
			orderId: created._id,
			externalId,
			claimToken: CLAIM_TOKEN_B,
			webhookSecret: WEBHOOK_SECRET,
		})).resolves.toEqual({ kind: "unavailable" });
		await expect(t.mutation(
			api.orders.isPrintFulfillmentReconciliationAlertDeliveryUncertain,
			{ orderId: created._id, externalId, webhookSecret: WEBHOOK_SECRET },
		)).resolves.toBe(true);
	});

	test("rejects alert claims without a matching blocked webhook-owned fence", async () => {
		const t = convexTest(schema, modules);
		const externalId = "cs_test_alertunavailable1234";
		const created = await t.mutation(api.orders.create, orderArgs(externalId));
		await expect(t.mutation(api.orders.claimPrintFulfillmentReconciliationAlert, {
			orderId: created._id,
			externalId,
			claimToken: CLAIM_TOKEN_A,
			webhookSecret: WEBHOOK_SECRET,
		})).resolves.toEqual({ kind: "unavailable" });
		await expect(t.mutation(api.orders.claimPrintFulfillmentReconciliationAlert, {
			orderId: created._id,
			externalId: "cs_test_wrongidentity123456",
			claimToken: CLAIM_TOKEN_A,
			webhookSecret: WEBHOOK_SECRET,
		})).rejects.toThrow("identity does not match order");
		await expect(t.mutation(api.orders.claimPrintFulfillmentReconciliationAlert, {
			orderId: created._id,
			externalId,
			claimToken: CLAIM_TOKEN_A,
			webhookSecret: "wrong-secret",
		})).rejects.toThrow("Not authorized");
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
		await t.run(async (ctx) => {
			for (const stripeSessionId of ["cs_lookup_duplicate_1", "cs_lookup_duplicate_2"]) {
				await ctx.db.insert("orders", retainedOrder("ORD-010", stripeSessionId));
			}
		});

		await expect(
			t.query(api.orders.lookupForCustomer, {
				siteUrl: SITE_URL,
				email: "buyer@example.com",
				orderNumber: "ORD-010",
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
			stripePaymentCurrency: "usd",
			stripePaymentLivemode: false,
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

	test("keeps compatibility fee input explicitly legacy-unverified", async () => {
		const t = convexTest(schema, modules);
		const created = await t.mutation(api.orders.create, {
			...orderArgs("cs_legacy_fee_input"),
			stripePaymentIntentId: "pi_legacy_fee_input",
			stripeFees: 0,
		});
		const order = await t.run((ctx) => ctx.db.get(created._id));
		expect(order).toMatchObject({
			stripeFees: 0,
			stripeFeeProvenance: "legacy_unverified",
			stripeFeeCaptureStatus: "legacy_unverified",
		});
		expect(order?.stripeFeeCaptureNextAttemptAt).toBeUndefined();
	});

	test.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
		"rejects invalid compatibility fee input %s",
		async (stripeFees) => {
			const t = convexTest(schema, modules);
			await expect(t.mutation(api.orders.create, {
				...orderArgs(`cs_invalid_fee_${String(stripeFees)}`),
				stripeFees,
			})).rejects.toThrow("nonnegative safe-integer");
		},
	);

	test("marks compatibility fee updates unverified and clears provider provenance", async () => {
		const t = convexTest(schema, modules);
		const created = await t.mutation(api.orders.create, orderArgs("cs_legacy_fee_update"));
		await t.run((ctx) => ctx.db.patch(created._id, {
			stripeFees: 325,
			stripeFeeCurrency: "usd",
			stripeFeeChargeId: "ch_provider_verified",
			stripeFeeBalanceTransactionId: "txn_provider_verified",
			stripeFeeCapturedAt: Date.now(),
			stripeFeeProvenanceVersion: 1,
			stripeFeeProvenance: "provider_verified",
			stripeFeeCaptureStatus: "captured",
		}));

		await t.mutation(api.orders.updateStatus, {
			orderId: created._id,
			webhookSecret: WEBHOOK_SECRET,
			stripeFees: 99,
		});

		const order = await t.run((ctx) => ctx.db.get(created._id));
		expect(order).toMatchObject({
			stripeFees: 99,
			stripeFeeProvenance: "legacy_unverified",
			stripeFeeCaptureStatus: "legacy_unverified",
		});
		expect(order?.stripeFeeCurrency).toBeUndefined();
		expect(order?.stripeFeeChargeId).toBeUndefined();
		expect(order?.stripeFeeBalanceTransactionId).toBeUndefined();
		expect(order?.stripeFeeCapturedAt).toBeUndefined();
		expect(order?.stripeFeeProvenanceVersion).toBeUndefined();
	});

	test.each(["pending", "captured"] as const)(
		"keeps the payment-intent binding immutable while fee capture is %s",
		async (feeStatus) => {
			const t = convexTest(schema, modules);
			const created = await t.mutation(api.orders.create, {
				...orderArgs(`cs_immutable_fee_binding_${feeStatus}`),
				stripePaymentIntentId: "pi_originalfeebinding123",
			});
			if (feeStatus === "captured") {
				await t.run((ctx) => ctx.db.patch(created._id, {
					stripeFees: 325,
					stripeFeeCurrency: "usd",
					stripeFeeChargeId: "ch_original_fee_binding",
					stripeFeeBalanceTransactionId: "txn_original_fee_binding",
					stripeFeeCapturedAt: Date.now(),
					stripeFeeProvenanceVersion: 1,
					stripeFeeProvenance: "provider_verified",
					stripeFeeCaptureStatus: "captured",
					stripeFeeCaptureNextAttemptAt: undefined,
				}));
			}

			await expect(t.mutation(api.orders.updateStatus, {
				orderId: created._id,
				webhookSecret: WEBHOOK_SECRET,
				stripePaymentIntentId: "pi_replacedfeebinding123",
			})).rejects.toThrow("binding is immutable");

			expect(await t.run((ctx) => ctx.db.get(created._id))).toMatchObject({
				stripePaymentIntentId: "pi_originalfeebinding123",
				stripeFeeCaptureStatus: feeStatus,
			});
		},
	);

	test("preserves an unknown fee in order statistics", async () => {
		const t = convexTest(schema, modules);
		const adminEmail = "fee-stats-admin@example.com";
		await t.run((ctx) => ctx.db.insert("platformClients", {
			name: "Fee Stats", email: adminEmail, siteUrl: SITE_URL, tier: "full",
			subscriptionStatus: "active", adminEmails: [adminEmail], role: "client",
		}));
		await t.mutation(api.orders.create, {
			...orderArgs("cs_unknown_fee_stats"),
		});
		const admin = t.withIdentity({ subject: adminEmail, email: adminEmail, emailVerified: true });
		const stats = await admin.query(api.orders.getStats, { siteUrl: SITE_URL });
		expect(stats.recentOrders[0]?.stripeFees).toBeUndefined();
		expect(stats.recentOrders[0]?.stripePaymentCurrency).toBe("usd");
		expect(stats.grossPayments).toEqual([{
			currency: "usd",
			orderCount: 1,
			todayMinorUnits: 8400,
			weekMinorUnits: 8400,
			monthMinorUnits: 8400,
			allTimeMinorUnits: 8400,
		}]);
		expect(stats.unknownCurrencyOrderCount).toBe(0);
		expect(stats.stats.legacyRevenueCurrency).toBe("usd");
		expect(stats.stats.legacyRevenueCurrencyUnsafe).toBe(false);
	});

	test("groups gross payment statistics by currency and excludes unknown currency", async () => {
		const t = convexTest(schema, modules);
		const adminEmail = "grouped-fee-stats-admin@example.com";
		await t.run(async (ctx) => {
			await ctx.db.insert("platformClients", {
				name: "Grouped Fee Stats", email: adminEmail, siteUrl: SITE_URL, tier: "full",
				subscriptionStatus: "active", adminEmails: [adminEmail], role: "client",
			});
			await ctx.db.insert("orders", {
				...retainedOrder("ORD-101", "cs_grouped_usd"),
				stripePaymentCurrency: "usd",
			});
			await ctx.db.insert("orders", {
				...retainedOrder("ORD-102", "cs_grouped_eur"),
				stripePaymentCurrency: "eur",
			});
			await ctx.db.insert("orders", retainedOrder("ORD-103", "cs_grouped_unknown"));
			await ctx.db.insert("orders", {
				...retainedOrder("ORD-104", "cs_grouped_invalid"),
				stripePaymentCurrency: "usd",
				total: Number.NaN,
			});
		});
		const admin = t.withIdentity({ subject: adminEmail, email: adminEmail, emailVerified: true });
		const stats = await admin.query(api.orders.getStats, { siteUrl: SITE_URL });

		expect(stats.grossPayments).toEqual([
			{
				currency: "eur", orderCount: 1, todayMinorUnits: 4200, weekMinorUnits: 4200,
				monthMinorUnits: 4200, allTimeMinorUnits: 4200,
			},
			{
				currency: "usd", orderCount: 1, todayMinorUnits: 4200, weekMinorUnits: 4200,
				monthMinorUnits: 4200, allTimeMinorUnits: 4200,
			},
		]);
		expect(stats.unknownCurrencyOrderCount).toBe(1);
		expect(stats.invalidGrossAmountOrderCount).toBe(1);
		expect(stats.stats.legacyRevenueCurrency).toBeUndefined();
		expect(stats.stats.legacyRevenueCurrencyUnsafe).toBe(true);
		expect(stats.dailyGrossPayments).toHaveLength(60);
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

describe("V2 order shipment email leases", () => {
	function claimArgs(claimToken = CLAIM_TOKEN_A) {
		return {
			webhookSecret: WEBHOOK_SECRET,
			lumaprintsOrderNumber: "123",
			claimToken,
			trackingNumber: "1Z999",
			trackingUrl: "https://carrier.example/track/1Z999",
		};
	}

	test("retains deprecated site-scoped shipment exports for authenticated admins only", async () => {
		const { t, orderId } = await seedLumaPrintsOrder();
		const adminEmail = "shipment-admin@example.com";
		await t.run((ctx) => ctx.db.insert("platformClients", {
			name: "Tenant A",
			email: adminEmail,
			siteUrl: SITE_URL,
			tier: "full",
			subscriptionStatus: "active",
			adminEmails: [adminEmail],
			role: "client",
		}));
		await expect(t.mutation(api.orders.claimShipmentEmailNotification, {
			siteUrl: SITE_URL,
			lumaprintsOrderNumber: "123",
			webhookSecret: WEBHOOK_SECRET,
		})).rejects.toThrow("Not authenticated");
		await expect(t.query(api.orders.getByLumaprintsOrderNumber, {
			siteUrl: SITE_URL,
			lumaprintsOrderNumber: "123",
			webhookSecret: WEBHOOK_SECRET,
		})).rejects.toThrow("Not authenticated");

		const admin = t.withIdentity({ subject: adminEmail, email: adminEmail, emailVerified: true });
		await expect(admin.query(api.orders.getByLumaprintsOrderNumber, {
			siteUrl: SITE_URL,
			lumaprintsOrderNumber: "123",
		})).resolves.toMatchObject({ _id: orderId, customerEmail: "customer@example.com" });
		await expect(admin.mutation(api.orders.claimShipmentEmailNotification, {
			siteUrl: SITE_URL,
			lumaprintsOrderNumber: "123",
			trackingNumber: "ADMIN-TRACK",
		})).resolves.toMatchObject({ claimed: true });
		await expect(admin.mutation(api.orders.recordShipmentEmailDelivery, {
			siteUrl: SITE_URL,
			lumaprintsOrderNumber: "123",
			status: "failed",
			error: "arbitrary private provider text",
		})).resolves.toMatchObject({ recorded: true });
		expect(await t.run((ctx) => ctx.db.get(orderId))).toMatchObject({
			trackingNumber: "ADMIN-TRACK",
			shipmentEmailDeliveryStatus: "failed",
			shipmentEmailDeliveryError: "legacy_delivery_failed",
		});
	});

	test("leases once, reports active work as busy, and reclaims an expired lease", async () => {
		const { t, orderId } = await seedLumaPrintsOrder();

		await expect(
			t.mutation(api.orders.claimShipmentEmailNotificationV2, claimArgs()),
		).resolves.toMatchObject({
			kind: "claimed",
			leaseExpiresAt: expect.any(Number),
			order: {
				_id: orderId,
				siteUrl: SITE_URL,
				orderNumber: "ORD-001",
				customerEmail: "customer@example.com",
			},
		});
		expect(await t.run((ctx) => ctx.db.get(orderId))).toMatchObject({
			status: "shipped",
			trackingNumber: "1Z999",
			trackingUrl: "https://carrier.example/track/1Z999",
			shipmentEmailNotificationProtocol: "leased_v2",
			shipmentEmailNotificationClaimToken: CLAIM_TOKEN_A,
			shipmentEmailNotificationLeaseExpiresAt: expect.any(Number),
			shipmentEmailDeliveryStatus: "pending",
		});
		await expect(
			t.mutation(api.orders.claimShipmentEmailNotificationV2, claimArgs(CLAIM_TOKEN_B)),
		).resolves.toMatchObject({ kind: "busy", leaseExpiresAt: expect.any(Number) });

		await t.run((ctx) =>
			ctx.db.patch(orderId, { shipmentEmailNotificationLeaseExpiresAt: 0 }),
		);
		await expect(
			t.mutation(api.orders.claimShipmentEmailNotificationV2, claimArgs(CLAIM_TOKEN_B)),
		).resolves.toMatchObject({ kind: "claimed" });
		const reclaimed = await t.run((ctx) => ctx.db.get(orderId));
		expect(reclaimed).toMatchObject({
			shipmentEmailNotificationClaimToken: CLAIM_TOKEN_B,
		});
		expect(reclaimed?.shipmentEmailSentAt).toBeUndefined();
		await expect(t.mutation(api.orders.authorizeShipmentEmailNotificationSendV2, {
			orderId,
			lumaprintsOrderNumber: "123",
			claimToken: CLAIM_TOKEN_B,
			webhookSecret: WEBHOOK_SECRET,
		})).resolves.toBe(true);
	});

	test("does not authorize shipment email after the order is refunded", async () => {
		const { t, orderId } = await seedLumaPrintsOrder();
		await t.mutation(api.orders.claimShipmentEmailNotificationV2, claimArgs());
		await t.run((ctx) => ctx.db.patch(orderId, { status: "refunded" }));

		await expect(t.mutation(api.orders.authorizeShipmentEmailNotificationSendV2, {
			orderId,
			lumaprintsOrderNumber: "123",
			claimToken: CLAIM_TOKEN_A,
			webhookSecret: WEBHOOK_SECRET,
		})).resolves.toBe(false);
	});

	test("converges a V5 receipt, shipment, and verified full refund", async () => {
		const t = convexTest(schema, modules);
		const created = await t.mutation(api.orders.create, {
			...orderArgs(MANUAL_REFUND.session),
			stripePaymentIntentId: MANUAL_REFUND.paymentIntent,
		});
		await t.run((ctx) => ctx.db.patch(created._id, {
			printFulfillmentClaim: true,
			printFulfillmentClaimToken: CLAIM_TOKEN_A,
			printFulfillmentPhase: "submitting",
			printFulfillmentCoordinatorVersion: 5,
			printFulfillmentResolution: "submission_uncertain",
		}));
		await expect(t.mutation(api.orders.recordPrintFulfillmentSubmissionReceipt, {
			orderId: created._id,
			claimToken: CLAIM_TOKEN_A,
			externalId: MANUAL_REFUND.session,
			lumaprintsSubmissionOrderNumber: "123",
			webhookSecret: WEBHOOK_SECRET,
		})).resolves.toEqual({ kind: "recorded" });

		await expect(t.mutation(api.orders.claimShipmentEmailNotificationV2, claimArgs()))
			.resolves.toMatchObject({ kind: "claimed" });
		const shipped = await t.run((ctx) => ctx.db.get(created._id));
		expect(shipped).toMatchObject({
			status: "shipped",
			lumaprintsOrderNumber: "123",
			printFulfillmentResolution: "resolved",
		});
		expect(shipped?.lumaprintsSubmissionOrderNumber).toBeUndefined();
		await expect(t.mutation(api.orders.reconcileSucceededManualRefund, manualRefundArgs()))
			.resolves.toEqual({ kind: "reconciled" });
		const stored = await t.run((ctx) => ctx.db.get(created._id));
		expect(stored).toMatchObject({
			status: "refunded",
			lumaprintsOrderNumber: "123",
			printFulfillmentResolution: "resolved",
			stripeRefundId: MANUAL_REFUND.refund,
		});
		await expect(t.mutation(api.orders.authorizeShipmentEmailNotificationSendV2, {
			orderId: created._id,
			lumaprintsOrderNumber: "123",
			claimToken: CLAIM_TOKEN_A,
			webhookSecret: WEBHOOK_SECRET,
		})).resolves.toBe(false);
	});

	test("stops shipment email sends at the bounded retry deadline", async () => {
		const { t, orderId } = await seedLumaPrintsOrder();
		await t.mutation(api.orders.claimShipmentEmailNotificationV2, claimArgs());
		const firstAttemptAt = Date.now() - 23 * 60 * 60 * 1000;
		await t.run((ctx) => ctx.db.patch(orderId, {
			shipmentEmailNotificationClaimedAt: firstAttemptAt,
			shipmentEmailNotificationLeaseExpiresAt: 0,
		}));

		await expect(
			t.mutation(api.orders.claimShipmentEmailNotificationV2, claimArgs(CLAIM_TOKEN_B)),
		).resolves.toEqual({ kind: "completed" });
		await expect(t.mutation(api.orders.isShipmentEmailNotificationDeliveryUncertain, {
			lumaprintsOrderNumber: "123",
			webhookSecret: WEBHOOK_SECRET,
		})).resolves.toBe(true);
		await expect(t.mutation(api.orders.releaseShipmentEmailNotificationV2, {
			orderId,
			lumaprintsOrderNumber: "123",
			claimToken: CLAIM_TOKEN_A,
			failureCode: "email_delivery_failed",
			webhookSecret: WEBHOOK_SECRET,
		})).resolves.toBe(false);
		await expect(t.mutation(api.orders.completeShipmentEmailNotificationV2, {
			orderId,
			lumaprintsOrderNumber: "123",
			claimToken: CLAIM_TOKEN_A,
			deliveryStatus: "sent",
			webhookSecret: WEBHOOK_SECRET,
		})).resolves.toBe(false);
		expect(await t.run((ctx) => ctx.db.get(orderId))).toMatchObject({
			shipmentEmailDeliveryStatus: "uncertain",
			shipmentEmailDeliveryError: "completion_checkpoint_unconfirmed",
			shipmentEmailDeliveryAttemptedAt: expect.any(Number),
		});
		await expect(
			t.mutation(api.orders.claimShipmentEmailNotificationV2, {
				...claimArgs(CLAIM_TOKEN_A),
				trackingNumber: "UPDATED-TRACKING",
				trackingUrl: "https://carrier.example/track/UPDATED-TRACKING",
			}),
		).resolves.toEqual({ kind: "completed" });
		expect(await t.run((ctx) => ctx.db.get(orderId))).toMatchObject({
			trackingNumber: "UPDATED-TRACKING",
			trackingUrl: "https://carrier.example/track/UPDATED-TRACKING",
			shipmentEmailDeliveryStatus: "uncertain",
		});
	});

	test("does not restart shipment retries from mutable pre-rollout attempt times", async () => {
		const { t, orderId } = await seedLumaPrintsOrder();
		await t.run((ctx) => ctx.db.patch(orderId, {
			status: "shipped",
			shipmentEmailNotificationProtocol: "leased_v2",
			shipmentEmailNotificationRetryProtocol: undefined,
			shipmentEmailNotificationClaimedAt: undefined,
			shipmentEmailNotificationClaimToken: undefined,
			shipmentEmailNotificationLeaseExpiresAt: undefined,
			shipmentEmailDeliveryStatus: "failed",
			shipmentEmailDeliveryAttemptedAt: Date.now() - 22 * 60 * 60 * 1000,
			shipmentEmailDeliveryError: "email_delivery_failed",
		}));
		await t.run((ctx) => ctx.db.patch(orderId, {
			shipmentEmailDeliveryAttemptedAt: Date.now() - 60 * 60 * 1000,
		}));

		await expect(
			t.mutation(api.orders.claimShipmentEmailNotificationV2, claimArgs(CLAIM_TOKEN_B)),
		).resolves.toEqual({ kind: "completed" });
		await expect(t.mutation(api.orders.isShipmentEmailNotificationDeliveryUncertain, {
			lumaprintsOrderNumber: "123",
			webhookSecret: WEBHOOK_SECRET,
		})).resolves.toBe(true);
		const stored = await t.run((ctx) => ctx.db.get(orderId));
		expect(stored?.shipmentEmailNotificationClaimToken).toBeUndefined();
		expect(stored?.shipmentEmailNotificationClaimedAt).toBeUndefined();
	});

	test("releases a failed send with only an enumerated code and permits a retry", async () => {
		const { t, orderId } = await seedLumaPrintsOrder();
		await t.mutation(api.orders.claimShipmentEmailNotificationV2, claimArgs());

		await expect(
			t.mutation(api.orders.releaseShipmentEmailNotificationV2, {
				orderId,
				lumaprintsOrderNumber: "123",
				claimToken: CLAIM_TOKEN_B,
				failureCode: "unexpected_send_failure",
				webhookSecret: WEBHOOK_SECRET,
			}),
		).resolves.toBe(false);
		await expect(
			t.mutation(api.orders.releaseShipmentEmailNotificationV2, {
				orderId,
				lumaprintsOrderNumber: "123",
				claimToken: CLAIM_TOKEN_A,
				failureCode: "email_delivery_failed",
				webhookSecret: WEBHOOK_SECRET,
			}),
		).resolves.toBe(true);
		expect(await t.run((ctx) => ctx.db.get(orderId))).toMatchObject({
			shipmentEmailDeliveryStatus: "failed",
			shipmentEmailDeliveryError: "email_delivery_failed",
			shipmentEmailDeliveryAttemptedAt: expect.any(Number),
		});
		expect((await t.run((ctx) => ctx.db.get(orderId)))?.shipmentEmailNotificationClaimToken)
			.toBeUndefined();

		await expect(
			t.mutation(api.orders.claimShipmentEmailNotificationV2, claimArgs(CLAIM_TOKEN_B)),
		).resolves.toMatchObject({ kind: "claimed" });
	});

	test("requires the exact order ID, provider number, and token to complete", async () => {
		const { t, orderId } = await seedLumaPrintsOrder();
		await t.mutation(api.orders.claimShipmentEmailNotificationV2, claimArgs());

		for (const mismatch of [
			{ lumaprintsOrderNumber: "124", claimToken: CLAIM_TOKEN_A },
			{ lumaprintsOrderNumber: "123", claimToken: CLAIM_TOKEN_B },
		] as const) {
			await expect(
				t.mutation(api.orders.completeShipmentEmailNotificationV2, {
					orderId,
					...mismatch,
					deliveryStatus: "sent",
					webhookSecret: WEBHOOK_SECRET,
				}),
			).resolves.toBe(false);
		}

		await expect(
			t.mutation(api.orders.completeShipmentEmailNotificationV2, {
				orderId,
				lumaprintsOrderNumber: "123",
				claimToken: CLAIM_TOKEN_A,
				deliveryStatus: "sent",
				webhookSecret: WEBHOOK_SECRET,
			}),
		).resolves.toBe(true);
		expect(await t.run((ctx) => ctx.db.get(orderId))).toMatchObject({
			shipmentEmailNotificationCompletedAt: expect.any(Number),
			shipmentEmailSentAt: expect.any(Number),
			shipmentEmailDeliveryStatus: "sent",
		});
		await expect(
			t.mutation(api.orders.claimShipmentEmailNotificationV2, claimArgs(CLAIM_TOKEN_B)),
		).resolves.toEqual({ kind: "completed" });
	});

	test("keeps historical shipped or claimed rows terminal without V2 evidence", async () => {
		for (const historicalPatch of [
			{ status: "shipped" as const },
			{ shipmentEmailSentAt: Date.now() },
		]) {
			const { t, orderId } = await seedLumaPrintsOrder();
			await t.run((ctx) => ctx.db.patch(orderId, historicalPatch));
			await expect(
				t.mutation(api.orders.claimShipmentEmailNotificationV2, claimArgs()),
			).resolves.toEqual({ kind: "completed" });
			const order = await t.run((ctx) => ctx.db.get(orderId));
			expect(order?.shipmentEmailNotificationProtocol).toBeUndefined();
			expect(order?.shipmentEmailNotificationClaimToken).toBeUndefined();
		}
	});

	test("rejects noncanonical numbers, duplicate global identities, and bad authority", async () => {
		const { t } = await seedLumaPrintsOrder();
		await expect(
			t.mutation(api.orders.claimShipmentEmailNotificationV2, {
				...claimArgs(),
				lumaprintsOrderNumber: "01",
			}),
		).rejects.toThrow("Invalid LumaPrints order number");
		await expect(
			t.mutation(api.orders.claimShipmentEmailNotificationV2, {
				...claimArgs(),
				webhookSecret: "wrong-secret",
			}),
		).rejects.toThrow("Not authorized");

		const duplicate = await t.mutation(api.orders.create, {
			siteUrl: "tenant-b.example",
			webhookSecret: WEBHOOK_SECRET,
			stripeSessionId: "cs_other_tenant",
			customerEmail: "other@example.com",
			items: [{ productName: "Other print", quantity: 1, price: 42 }],
			total: 42,
			fulfillmentType: "lumaprints",
		});
		await t.run((ctx) =>
			ctx.db.patch(duplicate._id, {
				status: "printing",
				lumaprintsOrderNumber: "123",
				printFulfillmentResolution: "resolved",
			}),
		);
		await expect(
			t.mutation(api.orders.claimShipmentEmailNotificationV2, claimArgs()),
		).rejects.toThrow("Duplicate LumaPrints order number across tenants");
	});

	test("returns null for an unknown canonical provider order number", async () => {
		const { t } = await seedLumaPrintsOrder();
		await expect(
			t.mutation(api.orders.claimShipmentEmailNotificationV2, {
				...claimArgs(),
				lumaprintsOrderNumber: "99999",
			}),
		).resolves.toBeNull();
	});
});
