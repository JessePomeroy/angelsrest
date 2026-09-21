/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { serverSecretFingerprint } from "./helpers/serverSecrets";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const SITE = "third.example";
const TENANT = "tenant_05eb6092-5d8c-43ce-ad26-1a59522bd07b";
const OTHER_TENANT = "tenant_05eb6092-5d8c-43ce-ad26-1a59522bd07c";
const SECRET = "client-admission-webhook-0123456789abcdef";
const AUTHORITY = "client-admission-authority-0123456789abcd";
const OTHER_AUTHORITY = "other-admission-authority-0123456789abcd";
const D1 = "1".repeat(64), D2 = "2".repeat(64), D3 = "3".repeat(64), D4 = "4".repeat(64);
type Backend = ReturnType<typeof convexTest>;

beforeEach(async () => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date("2026-09-21T12:00:00Z"));
	vi.stubEnv("WEBHOOK_SECRET", SECRET);
	vi.stubEnv("ORDER_PRODUCERS_STATE", "open");
	vi.stubEnv("SITE_URL", "https://www.angelsrest.online");
	vi.stubEnv("BETTER_AUTH_SECRET", "client-admission-auth-0123456789abcdef");
	vi.stubEnv("CHECKOUT_SNAPSHOT_RESERVATION_SECRETS", JSON.stringify({
		[SITE]: [AUTHORITY], "fourth.example": [OTHER_AUTHORITY],
	}));
	vi.stubEnv("CHECKOUT_ROLE_CREDENTIAL_FINGERPRINTS", JSON.stringify({
		checkoutBridge: [await serverSecretFingerprint("client-admission-bridge-0123456789abcdef")],
		checkoutSnapshotReservation: await Promise.all([AUTHORITY, OTHER_AUTHORITY].map(serverSecretFingerprint)),
	}));
});

afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

async function seed(t: Backend, siteUrl = SITE, tenantId = TENANT) {
	return t.run(ctx => ctx.db.insert("platformClients", {
		tenantId, siteUrl, name: "Test client", email: "owner@example.com",
		tier: "full", subscriptionStatus: "active", adminEmails: ["owner@example.com"],
	}));
}

function intent(state: "open" | "closed" = "open", generation = 1, tenantId = TENANT, siteUrl = SITE) {
	return JSON.stringify({ version: 2, tenants: [{ siteUrl, tenantId, state, generation }] });
}

async function activate(t: Backend, state: "open" | "closed" = "open", generation = 1,
	tenantId = TENANT, siteUrl = SITE, purpose: "new_order_admission" | "new_provider_submission" = "new_order_admission") {
	vi.stubEnv(purpose === "new_order_admission" ? "NEW_ORDER_ADMISSION_CONTROL" : "NEW_PROVIDER_SUBMISSION_CONTROL",
		intent(state, generation, tenantId, siteUrl));
	return t.mutation(internal.commerceClosure.activatePurposeControl, {
		siteUrl, purpose, state, generation,
		...(purpose === "new_order_admission" ? { acceptedHostGeneration: generation } : {}),
	});
}

const begin = (tenantId: string | undefined = TENANT) => ({
	siteUrl: SITE, ...(tenantId ? { tenantId } : {}), attemptDigest: D1,
	proofClass: "signed_bridge_body" as const, admissionHandleHash: D2,
	requestFingerprint: D3, activeLeaseTokenHash: D4, hostGeneration: 1,
});

const create = (admissionId: Id<"checkoutSessionAdmissions">) => ({
	siteUrl: SITE, admissionId, activeLeaseTokenHash: D4,
	requestFingerprint: D3, stripeIdempotencyDigest: D1,
});

describe("explicit client commerce admission", () => {
	test("a registered client stays closed until exact environment intent is activated", async () => {
		const t = convexTest(schema, modules);
		await seed(t);
		vi.stubEnv("NEW_ORDER_ADMISSION_CONTROL", intent());
		await expect(t.mutation(internal.commerceClosure.beginCheckoutSessionAdmission, begin())).rejects.toThrow("New order admission is closed");
		expect(await activate(t)).toMatchObject({ outcome: "created" });
		expect(await activate(t)).toMatchObject({ outcome: "replayed" });
		expect(await t.mutation(internal.commerceClosure.beginCheckoutSessionAdmission, begin())).toMatchObject({ state: "active_prestripe" });
		expect(await t.run(ctx => ctx.db.query("commercePurposeControls").withIndex("by_siteUrl_and_purpose", q => q.eq("siteUrl", SITE).eq("purpose", "new_order_admission")).unique())).toMatchObject({ tenantId: TENANT });
	});

	test("opening rejects unknown or foreign ownership, but closing survives missing registration", async () => {
		const t = convexTest(schema, modules);
		await expect(activate(t)).rejects.toThrow("registered tenant identity");
		await expect(activate(t, "closed")).rejects.toThrow("registered tenant identity");
		const clientId = await seed(t);
		await seed(t, "fourth.example", OTHER_TENANT);
		await expect(activate(t, "open", 1, OTHER_TENANT)).rejects.toThrow("registered tenant identity");
		await activate(t);
		await t.run(ctx => ctx.db.delete(clientId));
		expect(await activate(t, "closed", 2)).toMatchObject({ outcome: "advanced" });
		await expect(activate(t, "open", 3)).rejects.toThrow("registered tenant identity");
	});

	test("a canonical control resolves verified aliases and concurrent activation is idempotent", async () => {
		const t = convexTest(schema, modules);
		await seed(t, "https://www.third.example/");
		await t.run(ctx => ctx.db.insert("tenantAliases", {
			tenantId: TENANT, kind: "domain", value: SITE, verifiedAt: Date.now(), verificationMethod: "operator",
		}));
		const outcomes = await Promise.all([activate(t), activate(t)]);
		expect(outcomes.map(result => result.outcome).sort()).toEqual(["created", "replayed"]);
		await expect(t.mutation(internal.commerceClosure.beginCheckoutSessionAdmission, { ...begin(), hostGeneration: 2 })).rejects.toThrow("closed");
	});

	test("fresh reservations require the pinned tenant, while existing reservation replay survives closure", async () => {
		const t = convexTest(schema, modules); await seed(t); await activate(t);
		const args = {
			siteUrl: SITE, handleHash: D1, snapshotDigest: D2,
			snapshot: { schemaVersion: 1 as const, catalogProvider: "convex" as const, items: [{
				productKey: "product-1", revisionId: "revision-1", productKind: "print" as const,
				variantKey: "variant-1", materialOptionKey: null, sizeOptionKey: null,
				borderOptionKey: null, frameOptionKey: null,
			}] },
		};
		await expect(t.mutation(internal.orders.reserveCheckoutSnapshot, args)).rejects.toThrow("reservation identity does not match activated tenant");
		expect(await t.mutation(internal.orders.reserveCheckoutSnapshot, { ...args, tenantId: TENANT })).toEqual({ outcome: "created" });
		await activate(t, "closed", 2);
		expect(await t.mutation(internal.orders.reserveCheckoutSnapshot, { ...args, tenantId: TENANT })).toEqual({ outcome: "replayed" });
		await expect(t.mutation(internal.orders.reserveCheckoutSnapshot, { ...args, tenantId: TENANT, handleHash: D3 })).rejects.toThrow("closed");
	});

	test("pinned controls cannot transfer tenant or downgrade, and upgrades need a new epoch", async () => {
		const t = convexTest(schema, modules);
		await seed(t, "zippymiggy.com");
		const legacy = JSON.stringify({ version: 1, tenants: [
			{ siteUrl: "angelsrest.online", state: "open", generation: 1 },
			{ siteUrl: "zippymiggy.com", state: "open", generation: 1 },
		] });
		vi.stubEnv("NEW_ORDER_ADMISSION_CONTROL", legacy);
		const args = { siteUrl: "zippymiggy.com", purpose: "new_order_admission" as const,
			state: "open" as const, generation: 1, acceptedHostGeneration: 1 };
		await t.mutation(internal.commerceClosure.activatePurposeControl, args);
		await expect(activate(t, "open", 1, TENANT, args.siteUrl)).rejects.toThrow(/regress|reused/);
		await activate(t, "open", 2, TENANT, args.siteUrl);
		await expect(activate(t, "closed", 3, OTHER_TENANT, args.siteUrl)).rejects.toThrow("tenant cannot change");
		vi.stubEnv("NEW_ORDER_ADMISSION_CONTROL", legacy);
		await expect(t.mutation(internal.commerceClosure.activatePurposeControl, args)).rejects.toThrow("tenant cannot change");
	});

	test("new admission and first creation require the activated tenant, while uncertain replay keeps its original fence", async () => {
		const t = convexTest(schema, modules);
		await seed(t); await seed(t, "fourth.example", OTHER_TENANT); await activate(t);
		const withoutTenant = begin(); delete withoutTenant.tenantId;
		await expect(t.mutation(internal.commerceClosure.beginCheckoutSessionAdmission, withoutTenant)).rejects.toThrow("activated tenant");
		await expect(t.mutation(internal.commerceClosure.beginCheckoutSessionAdmission, begin(OTHER_TENANT))).rejects.toThrow("identity does not match tenant");
		const admitted = await t.mutation(internal.commerceClosure.beginCheckoutSessionAdmission, begin());
		await t.run(ctx => ctx.db.patch(admitted.admissionId, { tenantId: OTHER_TENANT }));
		await expect(t.mutation(internal.commerceClosure.markCheckoutSessionCreating, create(admitted.admissionId))).rejects.toThrow("activated tenant");
		await t.run(ctx => ctx.db.patch(admitted.admissionId, { tenantId: TENANT }));
		const creating = await t.mutation(internal.commerceClosure.markCheckoutSessionCreating, create(admitted.admissionId));
		await t.mutation(internal.commerceClosure.markCheckoutSessionCreationUncertain, {
			siteUrl: SITE, admissionId: admitted.admissionId, requestFingerprint: D3, stripeIdempotencyDigest: D1,
		});
		await activate(t, "closed", 2);
		expect(await t.mutation(internal.commerceClosure.markCheckoutSessionCreating, create(admitted.admissionId))).toEqual({
			state: "creation_uncertain", requestedStripeExpiresAt: creating.requestedStripeExpiresAt,
		});
		await expect(t.mutation(internal.commerceClosure.beginCheckoutSessionAdmission, { ...begin(), attemptDigest: D4 })).rejects.toThrow("closed");
	});

	test("HTTP syntax widening retains tenant-specific authentication", async () => {
		const t = convexTest(schema, modules); await seed(t);
		vi.stubEnv("NEW_ORDER_ADMISSION_CONTROL", intent());
		const body = { version: 1, site: SITE, purpose: "new_order_admission", state: "open", generation: 1, acceptedHostGeneration: 1 };
		const post = (secret: string) => ({ method: "POST", headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
		expect((await t.fetch("/commerce/purpose-controls/activate", post("wrong-secret-0123456789abcdef"))).status).toBe(401);
		// A valid credential for a different site authenticates, then fails the site/body check.
		expect((await t.fetch("/commerce/purpose-controls/activate", post(OTHER_AUTHORITY))).status).toBe(400);
		expect(await t.run(ctx => ctx.db.query("commercePurposeControls").take(1))).toEqual([]);
		expect((await t.fetch("/commerce/purpose-controls/activate", post(AUTHORITY))).status).toBe(200);
		const request = { version: 1, ...begin(), site: SITE, account: null };
		const { siteUrl: _siteUrl, ...httpBody } = request;
		expect((await t.fetch("/commerce/checkout-admissions/begin", { ...post(AUTHORITY), body: JSON.stringify(httpBody) })).status).toBe(200);
	});

	test.each([true, false])("first supplier admission checks owner and retains admitted work (saved tenant: %s)", async savedTenant => {
		const t = convexTest(schema, modules); await seed(t);
		await activate(t, "open", 1, TENANT, SITE, "new_provider_submission");
		const orderId = await t.run(ctx => ctx.db.insert("orders", {
			...(savedTenant ? { tenantId: TENANT } : {}), siteUrl: SITE, orderNumber: "ORD-TEST", stripeSessionId: "cs_test_1234567890abcdefghijklmnop",
			customerEmail: "buyer@example.com", items: [{ productName: "Print", quantity: 1, price: 4200 }],
			total: 4200, fulfillmentType: "lumaprints", status: "new",
		}));
		const claim = { orderId, tenantId: TENANT, claimToken: "123e4567-e89b-42d3-a456-426614174000", webhookSecret: SECRET };
		const controlId = await t.run(async ctx => (await ctx.db.query("commercePurposeControls").withIndex("by_siteUrl_and_purpose", q => q.eq("siteUrl", SITE).eq("purpose", "new_provider_submission")).unique())!._id);
		await t.run(ctx => ctx.db.patch(controlId, { tenantId: OTHER_TENANT }));
		expect(await t.mutation(api.orders.claimPrintFulfillmentV5, claim)).toEqual({ kind: "submission_closed" });
		await t.run(ctx => ctx.db.patch(controlId, { tenantId: TENANT }));
		expect(await t.mutation(api.orders.claimPrintFulfillmentV5, claim)).toMatchObject({ kind: "claimed" });
		await activate(t, "closed", 2, TENANT, SITE, "new_provider_submission");
		expect(await t.mutation(api.orders.releasePrintFulfillmentClaim, {
			orderId, claimToken: claim.claimToken, webhookSecret: SECRET,
		})).toBe(true);
		expect(await t.mutation(api.orders.claimPrintFulfillmentV5, { ...claim, claimToken: "123e4567-e89b-42d3-a456-426614174001" })).toMatchObject({ kind: "claimed" });
	});
});
