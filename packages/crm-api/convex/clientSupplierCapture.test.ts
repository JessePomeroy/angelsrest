/// <reference types="vite/client" />
// @vitest-environment edge-runtime
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createGraph, graphDraft, setup, SITE_A, SITE_B } from "../test/catalogProductGraphFixtures";
import { api, internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { parseReservationRequest, reservationHandleHash, reservationSnapshotDigest } from "./helpers/checkoutSnapshot";
import { serverSecretFingerprint } from "./helpers/serverSecrets";

const modules = import.meta.glob("./**/*.ts");
const secret = "supplier-capture-hub-secret-0123456789abcdef";
const credential = "supplier-capture-reservation-secret-0123456789abcdef";
const attempt = "123e4567-e89b-42d3-a456-426614174000";
beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date("2026-09-21T00:00:00Z"));
	vi.stubEnv("ORDER_PRODUCERS_STATE", "open");
	vi.stubEnv("WEBHOOK_SECRET", secret);
	vi.stubEnv("SITE_URL", "https://www.angelsrest.online");
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

async function fixture() {
	const f = await setup(modules);
	async function tenant(index: 1 | 2, kind: "print" | "digital_download" | "merchant" = "print") {
		const siteUrl = index === 1 ? SITE_A.siteUrl : SITE_B.siteUrl;
		const admin = index === 1 ? f.adminA : f.adminB;
		const client = await f.t.run(ctx => ctx.db.query("platformClients").withIndex("by_siteUrl", q => q.eq("siteUrl", siteUrl)).unique());
		if (!client?.tenantId) throw new Error("Missing seeded tenant");
		const tenantId = client.tenantId;
		const account = `acct_suppliercapture000${index}`;
		const connection = { version: 1 as const, connectionRef: `lp_supplier_capture_${index}`, tenantId, storeId: 101, environment: "sandbox" as const };
		const connectionId = await f.t.run(async ctx => {
			await ctx.db.patch(client._id, { stripeConnectedAccountId: account, lumaprintsConnectionRef: connection.connectionRef });
			await ctx.db.insert("stripeAccountBindings", { stripeConnectedAccountId: account, clientId: client._id, tenantId, attemptId: attempt, platformAccountId: "acct_platformcapture000", livemode: false, boundAt: Date.now() });
			return await ctx.db.insert("lumaprintsConnections", { ...connection, clientId: client._id, storeVerifiedAt: Date.now(), accountOwnershipConfirmedAt: Date.now(), billingConfirmedAt: Date.now() });
		});
		const assets = index === 1 ? f : { ...f, webA: f.webB, webA2: f.webB, printA: f.printB, printA2: f.printB, paidA: f.paidB };
		const draft = kind === "merchant" ? { ...graphDraft("print", assets), fulfillmentMode: "merchant_fulfilled" as const } : graphDraft(kind, assets);
		const created = await createGraph(admin, siteUrl, `capture-${kind}`, draft);
		const product = await f.t.run(ctx => ctx.db.get(created.productId));
		if (!product) throw new Error("Missing product");
		await admin.mutation(api.catalogProductGraphs.publishDraft, { productId: created.productId, expectedDraftRevisionId: product.draftRevisionId ?? null, expectedPublishedRevisionId: null, expectedUpdatedAt: product.updatedAt });
		const isPrint = kind !== "digital_download";
		const item: Doc<"checkoutSnapshotReservations">["snapshot"]["items"][number] = {
			productKey: created.productId, revisionId: created.revisionId, productKind: isPrint ? "print" : "digital_download",
			variantKey: isPrint ? "matte-small" : "default", materialOptionKey: isPrint ? "archival-matte" : null,
			sizeOptionKey: isPrint ? "8x10" : null, borderOptionKey: isPrint ? "none" : null, frameOptionKey: isPrint ? "none" : null,
		};
		const snapshot = { schemaVersion: 1 as const, catalogProvider: "convex" as const, items: [item] };
		const args = { siteUrl, tenantId, stripeConnectedAccountId: account, snapshot,
			handleHash: await reservationHandleHash(siteUrl, attempt), snapshotDigest: await reservationSnapshotDigest(snapshot),
			printInputVersion: 1 as const, lumaprintsConnectionVersion: 1 as const };
		return { client, connection, connectionId, args };
	}
	return { ...f, tenant };
}

test("two clients capture their own supplier with artwork and transfer it to their paid orders", async () => {
	const s = await fixture();
	for (const index of [1, 2] as const) {
		const tenant = await s.tenant(index);
		const { args, connection } = tenant;
		expect(await s.t.mutation(internal.orders.reserveCheckoutSnapshot, args)).toEqual({ outcome: "created", lumaprintsConnection: connection });
		const session = `cs_test_suppliercaptureorder${index}`;
		expect(await s.t.mutation(internal.orders.bindCheckoutSnapshot, { siteUrl: args.siteUrl, tenantId: args.tenantId, handleHash: args.handleHash, stripeConnectedAccountId: args.stripeConnectedAccountId, stripeSessionId: session, stripeExpiresAt: Date.now() / 1000 + 3600 })).toEqual({ outcome: "bound" });
		const order = await s.t.mutation(api.orders.create, { siteUrl: args.siteUrl, tenantId: args.tenantId, stripeConnectedAccountId: args.stripeConnectedAccountId,
			webhookSecret: secret, stripeSessionId: session, customerEmail: "buyer@example.invalid", items: [{ productName: "Print", quantity: 1, price: 4200 }], total: 4200,
			fulfillmentType: "lumaprints", shippingRecipientName: "Test Buyer", shippingAddress: { line1: "1 Test Street", city: "Detroit", state: "MI", postalCode: "48201", country: "US" },
			checkoutSnapshotReservation: { version: 2, handle: attempt }, runPrintJob: true });
		expect(order.lumaprintsConnection).toEqual(connection);
		expect(order.printJobId).toBeDefined();
	}
	const orders = await s.t.run(ctx => ctx.db.query("orders").take(3));
	expect(orders).toHaveLength(2);
	expect(orders[0].lumaprintsConnection?.connectionRef).not.toBe(orders[1].lumaprintsConnection?.connectionRef);
});

test("replay keeps its original supplier after current selection changes; new reservations use the new selection", async () => {
	const s = await fixture();
	const { args, connection, client } = await s.tenant(1);
	await s.t.mutation(internal.orders.reserveCheckoutSnapshot, args);
	const replacement = { ...connection, connectionRef: "lp_replacement_capture", storeId: 202 };
	await s.t.run(async ctx => {
		await ctx.db.insert("lumaprintsConnections", { ...replacement, clientId: client._id, storeVerifiedAt: Date.now(), accountOwnershipConfirmedAt: Date.now(), billingConfirmedAt: Date.now() });
		await ctx.db.patch(client._id, { lumaprintsConnectionRef: replacement.connectionRef });
	});
	expect(await s.t.mutation(internal.orders.reserveCheckoutSnapshot, args)).toEqual({ outcome: "replayed", lumaprintsConnection: connection });
	expect(await s.t.mutation(internal.orders.reserveCheckoutSnapshot, { ...args, handleHash: "b".repeat(64) })).toEqual({ outcome: "created", lumaprintsConnection: replacement });
});

test.each(["missing", "foreign", "dangling"])("%s supplier selection fails atomically without a reservation", async mode => {
	const s = await fixture();
	const a = await s.tenant(1);
	const b = await s.tenant(2);
	await s.t.run(ctx => ctx.db.patch(a.client._id, { lumaprintsConnectionRef: mode === "missing" ? undefined : mode === "foreign" ? b.connection.connectionRef : "lp_nonexistent_capture" }));
	await expect(s.t.mutation(internal.orders.reserveCheckoutSnapshot, a.args)).rejects.toThrow();
	expect(await s.t.run(ctx => ctx.db.query("checkoutSnapshotReservations").take(1))).toEqual([]);
});

test.each(["digital_download", "merchant"] as const)("%s retains protocol identity without requiring a supplier", async kind => {
	const s = await fixture();
	const { args, client } = await s.tenant(1, kind);
	await s.t.run(ctx => ctx.db.patch(client._id, { lumaprintsConnectionRef: undefined }));
	expect(await s.t.mutation(internal.orders.reserveCheckoutSnapshot, args)).toEqual({ outcome: "created", lumaprintsConnection: null });
	const row = await s.t.run(ctx => ctx.db.query("checkoutSnapshotReservations").unique());
	expect(row?.lumaprintsConnectionVersion).toBe(1);
	expect(row?.lumaprintsConnection).toBeUndefined();
	expect(await s.t.mutation(internal.orders.reserveCheckoutSnapshot, { ...args, lumaprintsConnectionVersion: undefined })).toEqual({ outcome: "conflict" });
});

test("mixed supplier and digital lines capture exactly one supplier while freezing every line", async () => {
	const s = await fixture();
	const a = await s.tenant(1);
	// Add a digital line to the same tenant using its real published graph.
	const created = await createGraph(s.adminA, a.args.siteUrl, "mixed-download", graphDraft("digital_download", s));
	const product = await s.t.run(ctx => ctx.db.get(created.productId));
	if (!product) throw new Error("Missing product");
	await s.adminA.mutation(api.catalogProductGraphs.publishDraft, { productId: created.productId, expectedDraftRevisionId: product.draftRevisionId ?? null, expectedPublishedRevisionId: null, expectedUpdatedAt: product.updatedAt });
	const snapshot = { ...a.args.snapshot, items: [...a.args.snapshot.items, { productKey: created.productId, revisionId: created.revisionId, productKind: "digital_download" as const, variantKey: "default", materialOptionKey: null, sizeOptionKey: null, borderOptionKey: null, frameOptionKey: null }] };
	expect(await s.t.mutation(internal.orders.reserveCheckoutSnapshot, { ...a.args, snapshot, snapshotDigest: await reservationSnapshotDigest(snapshot) })).toMatchObject({ lumaprintsConnection: a.connection });
	const row = await s.t.run(ctx => ctx.db.query("checkoutSnapshotReservations").unique());
	expect(row?.printInput?.lines.map(line => line.sources.length)).toEqual([1, 0]);
});

test("old reservations are not backfilled and protocol changes conflict in both directions", async () => {
	const s = await fixture();
	const { args } = await s.tenant(1);
	await s.t.mutation(internal.orders.reserveCheckoutSnapshot, { ...args, lumaprintsConnectionVersion: undefined });
	expect(await s.t.mutation(internal.orders.reserveCheckoutSnapshot, args)).toEqual({ outcome: "conflict" });
	const next = { ...args, handleHash: "c".repeat(64) };
	await s.t.mutation(internal.orders.reserveCheckoutSnapshot, next);
	expect(await s.t.mutation(internal.orders.reserveCheckoutSnapshot, { ...next, lumaprintsConnectionVersion: undefined })).toEqual({ outcome: "conflict" });
	const rows = await s.t.run(ctx => ctx.db.query("checkoutSnapshotReservations").take(3));
	expect(rows[0].lumaprintsConnection).toBeUndefined();
});

test("opt-in requires frozen input, stable tenant identity and a connected account", async () => {
	const s = await fixture();
	const { args } = await s.tenant(1);
	for (const key of ["printInputVersion", "tenantId", "stripeConnectedAccountId"] as const) {
		expect(await s.t.mutation(internal.orders.reserveCheckoutSnapshot, { ...args, [key]: undefined })).toEqual({ outcome: "invalid" });
	}
	expect(await s.t.run(ctx => ctx.db.query("checkoutSnapshotReservations").take(1))).toEqual([]);
});

test.each(["missing", "wrong-store", "wrong-tenant"])("a %s captured context cannot replay or consume as legacy central work", async failure => {
	const s = await fixture();
	const { args } = await s.tenant(1);
	await s.t.mutation(internal.orders.reserveCheckoutSnapshot, args);
	const row = await s.t.run(ctx => ctx.db.query("checkoutSnapshotReservations").unique());
	if (!row) throw new Error("Missing reservation");
	const saved = row.lumaprintsConnection;
	if (!saved) throw new Error("Missing saved supplier");
	await s.t.run(ctx => ctx.db.patch(row._id, { lumaprintsConnection: failure === "missing" ? undefined : failure === "wrong-store" ? { ...saved, storeId: 999 } : { ...saved, tenantId: "tenant_22222222-2222-4222-8222-222222222222" } }));
	const rejection = failure === "missing" ? "Captured supplier reservation is inconsistent"
		: failure === "wrong-store" ? "LumaPrints connection does not match saved ownership"
		: "LumaPrints connection tenant does not match order";
	await expect(s.t.mutation(internal.orders.reserveCheckoutSnapshot, args)).rejects.toThrow(rejection);
	const session = "cs_test_missingsuppliercapture";
	expect(await s.t.mutation(internal.orders.bindCheckoutSnapshot, { siteUrl: args.siteUrl, tenantId: args.tenantId, handleHash: args.handleHash, stripeConnectedAccountId: args.stripeConnectedAccountId, stripeSessionId: session, stripeExpiresAt: Date.now() / 1000 + 3600 })).toEqual({ outcome: "bound" });
	await expect(s.t.mutation(api.orders.create, { siteUrl: args.siteUrl, tenantId: args.tenantId, stripeConnectedAccountId: args.stripeConnectedAccountId, webhookSecret: secret, stripeSessionId: session, customerEmail: "buyer@example.invalid", items: [{ productName: "Print", quantity: 1, price: 4200 }], total: 4200, fulfillmentType: "lumaprints", shippingRecipientName: "Test Buyer", shippingAddress: { line1: "1 Test Street", city: "Detroit", state: "MI", postalCode: "48201", country: "US" }, checkoutSnapshotReservation: { version: 2, handle: attempt } })).rejects.toThrow(rejection);
	expect(await s.t.run(ctx => ctx.db.query("orders").take(1))).toEqual([]);
});

test("authenticated HTTP opt-in returns saved context while old requests keep the exact version-two envelope", async () => {
	const s = await fixture();
	const { args, connection } = await s.tenant(1);
	vi.stubEnv("CHECKOUT_SNAPSHOT_RESERVATION_SECRETS", JSON.stringify({ [args.siteUrl]: [credential] }));
	vi.stubEnv("CHECKOUT_ROLE_CREDENTIAL_FINGERPRINTS", JSON.stringify({ checkoutBridge: ["a".repeat(64)], checkoutSnapshotReservation: [await serverSecretFingerprint(credential)] }));
	const body = { version: 1, site: args.siteUrl, tenantId: args.tenantId, attempt, account: args.stripeConnectedAccountId, snapshot: args.snapshot, printInputVersion: 1, lumaprintsConnectionVersion: 1 };
	const send = (data: unknown, token = credential) => s.t.fetch("/commerce/checkout-snapshots/reserve", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(data) });
	expect((await send(body, "wrong-credential")).status).toBe(401);
	const response = await send(body);
	expect(response.status).toBe(200);
	expect(await response.json()).toEqual({ version: 3, handle: expect.any(String), replayed: false, lumaprintsConnection: connection });
	const { lumaprintsConnectionVersion: _version, ...old } = body;
	const legacy = await send({ ...old, attempt: "123e4567-e89b-42d3-a456-426614174001" });
	expect(await legacy.json()).toEqual({ version: 2, handle: expect.any(String), replayed: false });
	for (const invalid of [{ ...body, lumaprintsConnection: connection }, { ...body, account: null }, { ...body, printInputVersion: undefined }, { ...body, lumaprintsConnectionVersion: 2 }]) {
		expect(parseReservationRequest(invalid)).toBeNull();
		expect((await send(invalid)).status).toBe(400);
	}
});


test("concurrent reservations agree on one captured supplier and retain one row", async () => {
	const s = await fixture();
	const { args, connection } = await s.tenant(1);
	const results = await Promise.all([s.t.mutation(internal.orders.reserveCheckoutSnapshot, args), s.t.mutation(internal.orders.reserveCheckoutSnapshot, args)]);
	expect(results.map(result => result.outcome).sort()).toEqual(["created", "replayed"]);
	for (const result of results) expect(result).toMatchObject({ lumaprintsConnection: connection });
	expect(await s.t.run(ctx => ctx.db.query("checkoutSnapshotReservations").take(2))).toHaveLength(1);
});
