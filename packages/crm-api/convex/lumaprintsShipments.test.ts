/// <reference types="vite/client" />
// @vitest-environment edge-runtime
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import { claimToken, secret, setup } from "../test/lumaprintsOrderContextFixtures";

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date("2026-09-21T12:00:00Z"));
	vi.stubEnv("WEBHOOK_SECRET", secret);
	vi.stubEnv("ORDER_PRODUCERS_STATE", "open");
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

async function fixture() {
	const s = await setup();
	const a = await s.submitted(1);
	const b = await s.submitted(2);
	const claim = { lumaprintsConnection: a.connection, lumaprintsOrderNumber: "12345", claimToken, webhookSecret: secret };
	return { ...s, a, b, claim };
}

test("attaches and leases only the authenticated receipt, with concurrent delivery fencing", async () => {
	const s = await fixture();
	const attempts = await Promise.all([
		s.t.mutation(api.orders.claimShipmentEmailNotificationV2, s.claim),
		s.t.mutation(api.orders.claimShipmentEmailNotificationV2, { ...s.claim, claimToken: "123e4567-e89b-42d3-a456-426614174001" }),
	]);
	expect(attempts.map(result => result?.kind).sort()).toEqual(["busy", "claimed"]);
	const a = await s.t.run(ctx => ctx.db.get(s.a.order._id));
	const b = await s.t.run(ctx => ctx.db.get(s.b.order._id));
	expect(a).toMatchObject({ status: "shipped", lumaprintsOrderNumber: "12345", printFulfillmentResolution: "resolved" });
	expect(b?.lumaprintsOrderNumber).toBeUndefined();
	expect(b?.shipmentEmailNotificationClaimToken).toBeUndefined();
	expect(await s.t.mutation(api.orders.claimShipmentEmailNotificationV2, { ...s.claim, lumaprintsConnection: s.b.connection })).toMatchObject({ kind: "claimed", order: { _id: s.b.order._id } });
});

test("every checkpoint rejects another scope even with the correct order ID and lease token", async () => {
	const s = await fixture();
	await s.t.mutation(api.orders.claimShipmentEmailNotificationV2, s.claim);
	const checkpoint = { ...s.claim, orderId: s.a.order._id };
	const before = await s.t.run(ctx => ctx.db.get(s.a.order._id));
	for (const lumaprintsConnection of [undefined, s.b.connection, { ...s.a.connection, storeId: 999 }]) {
		const wrong = { ...checkpoint, lumaprintsConnection };
		expect(await s.t.mutation(api.orders.authorizeShipmentEmailNotificationSendV2, wrong)).toBe(false);
		expect(await s.t.mutation(api.orders.releaseShipmentEmailNotificationV2, { ...wrong, failureCode: "email_delivery_failed" })).toBe(false);
		expect(await s.t.mutation(api.orders.completeShipmentEmailNotificationV2, { ...wrong, deliveryStatus: "sent" })).toBe(false);
	}
	expect(await s.t.run(ctx => ctx.db.get(s.a.order._id))).toEqual(before);
	expect(await s.t.mutation(api.orders.authorizeShipmentEmailNotificationSendV2, checkpoint)).toBe(true);
	expect(await s.t.mutation(api.orders.completeShipmentEmailNotificationV2, { ...checkpoint, deliveryStatus: "sent" })).toBe(true);
});

test.each(["input_store", "saved_store", "tenant", "missing_history"])("rejects %s identity corruption before attaching the receipt", async fault => {
	const s = await fixture();
	await s.t.run(async ctx => {
		if (fault === "saved_store") await ctx.db.patch(s.a.order._id, { lumaprintsConnection: { ...s.a.connection, storeId: 999 } });
		if (fault === "tenant") await ctx.db.patch(s.a.order._id, { tenantId: s.b.connection.tenantId });
		if (fault === "missing_history") {
			const row = await ctx.db.query("lumaprintsConnections").withIndex("by_connectionRef", q => q.eq("connectionRef", s.a.connection.connectionRef)).unique();
			if (row) await ctx.db.delete(row._id);
		}
	});
	const before = await s.t.run(ctx => ctx.db.get(s.a.order._id));
	await expect(s.t.mutation(api.orders.claimShipmentEmailNotificationV2, {
		...s.claim, lumaprintsConnection: fault === "input_store" ? { ...s.a.connection, storeId: 999 } : s.a.connection,
	})).rejects.toThrow(/connection/);
	expect(await s.t.run(ctx => ctx.db.get(s.a.order._id))).toEqual(before);
});

test("revalidates immutable ownership after the claim and before each later checkpoint", async () => {
	const s = await fixture();
	await s.t.mutation(api.orders.claimShipmentEmailNotificationV2, s.claim);
	await s.t.run(async ctx => {
		const row = await ctx.db.query("lumaprintsConnections").withIndex("by_connectionRef", q => q.eq("connectionRef", s.a.connection.connectionRef)).unique();
		if (row) await ctx.db.patch(row._id, { storeId: 999 });
	});
	const checkpoint = { ...s.claim, orderId: s.a.order._id };
	const before = await s.t.run(ctx => ctx.db.get(s.a.order._id));
	await expect(s.t.mutation(api.orders.authorizeShipmentEmailNotificationSendV2, checkpoint)).rejects.toThrow(/ownership/);
	await expect(s.t.mutation(api.orders.releaseShipmentEmailNotificationV2, { ...checkpoint, failureCode: "email_delivery_failed" })).rejects.toThrow(/ownership/);
	await expect(s.t.mutation(api.orders.completeShipmentEmailNotificationV2, { ...checkpoint, deliveryStatus: "sent" })).rejects.toThrow(/ownership/);
	expect(await s.t.run(ctx => ctx.db.get(s.a.order._id))).toEqual(before);
});

test("keeps delivery uncertainty inside its connection scope", async () => {
	const s = await fixture();
	for (const lumaprintsConnection of [s.a.connection, s.b.connection]) {
		await s.t.mutation(api.orders.claimShipmentEmailNotificationV2, { ...s.claim, lumaprintsConnection });
	}
	await s.t.run(ctx => ctx.db.patch(s.a.order._id, { shipmentEmailDeliveryStatus: "uncertain" }));
	const args = { lumaprintsOrderNumber: "12345", webhookSecret: secret };
	expect(await s.t.mutation(api.orders.isShipmentEmailNotificationDeliveryUncertain, args)).toBe(false);
	expect(await s.t.mutation(api.orders.isShipmentEmailNotificationDeliveryUncertain, { ...args, lumaprintsConnection: s.b.connection })).toBe(false);
	expect(await s.t.mutation(api.orders.isShipmentEmailNotificationDeliveryUncertain, { ...args, lumaprintsConnection: s.a.connection })).toBe(true);
});

test("still requires hub authentication with an otherwise valid supplier identity", async () => {
	const s = await fixture();
	await expect(s.t.mutation(api.orders.claimShipmentEmailNotificationV2, { ...s.claim, webhookSecret: "wrong" })).rejects.toThrow();
	expect((await s.t.run(ctx => ctx.db.get(s.a.order._id)))?.lumaprintsOrderNumber).toBeUndefined();
});
