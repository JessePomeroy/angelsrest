/// <reference types="vite/client" />
// @vitest-environment edge-runtime
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import { ensureTenantAliases } from "./helpers/tenantContext";
import { claimToken, secret, setup } from "../test/lumaprintsOrderContextFixtures";

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date("2026-09-21T12:00:00Z"));
	vi.stubEnv("WEBHOOK_SECRET", secret);
	vi.stubEnv("ORDER_PRODUCERS_STATE", "open");
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });


describe("saved LumaPrints order context consumer", () => {
	test("atomically transfers the bound context and preserves it on replay after detachment", async () => {
		const { t, tenant } = await setup();
		const seed = await tenant(1);
		await t.run(async ctx => {
			await ensureTenantAliases(ctx, seed.connection.tenantId, seed.clientId, seed.args.siteUrl, "operator");
			await ctx.db.patch(seed.clientId, { lumaprintsConnectionRef: undefined, siteUrl: "renamed.example" });
		});
		const [first, second] = await Promise.all([t.mutation(api.orders.create, seed.args), t.mutation(api.orders.create, seed.args)]);
		expect(first._id).toBe(second._id);
		expect(first.lumaprintsConnection).toEqual(seed.connection);
		expect(second.lumaprintsConnection).toEqual(seed.connection);
		expect(await t.run(ctx => ctx.db.get(seed.reservationId))).toBeNull();
		expect((await t.run(ctx => ctx.db.get(first._id)))?.lumaprintsConnection).toEqual(seed.connection);
		expect(await t.run(ctx => ctx.db.query("orders").take(2))).toHaveLength(1);
	});

	test("does not accept supplier identity as an order-create argument", async () => {
		const { t, tenant } = await setup();
		const seed = await tenant(1);
		const attempted = { ...seed.args, lumaprintsConnection: seed.connection };
		await expect(t.mutation(api.orders.create, attempted)).rejects.toThrow();
		expect(await t.run(ctx => ctx.db.get(seed.reservationId))).not.toBeNull();
		expect(await t.run(ctx => ctx.db.query("orders").take(1))).toEqual([]);
	});

	test.each(["tenant", "store", "missing_history", "nonprint"])("rejects corrupt reservation %s atomically", async fault => {
		const { t, tenant } = await setup();
		const seed = await tenant(1);
		await t.run(async ctx => {
			if (fault === "missing_history") {
				const connection = await ctx.db.query("lumaprintsConnections").unique();
				if (connection) await ctx.db.delete(connection._id);
			} else if (fault === "nonprint") {
				await ctx.db.patch(seed.reservationId, { printInput: { version: 1, lines: [{ amountCents: 1000, sources: [] }] } });
			} else {
				await ctx.db.patch(seed.reservationId, { lumaprintsConnection: { ...seed.connection,
					...(fault === "store" ? { storeId: 202 } : { tenantId: "tenant_22222222-2222-4222-8222-222222222222" }) } });
			}
		});
		await expect(t.mutation(api.orders.create, seed.args)).rejects.toThrow(/LumaPrints/);
		expect(await t.run(ctx => ctx.db.get(seed.reservationId))).not.toBeNull();
		expect(await t.run(ctx => ctx.db.query("orders").take(1))).toEqual([]);
	});

	test("does not infer or backfill context from the current client selection", async () => {
		const { t, tenant } = await setup();
		const seed = await tenant(1);
		await t.run(ctx => ctx.db.patch(seed.reservationId, { lumaprintsConnection: undefined }));
		const created = await t.mutation(api.orders.create, seed.args);
		expect(created.lumaprintsConnection).toBeUndefined();
		expect((await t.mutation(api.orders.create, seed.args)).lumaprintsConnection).toBeUndefined();
	});

	test("requires the exact saved context before claiming or reconciling, including old workers", async () => {
		const { t, paid } = await setup();
		const s = await paid(1);
		for (const reference of [api.orders.claimPrintFulfillmentV4, api.orders.claimPrintFulfillmentV5]) {
			expect(await t.mutation(reference, s.command)).toEqual({ kind: "busy" });
			expect(await t.mutation(reference, { ...s.command, lumaprintsConnection: { ...s.connection, storeId: 202 } })).toEqual({ kind: "busy" });
		}
		expect(await t.mutation(api.orders.claimPrintFulfillmentV5, { ...s.command, lumaprintsConnection: s.connection })).toMatchObject({ kind: "claimed" });
		await t.mutation(api.orders.beginPrintFulfillmentSubmission, s.command);
		expect(await t.mutation(api.orders.claimPrintFulfillmentV5, s.command)).toEqual({ kind: "busy" });
		expect(await t.mutation(api.orders.claimPrintFulfillmentV5, { ...s.command, lumaprintsConnection: s.connection })).toMatchObject({ kind: "reconcile" });
		const stored = await t.run(ctx => ctx.db.get(s.order._id));
		expect(stored?.printFulfillmentResolution).toBe("submission_uncertain");
	});

	test("refuses legacy V1-V3 access even when a context-bearing row has no job", async () => {
		const { t, paid } = await setup();
		const s = await paid(1);
		await t.run(ctx => ctx.db.patch(s.order._id, { printJobId: undefined }));
		const args = { orderId: s.order._id, webhookSecret: secret };
		expect(await t.mutation(api.orders.claimPrintFulfillment, args)).toEqual({ kind: "busy" });
		for (const reference of [api.orders.claimPrintFulfillmentV2, api.orders.claimPrintFulfillmentV3]) {
			expect(await t.mutation(reference, { ...args, claimToken })).toEqual({ kind: "busy" });
		}
	});

	test("retains historical ownership during retry but rejects corrupted supplier history", async () => {
		const { t, paid } = await setup();
		const s = await paid(1);
		await t.run(ctx => ctx.db.patch(s.clientId, { lumaprintsConnectionRef: undefined }));
		expect(await t.mutation(api.orders.claimPrintFulfillmentV5, { ...s.command, lumaprintsConnection: s.connection })).toMatchObject({ kind: "claimed" });
		await t.mutation(api.orders.beginPrintFulfillmentSubmission, s.command);
		await t.run(async ctx => {
			const history = await ctx.db.query("lumaprintsConnections").unique();
			if (history) await ctx.db.patch(history._id, { storeId: 202 });
		});
		await expect(t.mutation(api.orders.claimPrintFulfillmentV5, { ...s.command, lumaprintsConnection: s.connection })).rejects.toThrow("saved ownership");
		expect((await t.run(ctx => ctx.db.get(s.order._id)))?.printFulfillmentResolution).toBe("submission_uncertain");
	});

	test("scopes equal provisional and confirmed provider numbers to their saved connections", async () => {
		const { t, paid } = await setup();
		const a = await paid(1);
		const b = await paid(2);
		for (const s of [a, b]) {
			await t.mutation(api.orders.claimPrintFulfillmentV5, { ...s.command, lumaprintsConnection: s.connection });
			await t.mutation(api.orders.beginPrintFulfillmentSubmission, s.command);
			expect(await t.mutation(api.orders.recordPrintFulfillmentSubmissionReceipt, {
				orderId: s.order._id, claimToken, externalId: s.args.stripeSessionId,
				lumaprintsSubmissionOrderNumber: "12345", tenantId: s.connection.tenantId, webhookSecret: secret,
			})).toEqual({ kind: "recorded" });
		}
		// Central webhook credentials cannot attach either preliminary receipt or send mail.
		const before = await t.run(ctx => ctx.db.query("orders").take(3));
		expect(await t.mutation(api.orders.claimShipmentEmailNotificationV2, { lumaprintsOrderNumber: "12345", claimToken, webhookSecret: secret })).toBeNull();
		expect(await t.run(ctx => ctx.db.query("orders").take(3))).toEqual(before);
		for (const s of [a, b]) {
			await t.mutation(api.orders.reconcilePrintFulfillmentSubmission, { orderId: s.order._id, externalId: s.args.stripeSessionId,
				lumaprintsOrderNumber: "12345", tenantId: s.connection.tenantId, webhookSecret: secret });
			expect(await t.mutation(api.orders.claimOrderConfirmation, { orderId: s.order._id, webhookSecret: secret })).toBe(true);
		}
		expect(await t.mutation(api.orders.claimShipmentEmailNotificationV2, { lumaprintsOrderNumber: "12345", claimToken, webhookSecret: secret })).toBeNull();
		expect(await t.mutation(api.orders.isShipmentEmailNotificationDeliveryUncertain, { lumaprintsOrderNumber: "12345", webhookSecret: secret })).toBe(false);
		const legacyId = await t.run(ctx => ctx.db.insert("orders", {
			siteUrl: "angelsrest.online", orderNumber: "ORD-001", stripeSessionId: "cs_test_legacy1234567890",
			customerEmail: "legacy@example.invalid", total: 1000, status: "new", fulfillmentType: "lumaprints",
			items: [{ productName: "Legacy print", quantity: 1, price: 1000 }],
			lumaprintsOrderNumber: "12345", printFulfillmentResolution: "resolved",
		}));
		expect(await t.mutation(api.orders.claimShipmentEmailNotificationV2, { lumaprintsOrderNumber: "12345", claimToken, webhookSecret: secret })).toMatchObject({ kind: "claimed", order: { _id: legacyId } });
		for (const s of [a, b]) expect((await t.run(ctx => ctx.db.get(s.order._id)))?.status).toBe("new");
	});

	test("still rejects duplicate provider numbers inside one supplier connection", async () => {
		const { t, paid } = await setup();
		const s = await paid(1);
		await t.mutation(api.orders.claimPrintFulfillmentV5, { ...s.command, lumaprintsConnection: s.connection });
		await t.mutation(api.orders.beginPrintFulfillmentSubmission, s.command);
		await t.run(async ctx => {
			const row = await ctx.db.get(s.order._id);
			if (!row) throw new Error("Missing order");
			const { _id, _creationTime, ...fields } = row;
			await ctx.db.insert("orders", { ...fields, stripeSessionId: "cs_test_another1234567890", orderNumber: "ORD-002", lumaprintsOrderNumber: "12345" });
		});
		await expect(t.mutation(api.orders.recordPrintFulfillmentSubmissionReceipt, {
			orderId: s.order._id, claimToken, externalId: s.args.stripeSessionId, lumaprintsSubmissionOrderNumber: "12345", webhookSecret: secret,
		})).rejects.toThrow("belongs to another order");
	});
});
