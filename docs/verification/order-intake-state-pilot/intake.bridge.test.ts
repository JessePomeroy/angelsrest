/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { selectCheckoutSnapshotInput } from "../../../src/lib/server/checkoutSnapshotConsumer";
import { buildConvexOrderCreatePayload } from "../../../src/lib/server/webhookOrderPayload";
import { api, internal } from "../../../packages/crm-api/convex/_generated/api";
import {
	reservationHandleHash,
	reservationSnapshotDigest,
} from "../../../packages/crm-api/convex/helpers/checkoutSnapshot";
import schema from "../../../packages/crm-api/convex/schema";

// Executed ONLY from a task-owned temporary copy by check.py's isolated config.
const modules = import.meta.glob("../../../packages/crm-api/convex/**/*.ts");
const SECRET = "offline-order-intake-pilot-authority-0123456789";
const TENANT = "tenant_05eb6092-5d8c-43ce-ad26-1a59522bd07b";
const OTHER_TENANT = "tenant_15eb6092-5d8c-43ce-ad26-1a59522bd07b";
const ACCOUNT = "acct_1234567890TenantA";
const OTHER_ACCOUNT = "acct_1234567890TenantB";
const SESSION = "cs_test_1234567890abcdefghijklmnop";
const HANDLE = "123e4567-e89b-42d3-a456-426614174000";
const snapshot = {
	schemaVersion: 1 as const,
	catalogProvider: "convex" as const,
	items: [{
		productKey: "pilot-product", revisionId: "pilot-revision",
		productKind: "digital_download" as const, variantKey: null,
		materialOptionKey: null, sizeOptionKey: null,
		borderOptionKey: null, frameOptionKey: null,
	}],
};

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
	vi.stubEnv("WEBHOOK_SECRET", SECRET);
	vi.stubEnv("ORDER_PRODUCERS_STATE", "open");
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

const cases = [
	{ name: "hub platform", site: "angelsrest.online", tenant: undefined, account: undefined },
	{ name: "tenant platform", site: "tenant-a.example", tenant: TENANT, account: undefined },
	{ name: "tenant connected", site: "tenant-a.example", tenant: TENANT, account: ACCOUNT },
];

describe.each(cases)("$name", ({ site, tenant, account }) => {
	async function setup() {
		const t = convexTest(schema, modules);
		await t.run(async (ctx) => {
			for (const [siteUrl, tenantId, stripeConnectedAccountId] of [
				[site, TENANT, ACCOUNT], ["tenant-b.example", OTHER_TENANT, OTHER_ACCOUNT],
			] as const) {
				await ctx.db.insert("platformClients", {
					siteUrl, tenantId, stripeConnectedAccountId,
					name: "Synthetic pilot", email: "operator@example.invalid",
					adminEmails: ["operator@example.invalid"],
					tier: "full", subscriptionStatus: "active",
				});
			}
		});
		const handleHash = await reservationHandleHash(site, HANDLE);
		expect(await t.mutation(internal.orders.reserveCheckoutSnapshot, {
			siteUrl: site, tenantId: tenant, stripeConnectedAccountId: account,
			handleHash, snapshotDigest: await reservationSnapshotDigest(snapshot), snapshot,
		})).toMatchObject({ outcome: "created" });
		expect(await t.mutation(internal.orders.bindCheckoutSnapshot, {
			siteUrl: site, tenantId: tenant, stripeConnectedAccountId: account,
			handleHash, stripeSessionId: SESSION, stripeExpiresAt: Date.now() / 1000 + 3600,
		})).toMatchObject({ outcome: "bound" });
		return t;
	}
	const routeArgs = {
		stripeSessionId: SESSION, stripeTenantMetadataSiteUrl: site,
		stripeTenantMetadataTenantId: tenant, stripeConnectedAccountId: account,
		webhookSecret: SECRET,
	};
	const payload = {
		siteUrl: site, tenantId: tenant, stripeConnectedAccountId: account,
		webhookSecret: SECRET, stripeSessionId: SESSION,
		customerEmail: "buyer@example.invalid",
		items: [{ productName: "Synthetic purchase", quantity: 1, price: 4200 }],
		total: 4200, fulfillmentType: "digital" as const,
	};
	const candidate = { version: 2, handle: HANDLE };
	async function assertReceipt(t: ReturnType<typeof convexTest>) {
		const [orders, reservations] = await t.run(async (ctx) => Promise.all([
			ctx.db.query("orders").take(10), ctx.db.query("checkoutSnapshotReservations").take(10),
		]));
		expect(orders).toHaveLength(1);
		expect(reservations).toHaveLength(0);
		expect(orders[0]).toMatchObject({
			siteUrl: site, stripeSessionId: SESSION, checkoutSnapshot: snapshot,
			customerEmail: payload.customerEmail, total: payload.total,
		});
		expect(orders[0]?.tenantId).toBe(tenant);
		expect(orders[0]?.stripeConnectedAccountId).toBe(account);
		const order = orders[0];
		if (!order) throw new Error("Expected one persisted order");
		return order;
	}

	test("fresh order route retries converge after a lost reply", async () => {
		const t = await setup();
		expect((await t.query(api.orders.resolveCheckoutRouting, routeArgs))?.source).toBe("reservation");
		// Commit then discard the response: transport loss cannot undo this write.
		await t.mutation(api.orders.create, { ...payload, checkoutSnapshotReservation: candidate });
		const persisted = await assertReceipt(t);
		const routing = await t.query(api.orders.resolveCheckoutRouting, routeArgs);
		expect(routing?.source).toBe("order");
		// Exercise the REAL host selector and payload builder on the saved route.
		const replayPayload = buildConvexOrderCreatePayload({
			session: {
				id: SESSION, mode: "payment", metadata: { isDigital: "true" },
				amount_total: 9999, amount_subtotal: 4200, payment_status: "paid",
				currency: "usd", livemode: false, created: Date.now() / 1000,
				expires_at: Date.now() / 1000 + 3600, customer_email: payload.customerEmail,
				customer_details: { email: payload.customerEmail, name: null }, payment_intent: null,
			},
			shippingDetails: undefined, lineItems: [], tenantId: tenant, siteUrl: site,
			webhookSecret: SECRET, stripeRequestOptions: account ? { stripeAccount: account } : undefined,
			checkoutSnapshotInput: selectCheckoutSnapshotInput(routing?.source ?? null),
		});
		expect(replayPayload.checkoutSnapshotReservation).toBeUndefined();
		const replay = await t.mutation(api.orders.create, replayPayload);
		const after = await assertReceipt(t);
		expect(replay._id).toBe(persisted._id);
		expect(after._id).toBe(persisted._id);
	});

	test("two stale reservation routes converge and concurrent writes reuse identity", async () => {
		const t = await setup();
		const routes = await Promise.all([
			t.query(api.orders.resolveCheckoutRouting, routeArgs),
			t.query(api.orders.resolveCheckoutRouting, routeArgs),
		]);
		expect(routes.map((route) => route?.source)).toEqual(["reservation", "reservation"]);
		const replies = await Promise.all([
			t.mutation(api.orders.create, { ...payload, checkoutSnapshotReservation: candidate }),
			t.mutation(api.orders.create, { ...payload, checkoutSnapshotReservation: candidate }),
		]);
		const order = await assertReceipt(t);
		expect(replies.map(({ _id }) => _id)).toEqual([order._id, order._id]);
		expect((await t.mutation(api.orders.create, {
			...payload, checkoutSnapshotReservation: { malformed: true },
		}))._id).toBe(order._id);
	});

	test("late transaction failure preserves the bound reservation for retry", async () => {
		const t = await setup();
		const before = await t.run((ctx) => ctx.db.query("checkoutSnapshotReservations").take(10));
		// Validation is after consumeReservation's delete in orders.create.
		await expect(t.mutation(api.orders.create, {
			...payload, checkoutSnapshotReservation: candidate, orderNumber: "invalid-pilot-number",
		})).rejects.toThrow("Invalid order number");
		expect(await t.run((ctx) => ctx.db.query("checkoutSnapshotReservations").take(10))).toEqual(before);
		expect(await t.run((ctx) => ctx.db.query("orders").take(10))).toHaveLength(0);
		await t.mutation(api.orders.create, { ...payload, checkoutSnapshotReservation: candidate });
		await assertReceipt(t);
	});

	test("conflicting tenant and provider-account identities cannot claim the receipt", async () => {
		const t = await setup();
		for (const phase of ["before", "after"]) {
			await expect(t.query(api.orders.resolveCheckoutRouting, {
				...routeArgs, stripeTenantMetadataTenantId: OTHER_TENANT,
			})).rejects.toThrow("routing facts conflict");
			await expect(t.mutation(api.orders.create, {
				...payload, tenantId: OTHER_TENANT, checkoutSnapshotReservation: candidate,
			})).rejects.toThrow("routing facts conflict");
			await expect(t.mutation(api.orders.create, {
				...payload, stripeConnectedAccountId: OTHER_ACCOUNT, checkoutSnapshotReservation: candidate,
			})).rejects.toThrow("routing facts conflict");
			if (phase === "before") {
				expect(await t.run((ctx) => ctx.db.query("checkoutSnapshotReservations").take(10))).toHaveLength(1);
				await t.mutation(api.orders.create, { ...payload, checkoutSnapshotReservation: candidate });
			}
		}
		await assertReceipt(t);
	});
});
