/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import { requireClientPaymentReady } from "./helpers/clientPaymentReadiness";
import { reservationHandleHash } from "./helpers/checkoutSnapshot";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const SECRET = "client-payment-secret-0123456789abcdef";
const PLATFORM = "acct_platform1234567890";
const ACCOUNT = "acct_clientA1234567890";
const OTHER_ACCOUNT = "acct_clientB1234567890";
const ready = { status: "ready" as const, chargesEnabled: true, payoutsEnabled: true, detailsSubmitted: true };

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-21T12:00:00Z")); vi.stubEnv("WEBHOOK_SECRET", SECRET); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

async function setup() {
	const t = convexTest(schema, modules);
	await t.run(ctx => ctx.db.insert("platformClients", {
		name: "Creator", siteUrl: "angelsrest.online", email: "creator@example.invalid", role: "creator",
		adminEmails: ["creator@example.invalid"], tier: "full", subscriptionStatus: "active",
	}));
	const creator = t.withIdentity({ subject: "creator", email: "creator@example.invalid", emailVerified: true });
	const add = async (siteUrl: string, accountId: string) => {
		const clientId = await creator.mutation(api.platform.createClient, {
			name: "Client", siteUrl, email: "owner@example.invalid", adminEmails: ["owner@example.invalid"],
			role: "client", tier: "full", subscriptionStatus: "active",
		});
		const args = { clientId, platformAccountId: PLATFORM, livemode: false, webhookSecret: SECRET };
		const creation = await creator.mutation(api.platform.beginStripeConnectAccount, args);
		await creator.mutation(api.platform.bindStripeConnectAccount, { ...args, attemptId: creation.attempt.id, stripeConnectedAccountId: accountId });
		return { clientId, args: { ...args, accountId }, identity: { siteUrl, tenantId: creation.tenantId, accountId } };
	};
	const first = await add("client.example", ACCOUNT);
	const second = await add("other.example", OTHER_ACCOUNT);
	const begin = () => t.mutation(api.platform.beginStripeConnectStatusRefresh, first.args);
	const observe = async (readiness = ready) => {
		const claim = await begin();
		if (claim.kind !== "checking") throw new Error("Expected status claim");
		await t.mutation(api.platform.finishStripeConnectStatusRefresh, { ...first.args, refreshToken: claim.refreshToken,
			result: { kind: "observed", readiness } });
	};
	const target = () => t.query(api.platform.getClientPaymentTarget, { ...first.identity, webhookSecret: SECRET });
	const authorize = () => t.run(ctx => requireClientPaymentReady(ctx, first.identity));
	return { t, creator, first, second, begin, observe, target, authorize };
}

describe("client payment readiness authority", () => {
	test("requires hub authority, even when the caller has a creator session", async () => {
		const s = await setup();
		for (const caller of [s.t, s.creator]) {
			await expect(caller.query(api.platform.getClientPaymentTarget, { ...s.first.identity, webhookSecret: "wrong" })).rejects.toThrow("secret mismatch");
		}
		expect(await s.target()).toMatchObject({ target: { tenantId: s.first.identity.tenantId, stripeConnectedAccountId: ACCOUNT }, status: null });
	});

	test("rejects tenant, domain and account substitution before returning a target", async () => {
		const s = await setup();
		for (const changed of [
			{ tenantId: s.second.identity.tenantId }, { siteUrl: s.second.identity.siteUrl },
			{ accountId: OTHER_ACCOUNT }, { siteUrl: "unknown.example" }, { accountId: "acct_bad" },
		]) await expect(s.t.query(api.platform.getClientPaymentTarget, { ...s.first.identity, ...changed, webhookSecret: SECRET })).rejects.toThrow();
	});

	test("returns current status without refresh authority and authorizes only completed readiness", async () => {
		const s = await setup();
		const claim = await s.begin();
		expect(claim.kind).toBe("checking");
		const pending = await s.target();
		expect(pending.status?.state).toEqual({ kind: "checking", startedAt: Date.now() });
		expect(JSON.stringify(pending)).not.toContain("refreshToken");
		await expect(s.authorize()).rejects.toThrow("readiness is unavailable");
		await s.observe();
		expect((await s.authorize()).client._id).toBe(s.first.clientId);
	});

	test("missing, restricted, unavailable and disconnected states never authorize a payment", async () => {
		const s = await setup();
		await expect(s.authorize()).rejects.toThrow("readiness is unavailable");
		for (const status of ["setup_required", "pending_verification", "restricted"] as const) {
			const claim = await s.begin();
			if (claim.kind !== "checking") throw new Error("Expected claim");
			await s.t.mutation(api.platform.finishStripeConnectStatusRefresh, { ...s.first.args, refreshToken: claim.refreshToken,
				result: { kind: "observed", readiness: { ...ready, status, chargesEnabled: false, payoutsEnabled: false } } });
			await expect(s.authorize()).rejects.toThrow("readiness is unavailable");
		}
		const claim = await s.begin();
		if (claim.kind !== "checking") throw new Error("Expected claim");
		await s.t.mutation(api.platform.finishStripeConnectStatusRefresh, { ...s.first.args, refreshToken: claim.refreshToken,
			result: { kind: "unavailable", reason: "provider_unavailable" } });
		await expect(s.authorize()).rejects.toThrow("readiness is unavailable");
		await s.t.mutation(api.platform.markStripeConnectDisconnected, { ...s.first.args, eventId: "evt_disconnected1" });
		await expect(s.authorize()).rejects.toThrow("readiness is unavailable");
		expect(await s.t.query(api.platform.getByStripeConnectedAccountId, { stripeConnectedAccountId: ACCOUNT, webhookSecret: SECRET })).toMatchObject({ _id: s.first.clientId });
	});

	test("expires observed readiness and rejects future timestamps", async () => {
		const s = await setup(); await s.observe();
		const now = Date.now();
		vi.setSystemTime(now + 59_999); await s.authorize();
		vi.setSystemTime(now + 60_000);
		await expect(s.authorize()).rejects.toThrow("stale");
		vi.setSystemTime(now - 1);
		await expect(s.authorize()).rejects.toThrow("stale");
	});

	test("resolves verified domain aliases and full-URL records without changing account ownership", async () => {
		const s = await setup(); await s.observe();
		await s.t.run(ctx => ctx.db.patch(s.first.clientId, { siteUrl: "https://www.renamed.example/" }));
		expect((await s.target()).target).toMatchObject({ siteUrl: "client.example", stripeConnectedAccountId: ACCOUNT });
		expect(await s.t.query(api.platform.getStripeAccountForSite, { siteUrl: "client.example" })).toMatchObject({ tenantId: s.first.identity.tenantId, stripeConnectedAccountId: ACCOUNT });
		await s.authorize();
	});

	test("refuses lost current selection and missing immutable ownership despite previously ready status", async () => {
		const s = await setup(); await s.observe();
		await s.t.run(ctx => ctx.db.patch(s.first.clientId, { stripeConnectedAccountId: undefined }));
		await expect(s.target()).rejects.toThrow("current verified");
		await s.t.run(async ctx => {
			await ctx.db.patch(s.first.clientId, { stripeConnectedAccountId: ACCOUNT });
			const binding = await ctx.db.query("stripeAccountBindings").withIndex("by_stripeConnectedAccountId", q => q.eq("stripeConnectedAccountId", ACCOUNT)).unique();
			if (!binding) throw new Error("Missing fixture binding");
			await ctx.db.delete(binding._id);
		});
		await expect(s.target()).rejects.toThrow("current verified");
	});
});


async function admissionFixture(print = false) {
	const s = await setup(); await s.observe();
	const { siteUrl, tenantId, accountId } = s.first.identity;
	const digest = (n: number) => String(n).repeat(64);
	const args = { siteUrl, tenantId, stripeConnectedAccountId: accountId, attemptDigest: digest(1), proofClass: "signed_bridge_body" as const,
		admissionHandleHash: digest(2), requestFingerprint: digest(3), activeLeaseTokenHash: digest(4), hostGeneration: 1 };
	const supplier = { version: 1 as const, connectionRef: "lp_readiness_client", tenantId, storeId: 101, environment: "sandbox" as const };
	vi.stubEnv("ORDER_PRODUCERS_STATE", "open");
	const activate = async (purpose: "new_order_admission" | "new_provider_submission", state: "open" | "closed" = "open", generation = 1) => {
		vi.stubEnv(purpose === "new_order_admission" ? "NEW_ORDER_ADMISSION_CONTROL" : "NEW_PROVIDER_SUBMISSION_CONTROL",
			JSON.stringify({ version: 2, tenants: [{ siteUrl, tenantId, state, generation }] }));
		return s.t.mutation(internal.commerceClosure.activatePurposeControl, { siteUrl, purpose, state, generation,
			...(purpose === "new_order_admission" ? { acceptedHostGeneration: generation } : {}) });
	};
	await activate("new_order_admission");
	const source = { descriptor: { key: "synthetic-artwork", hash: "a".repeat(64), bytes: 12, mime: "image/jpeg" as const, dimensions: { width: 1000, height: 1000 } },
		item: { paperSubcategoryId: 103001, width: 8, height: 10 }, product: { subcategoryId: 103001, orderItemOptions: [] } };
	const reservationId = await s.t.run(async ctx => {
		if (print) {
			await ctx.db.insert("lumaprintsConnections", { ...supplier, clientId: s.first.clientId, storeVerifiedAt: Date.now(), accountOwnershipConfirmedAt: Date.now(), billingConfirmedAt: Date.now() });
			await ctx.db.patch(s.first.clientId, { lumaprintsConnectionRef: supplier.connectionRef });
		}
		return ctx.db.insert("checkoutSnapshotReservations", { siteUrl, tenantId, state: "reserved", handleHash: digest(5), snapshotDigest: digest(6),
			accountScope: `connected:${accountId}`, stripeConnectedAccountId: accountId,
			snapshot: { schemaVersion: 1, catalogProvider: "convex", items: [{ productKey: "product", revisionId: "revision", productKind: print ? "print" : "digital_download", variantKey: "default", materialOptionKey: null, sizeOptionKey: null, borderOptionKey: null, frameOptionKey: null }] },
			printInput: { version: 1, lines: [{ amountCents: 4200, sources: print ? [source] : [] }] }, lumaprintsConnectionVersion: 1,
			...(print ? { lumaprintsConnection: supplier } : {}), createdAt: Date.now(), updatedAt: Date.now(), unboundPurgeAt: Date.now() + 86400000 });
	});
	const admitted = await s.t.mutation(internal.commerceClosure.beginCheckoutSessionAdmission, args);
	const creating = { siteUrl, admissionId: admitted.admissionId, activeLeaseTokenHash: args.activeLeaseTokenHash,
		requestFingerprint: args.requestFingerprint, stripeIdempotencyDigest: digest(7), checkoutSnapshotHandleHash: digest(5),
		financialIntent: { version: 1 as const, currency: "usd" as const, lines: [{ unitPriceCents: 4200, quantity: 1 }], applicationFeeAmountCents: print ? 210 : 0 } };
	const create = () => s.t.mutation(internal.commerceClosure.markCheckoutSessionCreating, creating);
	return { ...s, args, activate, admitted, creating, create, reservationId, supplier };
}

describe("first client checkout creation", () => {
	test("digital checkout requires captured identity but no supplier or provider admission", async () => {
		const s = await admissionFixture();
		await expect(s.create()).resolves.toMatchObject({ state: "creating" });
		const row = await s.t.run(ctx => ctx.db.get(s.admitted.admissionId));
		expect(row?.checkoutSnapshotHandleHash).toBe(s.creating.checkoutSnapshotHandleHash);
	});

	test.each(["missing", "foreign-tenant", "foreign-account", "legacy", "wrong-handle", "inconsistent"])("rejects %s fulfillment before entering Stripe creation", async failure => {
		const s = await admissionFixture();
		await s.t.run(async ctx => {
			if (failure === "missing") await ctx.db.delete(s.reservationId);
			if (failure === "foreign-tenant") await ctx.db.patch(s.reservationId, { tenantId: s.second.identity.tenantId });
			if (failure === "foreign-account") await ctx.db.patch(s.reservationId, { stripeConnectedAccountId: OTHER_ACCOUNT });
			if (failure === "legacy") await ctx.db.patch(s.reservationId, { lumaprintsConnectionVersion: undefined });
			if (failure === "inconsistent") await ctx.db.patch(s.reservationId, { lumaprintsConnection: s.supplier });
		});
		if (failure === "wrong-handle") s.creating.checkoutSnapshotHandleHash = "9".repeat(64);
		await expect(s.create()).rejects.toThrow(/captured fulfillment/);
		expect((await s.t.run(ctx => ctx.db.get(s.admitted.admissionId)))?.state).toBe("active_prestripe");
	});

	test.each(["stale", "restricted", "disconnected", "checking", "detached"])("rechecks %s payment readiness atomically after admission", async failure => {
		const s = await admissionFixture();
		if (failure === "stale") vi.setSystemTime(Date.now() + 60000);
		if (failure === "restricted") {
			const claim = await s.begin(); if (claim.kind !== "checking") throw new Error("Missing claim");
			await s.t.mutation(api.platform.finishStripeConnectStatusRefresh, { ...s.first.args, refreshToken: claim.refreshToken, result: { kind: "observed", readiness: { ...ready, status: "restricted", chargesEnabled: false } } });
		}
		if (failure === "disconnected") await s.t.mutation(api.platform.markStripeConnectDisconnected, { ...s.first.args, eventId: "evt_disconnect" });
		if (failure === "checking") await s.begin();
		if (failure === "detached") await s.t.run(ctx => ctx.db.patch(s.first.clientId, { stripeConnectedAccountId: undefined }));
		await expect(s.create()).rejects.toThrow();
		expect((await s.t.run(ctx => ctx.db.get(s.admitted.admissionId)))?.state).toBe("active_prestripe");
	});

	test.each(["closed", "unactivated", "replaced", "wrong-mode", "foreign-control"])("refuses %s supplier before new print payments", async failure => {
		const s = await admissionFixture(true);
		if (failure !== "unactivated") await s.activate("new_provider_submission", failure === "closed" ? "closed" : "open");
		if (failure === "replaced") await s.t.run(ctx => ctx.db.patch(s.first.clientId, { lumaprintsConnectionRef: undefined }));
		if (failure === "wrong-mode") await s.t.run(ctx => ctx.db.patch(s.reservationId, { lumaprintsConnection: { ...s.supplier, environment: "production" } }));
		if (failure === "foreign-control") await s.t.run(async ctx => { const control = await ctx.db.query("commercePurposeControls").withIndex("by_siteUrl_and_purpose", q => q.eq("siteUrl", s.args.siteUrl).eq("purpose", "new_provider_submission")).unique(); if (control) await ctx.db.patch(control._id, { tenantId: s.second.identity.tenantId }); });
		await expect(s.create()).rejects.toThrow();
		expect((await s.t.run(ctx => ctx.db.get(s.admitted.admissionId)))?.state).toBe("active_prestripe");
	});

	test("mixed print/digital creation is idempotent and uncertain recovery survives later provider closure and disconnection", async () => {
		const s = await admissionFixture(true); await s.activate("new_provider_submission");
		await s.t.run(async ctx => { const r = await ctx.db.get(s.reservationId); if (!r?.printInput) throw new Error("Missing print input"); await ctx.db.patch(r._id, { snapshot: { ...r.snapshot, items: [...r.snapshot.items, { ...r.snapshot.items[0]!, productKey: "digital", productKind: "digital_download" }] }, printInput: { version: 1, lines: [...r.printInput.lines, { amountCents: 1000, sources: [] }] } }); });
		s.creating.financialIntent.lines.push({ unitPriceCents: 1000, quantity: 1 });
		const [one, two] = await Promise.all([s.create(), s.create()]); expect(one).toEqual(two);
		await s.t.mutation(internal.commerceClosure.markCheckoutSessionCreationUncertain, { siteUrl: s.args.siteUrl, admissionId: s.admitted.admissionId, requestFingerprint: s.creating.requestFingerprint, stripeIdempotencyDigest: s.creating.stripeIdempotencyDigest });
		await s.activate("new_provider_submission", "closed", 2); await s.activate("new_order_admission", "closed", 2);
		await s.t.mutation(api.platform.markStripeConnectDisconnected, { ...s.first.args, eventId: "evt_disconnect" });
		await expect(s.create()).resolves.toMatchObject({ state: "creation_uncertain", requestedStripeExpiresAt: one.requestedStripeExpiresAt });
		await expect(s.t.mutation(internal.commerceClosure.markCheckoutSessionCreating, { ...s.creating, checkoutSnapshotHandleHash: "9".repeat(64) })).rejects.toThrow();
		expect(await s.t.mutation(internal.commerceClosure.releaseCheckoutSessionAdmission, { siteUrl: s.args.siteUrl, admissionId: s.admitted.admissionId, activeLeaseTokenHash: s.creating.activeLeaseTokenHash })).toBe(false);
	});

	test("a retained domain still admits its own connected account after a full-URL rename", async () => {
		const s = await admissionFixture();
		await s.t.run(ctx => ctx.db.patch(s.first.clientId, { siteUrl: "https://www.renamed.example/" }));
		await expect(s.create()).resolves.toMatchObject({ state: "creating" });
		await expect(s.t.mutation(internal.commerceClosure.beginCheckoutSessionAdmission, { ...s.args, attemptDigest: "8".repeat(64), stripeConnectedAccountId: OTHER_ACCOUNT })).rejects.toThrow();
	});

	test("two clients create only against their own payment and captured fulfillment identities", async () => {
		const s = await admissionFixture(); await s.create();
		const second = s.second;
		const claim = await s.t.mutation(api.platform.beginStripeConnectStatusRefresh, second.args);
		if (claim.kind !== "checking") throw new Error("Missing claim");
		await s.t.mutation(api.platform.finishStripeConnectStatusRefresh, { ...second.args, refreshToken: claim.refreshToken, result: { kind: "observed", readiness: ready } });
		vi.stubEnv("NEW_ORDER_ADMISSION_CONTROL", JSON.stringify({ version: 2, tenants: [{ siteUrl: second.identity.siteUrl, tenantId: second.identity.tenantId, state: "open", generation: 1 }] }));
		await s.t.mutation(internal.commerceClosure.activatePurposeControl, { siteUrl: second.identity.siteUrl, purpose: "new_order_admission", state: "open", generation: 1, acceptedHostGeneration: 1 });
		await s.t.run(async ctx => {
			const saved = await ctx.db.get(s.reservationId); if (!saved) throw new Error("Missing reservation");
			const { _id, _creationTime, ...reservation } = saved;
			await ctx.db.insert("checkoutSnapshotReservations", { ...reservation, siteUrl: second.identity.siteUrl, tenantId: second.identity.tenantId, stripeConnectedAccountId: OTHER_ACCOUNT, accountScope: `connected:${OTHER_ACCOUNT}` });
		});
		const admitted = await s.t.mutation(internal.commerceClosure.beginCheckoutSessionAdmission, { ...s.args, siteUrl: second.identity.siteUrl, tenantId: second.identity.tenantId, stripeConnectedAccountId: OTHER_ACCOUNT });
		const creating = { ...s.creating, siteUrl: second.identity.siteUrl, admissionId: admitted.admissionId };
		await expect(s.t.mutation(internal.commerceClosure.markCheckoutSessionCreating, { ...creating, siteUrl: s.first.identity.siteUrl })).rejects.toThrow("unavailable");
		await expect(s.t.mutation(internal.commerceClosure.markCheckoutSessionCreating, creating)).resolves.toMatchObject({ state: "creating" });
		expect(admitted.admissionId).not.toBe(s.admitted.admissionId);
	});

	test("an unconnected client cannot start a platform-account admission", async () => {
		const s = await admissionFixture();
		await expect(s.t.mutation(internal.commerceClosure.beginCheckoutSessionAdmission, { ...s.args, attemptDigest: "8".repeat(64), stripeConnectedAccountId: undefined })).rejects.toThrow();
	});
});

describe("original client checkout financial evidence", () => {
	test("atomically freezes the original expected amounts and leaves provider collection unknown", async () => {
		const s = await admissionFixture(true); await s.activate("new_provider_submission");
		s.creating.financialIntent.lines[0]!.quantity = 2;
		s.creating.financialIntent.applicationFeeAmountCents = 420;
		const [one, two] = await Promise.all([s.create(), s.create()]);
		expect(one).toEqual(two);
		expect(one).toMatchObject({ financialCaptureVersion: 1 });
		const saved = await s.t.run(ctx => ctx.db.get(s.admitted.admissionId));
		expect(saved?.checkoutFinancialSnapshot).toEqual({
			version: 1, policy: "print_subtotal_5pct_floor_v1", tenantId: s.first.identity.tenantId,
			stripePlatformAccountId: PLATFORM, stripeConnectedAccountId: ACCOUNT, stripeLivemode: false,
			currency: "usd", lines: [{ productKind: "print", unitPriceCents: 4200, quantity: 2 }],
			subtotalCents: 8400, printSubtotalCents: 8400, applicationFeeAmountCents: 420,
		});
		expect(saved?.checkoutFinancialSnapshot).not.toHaveProperty("applicationFeeId");
		await s.t.run(ctx => ctx.db.patch(s.reservationId, { printInput: { version: 1, lines: [{ amountCents: 9999, sources: [] }] } }));
		await expect(s.create()).resolves.toMatchObject({ financialCaptureVersion: 1 });
		expect((await s.t.run(ctx => ctx.db.get(s.admitted.admissionId)))?.checkoutFinancialSnapshot).toEqual(saved?.checkoutFinancialSnapshot);
	});

	test.each(["missing", "price", "quantity", "fee"])("rejects %s financial intent before entering provider creation", async failure => {
		const s = await admissionFixture(true); await s.activate("new_provider_submission");
		const financialIntent = failure === "missing" ? undefined : {
			...s.creating.financialIntent,
			...(failure === "price" ? { lines: [{ unitPriceCents: 4199, quantity: 1 }] } : {}),
			...(failure === "quantity" ? { lines: [{ unitPriceCents: 4200, quantity: 0 }] } : {}),
			...(failure === "fee" ? { applicationFeeAmountCents: 209 } : {}),
		};
		await expect(s.t.mutation(internal.commerceClosure.markCheckoutSessionCreating, { ...s.creating, financialIntent })).rejects.toThrow();
		const saved = await s.t.run(ctx => ctx.db.get(s.admitted.admissionId));
		expect(saved?.state).toBe("active_prestripe");
		expect(saved?.checkoutFinancialSnapshot).toBeUndefined();
	});

	test("a changed replay cannot replace the captured quantities or fee", async () => {
		const s = await admissionFixture(true); await s.activate("new_provider_submission"); await s.create();
		const saved = await s.t.run(ctx => ctx.db.get(s.admitted.admissionId));
		s.creating.financialIntent.lines[0]!.quantity = 2;
		s.creating.financialIntent.applicationFeeAmountCents = 420;
		await expect(s.create()).rejects.toThrow("financial replay");
		expect((await s.t.run(ctx => ctx.db.get(s.admitted.admissionId)))?.checkoutFinancialSnapshot).toEqual(saved?.checkoutFinancialSnapshot);
	});

	test.each(["creating", "creation_uncertain", "bound"] as const)("preserves historical %s replay without inventing a fee record", async state => {
		const s = await admissionFixture();
		await s.t.run(ctx => ctx.db.patch(s.admitted.admissionId, { state, stripeIdempotencyDigest: s.creating.stripeIdempotencyDigest,
			requestedStripeExpiresAt: Math.floor(Date.now() / 1000) + 86100, checkoutSnapshotHandleHash: s.creating.checkoutSnapshotHandleHash }));
		await expect(s.create()).resolves.toMatchObject({ state, financialCaptureVersion: 0 });
		const { financialIntent: _, ...legacyRequest } = s.creating;
		expect(await s.t.mutation(internal.commerceClosure.markCheckoutSessionCreating, legacyRequest)).not.toHaveProperty("financialCaptureVersion");
		expect((await s.t.run(ctx => ctx.db.get(s.admitted.admissionId)))?.checkoutFinancialSnapshot).toBeUndefined();
	});

	test("transfers the original financial snapshot only to its matching paid order", async () => {
		const s = await admissionFixture();
		const handle = "123e4567-e89b-42d3-a456-426614174000";
		const hash = await reservationHandleHash(s.args.siteUrl, handle);
		await s.t.run(async ctx => {
			const reservation = await ctx.db.get(s.reservationId);
			if (!reservation) throw new Error("Missing reservation");
			await ctx.db.patch(s.reservationId, { handleHash: hash, snapshot: { ...reservation.snapshot, items: reservation.snapshot.items.map(item => ({ ...item, productKind: "print" as const })) } });
		});
		s.creating.financialIntent.applicationFeeAmountCents = 210;
		s.creating.checkoutSnapshotHandleHash = hash;
		const creating = await s.create();
		const session = "cs_test_financial1234567890";
		await s.t.mutation(internal.commerceClosure.bindCheckoutSessionAdmission, {
			siteUrl: s.args.siteUrl, admissionId: s.admitted.admissionId, requestFingerprint: s.creating.requestFingerprint,
			stripeIdempotencyDigest: s.creating.stripeIdempotencyDigest, stripeSessionId: session,
			stripeExpiresAt: creating.requestedStripeExpiresAt, checkoutSnapshotHandleHash: hash,
		});
		const payload = { webhookSecret: SECRET, tenantId: s.first.identity.tenantId, siteUrl: s.args.siteUrl,
			stripeConnectedAccountId: ACCOUNT, stripeSessionId: session, stripePaymentIntentId: "pi_financial1234567890",
			stripePaymentCurrency: "usd", stripePaymentLivemode: false,
			checkoutSessionAdmission: { version: 1, handleHash: s.args.admissionHandleHash },
			checkoutSnapshotReservation: { version: 2, handle }, customerEmail: "buyer@example.invalid",
			items: [{ productName: "Merchant print", quantity: 1, price: 4200 }], subtotal: 4200, total: 4200,
			fulfillmentType: "self" as const };
		for (const changed of [{ stripePaymentLivemode: true }, { stripePaymentCurrency: "eur" },
			{ subtotal: 4201 }, { items: [{ productName: "Merchant print", quantity: 2, price: 4200 }] },
			{ checkoutSnapshotReservation: undefined }, { stripePaymentIntentId: undefined }]) {
			await expect(s.t.mutation(api.orders.create, { ...payload, ...changed })).rejects.toThrow();
			expect((await s.t.run(ctx => ctx.db.get(s.admitted.admissionId)))?.state).toBe("bound");
		}
		await s.t.mutation(api.platform.markStripeConnectDisconnected, { ...s.first.args, eventId: "evt_disconnectFinancial" });
		const created = await s.t.mutation(api.orders.create, payload);
		const admission = await s.t.run(ctx => ctx.db.get(s.admitted.admissionId));
		const order = await s.t.run(ctx => ctx.db.get(created._id));
		expect(order?.checkoutFinancialSnapshot).toEqual(admission?.checkoutFinancialSnapshot);
		expect(order?.checkoutFinancialSnapshot?.applicationFeeAmountCents).toBe(210);
		expect(order?.stripePaymentIntentId).toBe(payload.stripePaymentIntentId);
		await expect(s.t.mutation(api.orders.create, payload)).resolves.toMatchObject({ alreadyExisted: true });
		await expect(s.t.mutation(api.orders.updateStatus, { orderId: created._id, webhookSecret: SECRET,
			stripePaymentIntentId: "pi_replacement1234567890" })).rejects.toThrow("immutable");
	});
});
