/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import { reservationHandleHash } from "./helpers/checkoutSnapshot";
import { serverSecretFingerprint } from "./helpers/serverSecrets";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const SITE = "angelsrest.online";
const OTHER_SITE = "zippymiggy.com";
const WEBHOOK_SECRET = "closure-webhook-secret-0123456789abcdef";
const ORDER_LOOKUP_SECRET = "closure-lookup-secret-0123456789abcdef";
const CLAIM_A = "123e4567-e89b-42d3-a456-426614174000";
const CLAIM_B = "123e4567-e89b-42d3-a456-426614174001";
const SESSION_A = "cs_test_1234567890abcdefghijklmnop";
const SESSION_B = "cs_test_1234567890abcdefghijklmnox";
const OTHER_ACCOUNT = "acct_1234567890OtherTenant";
const SNAPSHOT_HANDLE = "123e4567-e89b-42d3-a456-426614174009";
const D1 = "1".repeat(64);
const D2 = "2".repeat(64);
const D3 = "3".repeat(64);
const D4 = "4".repeat(64);
const CHECKOUT_AUTHORITY = "closure-checkout-authority-0123456789abcdef";
const BRIDGE_AUTHORITY = "closure-bridge-authority-0123456789abcdefgh";
const TENANT_ID = "tenant_05eb6092-5d8c-43ce-ad26-1a59522bd07b";
const ACTIVATE_PATH = "/commerce/purpose-controls/activate";
const BEGIN_PATH = "/commerce/checkout-admissions/begin";
const READINESS_PATH = "/commerce/closure/readiness";
const SNAPSHOT = {
	schemaVersion: 1 as const,
	catalogProvider: "convex" as const,
	items: [{
		productKey: "product-1",
		revisionId: "revision-1",
		productKind: "print" as const,
		variantKey: "variant-1",
		materialOptionKey: null,
		sizeOptionKey: null,
		borderOptionKey: null,
		frameOptionKey: null,
	}],
};

function registry(
	angelsRestState: "open" | "closed",
	generation: number,
	otherState: "open" | "closed" = "open",
) {
	return JSON.stringify({
		version: 1,
		tenants: [
			{ siteUrl: SITE, state: angelsRestState, generation },
			{ siteUrl: OTHER_SITE, state: otherState, generation: 1 },
		],
	});
}

beforeEach(async () => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date("2026-08-10T12:00:00.000Z"));
	process.env.WEBHOOK_SECRET = WEBHOOK_SECRET;
	process.env.ORDER_LOOKUP_SECRET = ORDER_LOOKUP_SECRET;
	process.env.ORDER_PRODUCERS_STATE = "open";
	process.env.SITE_URL = "https://www.angelsrest.online";
	process.env.BETTER_AUTH_SECRET = "closure-auth-authority-0123456789abcdef";
	process.env.CHECKOUT_SNAPSHOT_RESERVATION_SECRETS = JSON.stringify({
		[SITE]: [CHECKOUT_AUTHORITY],
	});
	process.env.CHECKOUT_ROLE_CREDENTIAL_FINGERPRINTS = JSON.stringify({
		checkoutBridge: [await serverSecretFingerprint(BRIDGE_AUTHORITY)],
		checkoutSnapshotReservation: [await serverSecretFingerprint(CHECKOUT_AUTHORITY)],
	});
});

afterEach(() => {
	vi.useRealTimers();
	delete process.env.WEBHOOK_SECRET;
	delete process.env.ORDER_LOOKUP_SECRET;
	delete process.env.ORDER_PRODUCERS_STATE;
	delete process.env.NEW_ORDER_ADMISSION_CONTROL;
	delete process.env.NEW_PROVIDER_SUBMISSION_CONTROL;
	delete process.env.CHECKOUT_SNAPSHOT_RESERVATION_SECRETS;
	delete process.env.CHECKOUT_ROLE_CREDENTIAL_FINGERPRINTS;
	delete process.env.SITE_URL;
	delete process.env.BETTER_AUTH_SECRET;
});

function post(body: unknown, authority = CHECKOUT_AUTHORITY) {
	return {
		method: "POST",
		headers: {
			Authorization: `Bearer ${authority}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify(body),
	};
}

async function activateAdmission(
	t: ReturnType<typeof convexTest>,
	state: "open" | "closed",
	generation: number,
	hostGeneration = generation,
) {
	process.env.NEW_ORDER_ADMISSION_CONTROL = registry(state, generation);
	return await t.mutation(internal.commerceClosure.activatePurposeControl, {
		siteUrl: SITE,
		purpose: "new_order_admission",
		state,
		generation,
		acceptedHostGeneration: hostGeneration,
	});
}

async function activateProvider(
	t: ReturnType<typeof convexTest>,
	state: "open" | "closed",
	generation: number,
) {
	process.env.NEW_PROVIDER_SUBMISSION_CONTROL = registry(state, generation);
	return await t.mutation(internal.commerceClosure.activatePurposeControl, {
		siteUrl: SITE,
		purpose: "new_provider_submission",
		state,
		generation,
	});
}

function beginArgs(attemptDigest = D1, handleHash = D2, leaseHash = D4) {
	return {
		siteUrl: SITE,
		attemptDigest,
		proofClass: "same_origin_host_proof" as const,
		admissionHandleHash: handleHash,
		requestFingerprint: D3,
		activeLeaseTokenHash: leaseHash,
		hostGeneration: 1,
	};
}

async function insertPrintOrder(t: ReturnType<typeof convexTest>, session = SESSION_A) {
	return await t.run((ctx) => ctx.db.insert("orders", {
		siteUrl: SITE,
		orderNumber: session === SESSION_A ? "ORD-001" : "ORD-002",
		stripeSessionId: session,
		customerEmail: "buyer@example.com",
		items: [{ productName: "Print", quantity: 1, price: 4200 }],
		total: 4200,
		fulfillmentType: "lumaprints",
		status: "new",
	}));
}

async function seedTenantIdentity(t: ReturnType<typeof convexTest>) {
	await t.run(async (ctx) => {
		await ctx.db.insert("platformClients", {
			tenantId: TENANT_ID,
			name: "Angel's Rest",
			email: "owner@angelsrest.online",
			siteUrl: SITE,
			tier: "full",
			subscriptionStatus: "active",
			adminEmails: ["owner@angelsrest.online"],
		});
		await ctx.db.insert("tenantAliases", {
			tenantId: TENANT_ID,
			kind: "domain",
			value: SITE,
			verifiedAt: Date.now(),
			verificationMethod: "operator",
		});
	});
}

describe("durable commerce controls", () => {
	test("activates only exact environment intent and enforces monotonic epochs", async () => {
		const t = convexTest(schema, modules);
		expect(await activateAdmission(t, "open", 1)).toMatchObject({
			outcome: "created",
			generation: 1,
		});
		expect(await activateAdmission(t, "open", 1)).toMatchObject({
			outcome: "replayed",
			generation: 1,
		});

		process.env.NEW_ORDER_ADMISSION_CONTROL = registry("closed", 1);
		await expect(t.mutation(internal.commerceClosure.activatePurposeControl, {
			siteUrl: SITE,
			purpose: "new_order_admission",
			state: "closed",
			generation: 1,
			acceptedHostGeneration: 1,
		})).rejects.toThrow(/regress|reused/);

		expect(await activateAdmission(t, "closed", 2, 2)).toMatchObject({
			outcome: "advanced",
			generation: 2,
		});
		expect(await t.query(internal.commerceClosure.getNormalizedPurposeControls, {
			siteUrl: SITE,
		})).toMatchObject({
			outcome: "resolved",
			admission: { state: "closed", generation: 2, hostGeneration: 2 },
			provider: { state: "closed", generation: null },
		});
	});

	test("rejects activation when environment intent is absent or mismatched", async () => {
		const t = convexTest(schema, modules);
		await expect(t.mutation(internal.commerceClosure.activatePurposeControl, {
			siteUrl: SITE,
			purpose: "new_provider_submission",
			state: "open",
			generation: 1,
		})).rejects.toThrow(/intent/);
	});

	test("exposes only tenant-authenticated bounded HTTP protocol operations", async () => {
		const t = convexTest(schema, modules);
		process.env.NEW_ORDER_ADMISSION_CONTROL = registry("open", 1);
		const activate = await t.fetch(ACTIVATE_PATH, post({
			version: 1,
			site: SITE,
			purpose: "new_order_admission",
			state: "open",
			generation: 1,
			acceptedHostGeneration: 1,
		}));
		expect(activate.status).toBe(200);

		const unauthorized = await t.fetch(BEGIN_PATH, post({
			version: 1,
			site: SITE,
			account: null,
			attemptDigest: D1,
			proofClass: "same_origin_host_proof",
			admissionHandleHash: D2,
			requestFingerprint: D3,
			activeLeaseTokenHash: D4,
			hostGeneration: 1,
		}, "wrong-authority-0123456789abcdef"));
		expect(unauthorized.status).toBe(401);

		const begun = await t.fetch(BEGIN_PATH, post({
			version: 1,
			site: SITE,
			account: null,
			attemptDigest: D1,
			proofClass: "same_origin_host_proof",
			admissionHandleHash: D2,
			requestFingerprint: D3,
			activeLeaseTokenHash: D4,
			hostGeneration: 1,
		}));
		expect(begun.status).toBe(200);
		expect(await begun.json()).toMatchObject({
			outcome: "created",
			state: "active_prestripe",
			admissionGeneration: 1,
		});
		const readiness = await t.fetch(READINESS_PATH, post({ version: 1, site: SITE }));
		expect(readiness.status).toBe(200);
		const readinessText = await readiness.text();
		expect(JSON.parse(readinessText)).toMatchObject({
			version: 1,
			controls: {
				outcome: "resolved",
				admission: { state: "open", generation: 1, hostGeneration: 1 },
			},
			admission: {
				outcome: "incomplete",
				transitionBlockerClasses: ["active_prestripe"],
				admittedWorkBlockerClasses: [],
			},
			provider: { outcome: "clear", blockerClasses: [] },
		});
		expect(readinessText).not.toContain(D2);
		expect(readinessText).not.toContain(CHECKOUT_AUTHORITY);
	});
});

describe("Checkout Session admission", () => {
	test("stores a matching optional tenant ID without requiring it from older hosts", async () => {
		const t = convexTest(schema, modules);
		await t.run(async (ctx) => {
			await ctx.db.insert("platformClients", {
				tenantId: TENANT_ID,
				name: SITE,
				email: "owner@angelsrest.online",
				siteUrl: SITE,
				tier: "full",
				subscriptionStatus: "active",
				adminEmails: ["owner@angelsrest.online"],
			});
			await ctx.db.insert("tenantAliases", {
				tenantId: TENANT_ID,
				kind: "domain",
				value: SITE,
				verifiedAt: Date.now(),
				verificationMethod: "operator",
			});
		});
		await activateAdmission(t, "open", 1);
		const identified = await t.mutation(
			internal.commerceClosure.beginCheckoutSessionAdmission,
			{ ...beginArgs(), tenantId: TENANT_ID },
		);
		const row = await t.run((ctx) => ctx.db.get(identified.admissionId));
		expect(row?.tenantId).toBe(TENANT_ID);
		expect(
			await t.mutation(internal.commerceClosure.beginCheckoutSessionAdmission, beginArgs()),
		).toMatchObject({ outcome: "replayed", admissionId: identified.admissionId });
		const legacyArgs = beginArgs("6".repeat(64), "7".repeat(64), "8".repeat(64));
		const legacy = await t.mutation(
			internal.commerceClosure.beginCheckoutSessionAdmission,
			legacyArgs,
		);
		expect(
			await t.mutation(internal.commerceClosure.beginCheckoutSessionAdmission, {
				...legacyArgs,
				tenantId: TENANT_ID,
			}),
		).toMatchObject({ outcome: "replayed", admissionId: legacy.admissionId });
		expect((await t.run((ctx) => ctx.db.get(legacy.admissionId)))?.tenantId).toBe(TENANT_ID);
		await expect(
			t.mutation(internal.commerceClosure.beginCheckoutSessionAdmission, {
				...beginArgs("5".repeat(64)),
				tenantId: "tenant_15eb6092-5d8c-43ce-ad26-1a59522bd07b",
			}),
		).rejects.toThrow(/identity/);
	});

	test("fences creation uncertainty and atomically consumes a bound admission", async () => {
		const t = convexTest(schema, modules);
		await activateAdmission(t, "open", 1);
		const begun = await t.mutation(internal.commerceClosure.beginCheckoutSessionAdmission,
			beginArgs());
		expect(begun).toMatchObject({ outcome: "created", state: "active_prestripe" });
		expect(await t.mutation(internal.commerceClosure.beginCheckoutSessionAdmission,
			beginArgs())).toMatchObject({ outcome: "replayed", state: "active_prestripe" });
		await expect(t.mutation(
			internal.commerceClosure.beginCheckoutSessionAdmission,
			beginArgs(D1, D2, "8".repeat(64)),
		)).rejects.toThrow(/conflicts/);
		await expect(t.mutation(internal.commerceClosure.markCheckoutSessionCreating, {
			siteUrl: OTHER_SITE,
			admissionId: begun.admissionId,
			activeLeaseTokenHash: D4,
			requestFingerprint: D3,
			stripeIdempotencyDigest: D1,
		})).rejects.toThrow(/unavailable/);

		const creating = await t.mutation(internal.commerceClosure.markCheckoutSessionCreating, {
			siteUrl: SITE,
			admissionId: begun.admissionId,
			activeLeaseTokenHash: D4,
			requestFingerprint: D3,
			stripeIdempotencyDigest: D1,
		});
		expect(creating.requestedStripeExpiresAt - Math.floor(Date.now() / 1000)).toBe(86_100);
		expect(await t.mutation(
			internal.commerceClosure.beginCheckoutSessionAdmission,
			beginArgs(),
		)).toMatchObject({
			outcome: "replayed",
			state: "creating",
			requestedStripeExpiresAt: creating.requestedStripeExpiresAt,
		});
		expect(await t.mutation(internal.commerceClosure.markCheckoutSessionCreating, {
			siteUrl: SITE,
			admissionId: begun.admissionId,
			activeLeaseTokenHash: D4,
			requestFingerprint: D3,
			stripeIdempotencyDigest: D1,
		})).toEqual(creating);
		expect(await t.mutation(
			internal.commerceClosure.markCheckoutSessionCreationUncertain,
			{
				siteUrl: SITE,
				admissionId: begun.admissionId,
				requestFingerprint: D3,
				stripeIdempotencyDigest: D1,
			},
		)).toBe(true);
		expect(await t.mutation(internal.commerceClosure.markCheckoutSessionCreating, {
			siteUrl: SITE,
			admissionId: begun.admissionId,
			activeLeaseTokenHash: D4,
			requestFingerprint: D3,
			stripeIdempotencyDigest: D1,
		})).toEqual({
			state: "creation_uncertain",
			requestedStripeExpiresAt: creating.requestedStripeExpiresAt,
		});
		expect(await t.mutation(internal.commerceClosure.releaseCheckoutSessionAdmission, {
			siteUrl: SITE,
			admissionId: begun.admissionId,
			activeLeaseTokenHash: D4,
		})).toBe(false);

		expect(await t.mutation(internal.commerceClosure.bindCheckoutSessionAdmission, {
			siteUrl: SITE,
			admissionId: begun.admissionId,
			requestFingerprint: D3,
			stripeIdempotencyDigest: D1,
			stripeSessionId: SESSION_A,
			stripeExpiresAt: creating.requestedStripeExpiresAt,
		})).toEqual({ outcome: "bound" });
		expect(await t.query(api.orders.resolveCheckoutAdmissionRouting, {
			stripeSessionId: SESSION_A,
			webhookSecret: WEBHOOK_SECRET,
		})).toEqual({
			source: "admission",
			siteUrl: SITE,
			stripeConnectedAccountId: undefined,
		});

		const created = await t.mutation(api.orders.create, {
			siteUrl: SITE,
			webhookSecret: WEBHOOK_SECRET,
			stripeSessionId: SESSION_A,
			customerEmail: "buyer@example.com",
			items: [{ productName: "Print", quantity: 1, price: 4200 }],
			total: 4200,
			fulfillmentType: "lumaprints",
			checkoutSessionAdmission: { version: 1, handleHash: D2 },
		});
		expect(created.alreadyExisted).toBe(false);
		const [admission, order] = await t.run(async (ctx) => Promise.all([
			ctx.db.get(begun.admissionId),
			ctx.db.get(created._id),
		]));
		expect(admission?.state).toBe("consumed_order");
		expect(order).toMatchObject({
			checkoutAdmissionProtocolVersion: 1,
			checkoutAdmissionHostGeneration: 1,
			checkoutAdmissionGeneration: 1,
			checkoutAdmissionHandleHash: D2,
		});
		expect(await t.query(api.orders.resolveCheckoutAdmissionRouting, {
			stripeSessionId: SESSION_A,
			webhookSecret: WEBHOOK_SECRET,
		})).toBeNull();
	});

	test("denies a transition after admission closes but permits exact bound replay", async () => {
		const t = convexTest(schema, modules);
		await activateAdmission(t, "open", 1);
		const first = await t.mutation(
			internal.commerceClosure.beginCheckoutSessionAdmission,
			beginArgs(D1, D2),
		);
		const firstCreating = await t.mutation(
			internal.commerceClosure.markCheckoutSessionCreating,
			{
				siteUrl: SITE,
				admissionId: first.admissionId,
				activeLeaseTokenHash: D4,
				requestFingerprint: D3,
				stripeIdempotencyDigest: D1,
			},
		);
		await t.mutation(internal.commerceClosure.bindCheckoutSessionAdmission, {
			siteUrl: SITE,
			admissionId: first.admissionId,
			requestFingerprint: D3,
			stripeIdempotencyDigest: D1,
			stripeSessionId: SESSION_A,
			stripeExpiresAt: firstCreating.requestedStripeExpiresAt,
		});

		const second = await t.mutation(
			internal.commerceClosure.beginCheckoutSessionAdmission,
			beginArgs(D4, "5".repeat(64), "6".repeat(64)),
		);
		const secondCreating = await t.mutation(
			internal.commerceClosure.markCheckoutSessionCreating,
			{
				siteUrl: SITE,
				admissionId: second.admissionId,
				activeLeaseTokenHash: "6".repeat(64),
				requestFingerprint: D3,
				stripeIdempotencyDigest: D4,
			},
		);
		await activateAdmission(t, "closed", 2, 2);
		await expect(t.mutation(internal.commerceClosure.bindCheckoutSessionAdmission, {
			siteUrl: SITE,
			admissionId: second.admissionId,
			requestFingerprint: D3,
			stripeIdempotencyDigest: D4,
			stripeSessionId: SESSION_B,
			stripeExpiresAt: secondCreating.requestedStripeExpiresAt,
		})).rejects.toThrow(/tuple|closed/);
		expect(await t.mutation(internal.commerceClosure.bindCheckoutSessionAdmission, {
			siteUrl: SITE,
			admissionId: first.admissionId,
			requestFingerprint: D3,
			stripeIdempotencyDigest: D1,
			stripeSessionId: SESSION_A,
			stripeExpiresAt: firstCreating.requestedStripeExpiresAt,
		})).toEqual({ outcome: "replayed" });
		expect(await t.mutation(api.orders.create, {
			siteUrl: SITE,
			webhookSecret: WEBHOOK_SECRET,
			stripeSessionId: SESSION_A,
			customerEmail: "buyer@example.com",
			items: [{ productName: "Print", quantity: 1, price: 4200 }],
			total: 4200,
			fulfillmentType: "lumaprints",
			checkoutSessionAdmission: { version: 1, handleHash: D2 },
		})).toMatchObject({ alreadyExisted: false });
	});

	test("enforces the recent tokenless cutoff and exact 37d7h horizon only after closure", async () => {
		const t = convexTest(schema, modules);
		await activateAdmission(t, "open", 1);
		await t.mutation(internal.commerceClosure.createProtocolCutoff, {
			siteUrl: SITE,
			activationGeneration: 1,
		});
		const cutoff = await t.run((ctx) => ctx.db.query("commerceProtocolCutoffs")
			.withIndex("by_siteUrl_and_accountScope", (q) => q
				.eq("siteUrl", SITE)
				.eq("accountScope", "platform"))
			.unique());
		if (!cutoff) throw new Error("expected cutoff");
		await activateAdmission(t, "closed", 2, 2);
		const orderArgs = (stripeSessionId: string) => ({
			siteUrl: SITE,
			webhookSecret: WEBHOOK_SECRET,
			stripeSessionId,
			customerEmail: "buyer@example.com",
			items: [{ productName: "Print", quantity: 1, price: 4200 }],
			total: 4200,
			fulfillmentType: "lumaprints" as const,
		});
		await expect(t.mutation(api.orders.create, orderArgs(SESSION_A)))
			.rejects.toThrow(/admission is closed/);
		const created = await t.mutation(api.orders.create, {
			...orderArgs(SESSION_B),
			stripeSessionCreatedAt: cutoff.cutoffCreatedSeconds - 1,
			stripeSessionExpiresAt: cutoff.cutoffCreatedSeconds + 3599,
		});
		const stored = await t.run((ctx) => ctx.db.get(created._id));
		expect(stored).not.toHaveProperty("stripeSessionCreatedAt");
		expect(stored).not.toHaveProperty("stripeSessionExpiresAt");

		vi.setSystemTime(cutoff.acceptUntilMs);
		await expect(t.mutation(api.orders.create, {
			...orderArgs(SESSION_A),
			stripeSessionCreatedAt: cutoff.cutoffCreatedSeconds - 1,
			stripeSessionExpiresAt: cutoff.cutoffCreatedSeconds + 3599,
		})).rejects.toThrow(/admission is closed/);
	});

	test("atomically binds and consumes linked admission and snapshot provenance", async () => {
		const t = convexTest(schema, modules);
		await activateAdmission(t, "open", 1);
		const snapshotHandleHash = await reservationHandleHash(SITE, SNAPSHOT_HANDLE);
		expect(await t.mutation(internal.orders.reserveCheckoutSnapshot, {
			siteUrl: SITE,
			handleHash: snapshotHandleHash,
			snapshotDigest: D1,
			snapshot: SNAPSHOT,
		})).toMatchObject({ outcome: "created" });
		const begun = await t.mutation(
			internal.commerceClosure.beginCheckoutSessionAdmission,
			beginArgs(),
		);
		const creating = await t.mutation(internal.commerceClosure.markCheckoutSessionCreating, {
			siteUrl: SITE,
			admissionId: begun.admissionId,
			activeLeaseTokenHash: D4,
			requestFingerprint: D3,
			stripeIdempotencyDigest: D1,
		});
		expect(await t.mutation(internal.commerceClosure.bindCheckoutSessionAdmission, {
			siteUrl: SITE,
			admissionId: begun.admissionId,
			requestFingerprint: D3,
			stripeIdempotencyDigest: D1,
			stripeSessionId: SESSION_A,
			stripeExpiresAt: creating.requestedStripeExpiresAt,
			checkoutSnapshotHandleHash: snapshotHandleHash,
		})).toEqual({ outcome: "bound" });

		const created = await t.mutation(api.orders.create, {
			siteUrl: SITE,
			webhookSecret: WEBHOOK_SECRET,
			stripeSessionId: SESSION_A,
			customerEmail: "buyer@example.com",
			items: [{ productName: "Print", quantity: 1, price: 4200 }],
			total: 4200,
			fulfillmentType: "lumaprints",
			checkoutSessionAdmission: { version: 1, handleHash: D2 },
			checkoutSnapshotReservation: { version: 2, handle: SNAPSHOT_HANDLE },
		});
		const [order, reservation] = await t.run(async (ctx) => Promise.all([
			ctx.db.get(created._id),
			ctx.db.query("checkoutSnapshotReservations")
				.withIndex("by_siteUrl_and_handleHash", (q) => q
					.eq("siteUrl", SITE)
					.eq("handleHash", snapshotHandleHash))
				.unique(),
		]));
		expect(order).toMatchObject({
			checkoutAdmissionProtocolVersion: 1,
			checkoutAdmissionHandleHash: D2,
			checkoutSnapshot: SNAPSHOT,
		});
		expect(reservation).toBeNull();
	});

	test("keeps an already-bound handle-v2 Session admissible after closure", async () => {
		const t = convexTest(schema, modules);
		await activateAdmission(t, "open", 1);
		const snapshotHandleHash = await reservationHandleHash(SITE, SNAPSHOT_HANDLE);
		expect(await t.mutation(internal.orders.reserveCheckoutSnapshot, {
			siteUrl: SITE,
			handleHash: snapshotHandleHash,
			snapshotDigest: D1,
			snapshot: SNAPSHOT,
		})).toMatchObject({ outcome: "created" });
		const expiresAt = Math.floor(Date.now() / 1000) + 3600;
		expect(await t.mutation(internal.orders.bindCheckoutSnapshot, {
			siteUrl: SITE,
			handleHash: snapshotHandleHash,
			stripeSessionId: SESSION_A,
			stripeExpiresAt: expiresAt,
		})).toMatchObject({ outcome: "bound" });
		expect(await t.mutation(internal.orders.reserveCheckoutSnapshot, {
			siteUrl: SITE,
			handleHash: "7".repeat(64),
			snapshotDigest: "8".repeat(64),
			snapshot: SNAPSHOT,
		})).toMatchObject({ outcome: "created" });
		await activateAdmission(t, "closed", 2, 2);
		await expect(t.mutation(internal.orders.bindCheckoutSnapshot, {
			siteUrl: SITE,
			handleHash: "7".repeat(64),
			stripeSessionId: SESSION_B,
			stripeExpiresAt: expiresAt,
		})).rejects.toThrow(/admission is closed/);
		await expect(t.mutation(internal.orders.reserveCheckoutSnapshot, {
			siteUrl: SITE,
			handleHash: "9".repeat(64),
			snapshotDigest: "a".repeat(64),
			snapshot: SNAPSHOT,
		})).rejects.toThrow(/admission is closed/);
		expect(await t.mutation(api.orders.create, {
			siteUrl: SITE,
			webhookSecret: WEBHOOK_SECRET,
			stripeSessionId: SESSION_A,
			customerEmail: "buyer@example.com",
			items: [{ productName: "Print", quantity: 1, price: 4200 }],
			total: 4200,
			fulfillmentType: "lumaprints",
			checkoutSnapshotReservation: { version: 2, handle: SNAPSHOT_HANDLE },
		})).toMatchObject({ alreadyExisted: false });
	});

	test("keeps a verified manual-refund terminal admissible after closure", async () => {
		const t = convexTest(schema, modules);
		await activateAdmission(t, "open", 1);
		await activateAdmission(t, "closed", 2, 2);
		const paymentIntent = "pi_1234567890manualrefund";
		await t.run((ctx) => ctx.db.insert("manualRefundIntents", {
			accountScope: "platform",
			siteUrl: SITE,
			stripeEventId: "evt_1234567890manualrefund",
			stripeRefundId: "re_1234567890manualrefund",
			stripeChargeId: "ch_1234567890manualrefund",
			stripeSessionId: SESSION_A,
			stripePaymentIntentId: paymentIntent,
			amount: 4200,
			currency: "usd",
			livemode: false,
			createdAt: Date.now(),
		}));
		const created = await t.mutation(api.orders.create, {
			siteUrl: SITE,
			webhookSecret: WEBHOOK_SECRET,
			stripeSessionId: SESSION_A,
			stripePaymentIntentId: paymentIntent,
			customerEmail: "buyer@example.com",
			items: [{ productName: "Print", quantity: 1, price: 4200 }],
			total: 4200,
			fulfillmentType: "lumaprints",
		});
		expect(await t.run((ctx) => ctx.db.get(created._id))).toMatchObject({
			status: "refunded",
			stripeRefundId: "re_1234567890manualrefund",
			stripeFeeCaptureStatus: "canceled",
		});
	});

	test("expires only the matching active lease and keeps uncertainty blocking", async () => {
		const t = convexTest(schema, modules);
		await activateAdmission(t, "open", 1);
		const begun = await t.mutation(
			internal.commerceClosure.beginCheckoutSessionAdmission,
			beginArgs(),
		);
		const row = await t.run((ctx) => ctx.db.get(begun.admissionId));
		expect(await t.mutation(internal.commerceClosure.expireActiveCheckoutSessionAdmission, {
			admissionId: begun.admissionId,
			activeLeaseTokenHash: "9".repeat(64),
			activeLeaseExpiresAt: row!.activeLeaseExpiresAt!,
		})).toBe(false);
		vi.setSystemTime(row!.activeLeaseExpiresAt! + 1);
		expect(await t.mutation(internal.commerceClosure.expireActiveCheckoutSessionAdmission, {
			admissionId: begun.admissionId,
			activeLeaseTokenHash: D4,
			activeLeaseExpiresAt: row!.activeLeaseExpiresAt!,
		})).toBe(true);
		expect((await t.run((ctx) => ctx.db.get(begun.admissionId)))?.state)
			.toBe("released_definite_no_session");
	});

	test("creates one immutable server-clock cutoff with checked horizon", async () => {
		const t = convexTest(schema, modules);
		await activateAdmission(t, "open", 1);
		await t.run((ctx) => ctx.db.insert("platformClients", {
			name: "Other tenant",
			email: "owner@zippymiggy.com",
			siteUrl: OTHER_SITE,
			tier: "full",
			subscriptionStatus: "active",
			stripeConnectedAccountId: OTHER_ACCOUNT,
			adminEmails: ["owner@zippymiggy.com"],
		}));
		await expect(t.mutation(internal.commerceClosure.createProtocolCutoff, {
			siteUrl: SITE,
			stripeConnectedAccountId: OTHER_ACCOUNT,
			activationGeneration: 1,
		})).rejects.toThrow(/scope/);
		expect(await t.mutation(internal.commerceClosure.createProtocolCutoff, {
			siteUrl: SITE,
			activationGeneration: 1,
		})).toEqual({ outcome: "created" });
		expect(await t.mutation(internal.commerceClosure.createProtocolCutoff, {
			siteUrl: SITE,
			activationGeneration: 1,
		})).toEqual({ outcome: "replayed" });
		const cutoff = await t.run((ctx) => ctx.db.query("commerceProtocolCutoffs")
			.withIndex("by_siteUrl_and_accountScope", (q) => q
				.eq("siteUrl", SITE)
				.eq("accountScope", "platform"))
			.unique());
		expect(cutoff!.acceptUntilMs - cutoff!.cutoffCreatedSeconds * 1000)
			.toBe(3_222_000_000);
		expect(await t.query(api.commerceClosure.getProtocolCutoffForInventory, {
			siteUrl: SITE,
			webhookSecret: WEBHOOK_SECRET,
		})).toEqual({
			cutoffCreatedSeconds: cutoff!.cutoffCreatedSeconds,
			acceptUntilMs: cutoff!.acceptUntilMs,
			activationGeneration: 1,
			accountScopeClass: "platform",
		});
		await expect(t.query(api.commerceClosure.getProtocolCutoffForInventory, {
			siteUrl: SITE,
			webhookSecret: "wrong-webhook-secret-0123456789abcdef",
		})).rejects.toThrow(/Not authorized/);
	});
});

describe("provider admission", () => {
	test("keeps a V5 queue receipt provisional until an exact provider read is recorded", async () => {
		const t = convexTest(schema, modules);
		await activateProvider(t, "open", 1);
		const orderId = await insertPrintOrder(t, "cs_test_v5queueconfirmation1234");
		await expect(t.mutation(api.orders.claimPrintFulfillmentV5, {
			orderId,
			claimToken: CLAIM_A,
			webhookSecret: WEBHOOK_SECRET,
		})).resolves.toMatchObject({ kind: "claimed" });
		await t.mutation(api.orders.beginPrintFulfillmentSubmission, {
			orderId,
			claimToken: CLAIM_A,
			webhookSecret: WEBHOOK_SECRET,
		});
		await expect(t.mutation(api.orders.blockPrintFulfillmentReconciliation, {
			orderId,
			externalId: "cs_test_v5queueconfirmation1234",
			reconciliationClass: "response_contract",
			webhookSecret: WEBHOOK_SECRET,
		})).resolves.toBe(true);
		await expect(t.mutation(api.orders.recordPrintFulfillmentSubmissionReceipt, {
			orderId,
			claimToken: CLAIM_A,
			externalId: "cs_test_v5queueconfirmation1234",
			lumaprintsSubmissionOrderNumber: "10001978978",
			webhookSecret: WEBHOOK_SECRET,
		})).resolves.toEqual({ kind: "recorded" });

		const queued = await t.run((ctx) => ctx.db.get(orderId));
		expect(queued).toMatchObject({
			lumaprintsSubmissionOrderNumber: "10001978978",
			printFulfillmentPhase: "submitting",
			printFulfillmentResolution: "submission_uncertain",
		});
		expect(queued?.printFulfillmentReconciliationClass).toBeUndefined();
		await expect(t.mutation(api.orders.claimOrderConfirmation, {
			orderId,
			webhookSecret: WEBHOOK_SECRET,
		})).resolves.toBe(false);
		await expect(t.mutation(api.orders.recordPrintFulfillmentReconciliationPending, {
			orderId,
			externalId: "cs_test_v5queueconfirmation1234",
			reason: "result_not_observed",
			webhookSecret: WEBHOOK_SECRET,
		})).resolves.toEqual({ kind: "pending", attempts: 1 });
		await expect(t.mutation(api.orders.claimPrintFulfillmentV5, {
			orderId,
			claimToken: CLAIM_B,
			webhookSecret: WEBHOOK_SECRET,
		})).resolves.toMatchObject({ kind: "waiting", retryAt: expect.any(Number) });
		await t.run((ctx) => ctx.db.patch(orderId, {
			printFulfillmentReconciliationLastAttemptAt: 0,
		}));
		await expect(t.mutation(api.orders.completePrintFulfillmentSubmission, {
			orderId,
			claimToken: CLAIM_A,
			externalId: "cs_test_v5queueconfirmation1234",
			lumaprintsOrderNumber: "10001978978",
			webhookSecret: WEBHOOK_SECRET,
		})).rejects.toThrow("requires provider confirmation");
		await expect(t.mutation(api.orders.claimPrintFulfillmentV5, {
			orderId,
			claimToken: CLAIM_B,
			webhookSecret: WEBHOOK_SECRET,
		})).resolves.toEqual({
			kind: "reconcile",
			externalId: "cs_test_v5queueconfirmation1234",
			submissionOrderNumber: "10001978978",
		});
		await expect(t.mutation(api.orders.reconcilePrintFulfillmentSubmission, {
			orderId,
			externalId: "cs_test_v5queueconfirmation1234",
			lumaprintsOrderNumber: "10001978979",
			webhookSecret: WEBHOOK_SECRET,
		})).rejects.toThrow("conflicts with its submission receipt");
		await expect(t.mutation(api.orders.reconcilePrintFulfillmentSubmission, {
			orderId,
			externalId: "cs_test_v5queueconfirmation1234",
			lumaprintsOrderNumber: "10001978978",
			webhookSecret: WEBHOOK_SECRET,
		})).resolves.toEqual({ kind: "fulfilled" });
		const stored = await t.run((ctx) => ctx.db.get(orderId));
		expect(stored).toMatchObject({
			lumaprintsOrderNumber: "10001978978",
			printFulfillmentResolution: "resolved",
		});
		expect(stored?.lumaprintsSubmissionOrderNumber).toBeUndefined();
	});

	test("fences provider admission with the order's verified tenant identity", async () => {
		const t = convexTest(schema, modules);
		await seedTenantIdentity(t);
		await activateProvider(t, "open", 1);
		const orderId = await insertPrintOrder(t);
		await t.run((ctx) => ctx.db.patch(orderId, { tenantId: TENANT_ID }));
		expect(await t.mutation(api.orders.claimPrintFulfillmentV5, {
			orderId,
			claimToken: CLAIM_A,
			tenantId: TENANT_ID,
			webhookSecret: WEBHOOK_SECRET,
		})).toMatchObject({ kind: "claimed" });
		await expect(t.mutation(api.orders.beginPrintFulfillmentSubmission, {
			orderId,
			claimToken: CLAIM_A,
			tenantId: "tenant_15eb6092-5d8c-43ce-ad26-1a59522bd07b",
			webhookSecret: WEBHOOK_SECRET,
		})).rejects.toThrow("routing facts conflict");
	});

	test("defaults closed without mutation, then preserves durable admission across closure", async () => {
		const t = convexTest(schema, modules);
		const orderId = await insertPrintOrder(t);
		expect(await t.mutation(api.orders.claimPrintFulfillmentV5, {
			orderId,
			claimToken: CLAIM_A,
			webhookSecret: WEBHOOK_SECRET,
		})).toEqual({ kind: "submission_closed" });
		expect(await t.run((ctx) => ctx.db.get(orderId))).not.toHaveProperty(
			"printProviderAdmissionStatus",
		);

		await activateProvider(t, "open", 1);
		expect(await t.mutation(api.orders.claimPrintFulfillmentV4, {
			orderId,
			claimToken: CLAIM_A,
			webhookSecret: WEBHOOK_SECRET,
		})).toEqual({ kind: "submission_closed" });
		const claimed = await t.mutation(api.orders.claimPrintFulfillmentV5, {
			orderId,
			claimToken: CLAIM_A,
			webhookSecret: WEBHOOK_SECRET,
		});
		expect(claimed).toMatchObject({ kind: "claimed", providerGeneration: 1 });
		expect(await t.mutation(api.orders.claimPrintFulfillmentV2, {
			orderId,
			claimToken: CLAIM_B,
			webhookSecret: WEBHOOK_SECRET,
		})).toEqual({ kind: "busy" });
		expect(await t.mutation(api.orders.claimPrintFulfillment, {
			orderId,
			webhookSecret: WEBHOOK_SECRET,
		})).toEqual({ kind: "busy" });

		expect(await t.mutation(api.orders.releasePrintFulfillmentClaim, {
			orderId,
			claimToken: CLAIM_A,
			webhookSecret: WEBHOOK_SECRET,
		})).toBe(true);
		expect(await t.mutation(api.orders.claimPrintFulfillmentV3, {
			orderId,
			claimToken: CLAIM_B,
			webhookSecret: WEBHOOK_SECRET,
		})).toEqual({ kind: "busy" });
		await activateProvider(t, "closed", 2);
		expect(await t.mutation(api.orders.claimPrintFulfillmentV5, {
			orderId,
			claimToken: CLAIM_B,
			webhookSecret: WEBHOOK_SECRET,
		})).toMatchObject({ kind: "claimed", providerGeneration: 1 });
		const row = await t.run((ctx) => ctx.db.get(orderId));
		expect(row).toMatchObject({
			printFulfillmentCoordinatorVersion: 5,
			printProviderAdmissionStatus: "admitted",
			printProviderAdmissionGeneration: 1,
			printFulfillmentPhase: "preparing",
		});
	});

	test("exact-token lease expiry returns to admitted idle without clearing admission", async () => {
		const t = convexTest(schema, modules);
		await activateProvider(t, "open", 1);
		const orderId = await insertPrintOrder(t, SESSION_B);
		const claim = await t.mutation(api.orders.claimPrintFulfillmentV5, {
			orderId,
			claimToken: CLAIM_A,
			webhookSecret: WEBHOOK_SECRET,
		});
		if (claim.kind !== "claimed") throw new Error("expected claim");
		vi.setSystemTime(claim.leaseExpiresAt + 1);
		expect(await t.mutation(internal.orders.expirePrintFulfillmentPreparationV4, {
			orderId,
			claimToken: CLAIM_A,
			leaseExpiresAt: claim.leaseExpiresAt,
		})).toBe(true);
		expect(await t.run((ctx) => ctx.db.get(orderId))).toMatchObject({
			printFulfillmentCoordinatorVersion: 5,
			printProviderAdmissionStatus: "admitted",
			printProviderAdmissionGeneration: 1,
		});
		expect((await t.run((ctx) => ctx.db.get(orderId)))?.printFulfillmentPhase)
			.toBeUndefined();
		expect(await t.mutation(api.orders.claimPrintFulfillmentV3, {
			orderId,
			claimToken: CLAIM_B,
			webhookSecret: WEBHOOK_SECRET,
		})).toEqual({ kind: "busy" });
	});

	test("reports only normalized provider blocker classes", async () => {
		const t = convexTest(schema, modules);
		const orderId = await insertPrintOrder(t);
		expect(await t.query(internal.commerceClosure.getNormalizedProviderReadiness, {
			siteUrl: SITE,
		})).toEqual({
			outcome: "incomplete",
			blockerClasses: ["requires_first_provider_admission"],
		});

		await activateProvider(t, "open", 1);
		const claim = await t.mutation(api.orders.claimPrintFulfillmentV5, {
			orderId,
			claimToken: CLAIM_A,
			webhookSecret: WEBHOOK_SECRET,
		});
		if (claim.kind !== "claimed") throw new Error("expected claim");
		expect(await t.query(internal.commerceClosure.getNormalizedProviderReadiness, {
			siteUrl: SITE,
		})).toEqual({ outcome: "incomplete", blockerClasses: ["preparing"] });
		expect(await t.mutation(api.orders.releasePrintFulfillmentClaim, {
			orderId,
			claimToken: CLAIM_A,
			webhookSecret: WEBHOOK_SECRET,
		})).toBe(true);
		expect(await t.query(internal.commerceClosure.getNormalizedProviderReadiness, {
			siteUrl: SITE,
		})).toEqual({ outcome: "incomplete", blockerClasses: ["admitted_idle"] });
		await t.run((ctx) => ctx.db.patch(orderId, { status: "canceled" }));
		expect(await t.query(internal.commerceClosure.getNormalizedProviderReadiness, {
			siteUrl: SITE,
		})).toEqual({ outcome: "clear", blockerClasses: [] });
	});

	test("fails closed on partial provider-admission provenance", async () => {
		const t = convexTest(schema, modules);
		await activateProvider(t, "open", 1);
		const orderId = await insertPrintOrder(t);
		await t.run((ctx) => ctx.db.patch(orderId, {
			printProviderAdmissionStatus: "admitted",
		}));
		expect(await t.mutation(api.orders.claimPrintFulfillmentV5, {
			orderId,
			claimToken: CLAIM_A,
			webhookSecret: WEBHOOK_SECRET,
		})).toEqual({ kind: "busy" });
		expect(await t.query(internal.commerceClosure.getNormalizedProviderReadiness, {
			siteUrl: SITE,
		})).toEqual({ outcome: "incomplete", blockerClasses: ["blocked_contradiction"] });
	});
});
