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

beforeEach(() => {
	process.env.WEBHOOK_SECRET = WEBHOOK_SECRET;
	process.env.ORDER_LOOKUP_SECRET = ORDER_LOOKUP_SECRET;
});

afterEach(() => {
	delete process.env.WEBHOOK_SECRET;
	delete process.env.ORDER_LOOKUP_SECRET;
});

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
