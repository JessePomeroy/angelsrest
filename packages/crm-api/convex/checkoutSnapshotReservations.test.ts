/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import {
	parseReservationBindRequest,
	parseReservedCheckoutSnapshot,
	reservationHandleHash,
	reservationSnapshotDigest,
} from "./helpers/checkoutSnapshot";
import { serverSecretFingerprint } from "./helpers/serverSecrets";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const SITE_A = "tenant-a.example";
const SITE_B = "tenant-b.example";
const CURRENT = "reservation-current-authority-0123456789abcdef";
const PREVIOUS = "reservation-previous-authority-0123456789abcdef";
const TENANT_B = "reservation-tenant-b-authority-0123456789abcdef";
const WEBHOOK = "reservation-webhook-authority-0123456789abcdef";
const BRIDGE = "checkout-bridge-authority-0123456789abcdef";
const ACCOUNT_A = "acct_1234567890TenantA";
const ACCOUNT_B = "acct_1234567890TenantB";
const SESSION = "cs_test_1234567890abcdefghijklmnop";
const BOUND_SESSION = "cs_test_1234567890abcdefghijklmnox";
const RESERVE_PATH = "/commerce/checkout-snapshots/reserve";
const BIND_PATH = "/commerce/checkout-snapshots/bind";
const envNames = [
	"CHECKOUT_SNAPSHOT_RESERVATION_SECRETS", "WEBHOOK_SECRET", "BETTER_AUTH_SECRET", "SITE_URL",
	"AUTH_GOOGLE_SECRET", "STRIPE_SECRET_KEY", "ORDER_LOOKUP_SECRET",
	"CATALOG_PRIVATE_ASSET_STORAGE_RECEIPT_SECRETS", "CHECKOUT_ROLE_CREDENTIAL_FINGERPRINTS",
] as const;
const previousEnv = new Map<string, string | undefined>();

const snapshot = {
	schemaVersion: 1 as const,
	catalogProvider: "convex" as const,
	items: [{
		productKey: "product-1", revisionId: "revision-1", productKind: "print" as const,
		variantKey: "variant-1", materialOptionKey: null, sizeOptionKey: null,
		borderOptionKey: null, frameOptionKey: null,
	}],
};

beforeEach(async () => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
	for (const name of envNames) {
		previousEnv.set(name, process.env[name]);
		delete process.env[name];
	}
	process.env.CHECKOUT_SNAPSHOT_RESERVATION_SECRETS = JSON.stringify({
		[SITE_A]: [CURRENT, PREVIOUS], [SITE_B]: [TENANT_B],
	});
	process.env.WEBHOOK_SECRET = WEBHOOK;
	process.env.CHECKOUT_ROLE_CREDENTIAL_FINGERPRINTS = JSON.stringify({
		checkoutBridge: [await serverSecretFingerprint(BRIDGE)],
		checkoutSnapshotReservation: await Promise.all(
			[CURRENT, PREVIOUS, TENANT_B].map(serverSecretFingerprint),
		),
	});
	process.env.BETTER_AUTH_SECRET = "reservation-auth-authority-0123456789abcdef";
	process.env.SITE_URL = "https://www.angelsrest.online";
});

afterEach(() => {
	vi.useRealTimers();
	for (const name of envNames) {
		const value = previousEnv.get(name);
		if (value === undefined) delete process.env[name];
		else process.env[name] = value;
	}
	previousEnv.clear();
});

function request(path: string, secret: string, body: unknown, headers: Record<string, string> = {}) {
	return { path, init: { method: "POST", headers: {
		Authorization: `Bearer ${secret}`, "Content-Type": "application/json", ...headers,
	}, body: JSON.stringify(body) } };
}

function reserveBody(attempt = "123e4567-e89b-42d3-a456-426614174000", overrides: Record<string, unknown> = {}) {
	return { version: 1, site: SITE_A, attempt, account: null, snapshot, ...overrides };
}

async function reserve(t: ReturnType<typeof convexTest>, body = reserveBody(), secret = CURRENT) {
	const req = request(RESERVE_PATH, secret, body);
	const response = await t.fetch(req.path, req.init);
	return { response, json: await response.json() as { handle?: string; replayed?: boolean; error?: string } };
}

async function bind(t: ReturnType<typeof convexTest>, handle: string, overrides: Record<string, unknown> = {}) {
	const req = request(BIND_PATH, CURRENT, {
		version: 1, site: SITE_A, handle, account: null, session: SESSION,
		stripeExpiresAt: Math.floor(Date.now() / 1000) + 3600, ...overrides,
	});
	const response = await t.fetch(req.path, req.init);
	return { response, json: await response.json() as { bound?: boolean; replayed?: boolean; error?: string } };
}

function orderArgs(session = SESSION) {
	return {
		siteUrl: SITE_A, webhookSecret: WEBHOOK, stripeSessionId: session,
		customerEmail: "buyer@example.com",
		items: [{ productName: "Paid provider name", quantity: 1, price: 4200 }],
		total: 4200, fulfillmentType: "digital" as const,
	};
}

async function rows(t: ReturnType<typeof convexTest>) {
	return t.run((ctx) => ctx.db.query("checkoutSnapshotReservations").take(20));
}

async function seedPlatformClients(t: ReturnType<typeof convexTest>) {
	await t.run(async (ctx) => {
		for (const [siteUrl, account] of [[SITE_A, ACCOUNT_A], [SITE_B, ACCOUNT_B]] as const) {
			await ctx.db.insert("platformClients", {
				name: siteUrl, email: `owner@${siteUrl}`, siteUrl, tier: "full",
				subscriptionStatus: "active", stripeConnectedAccountId: account,
				adminEmails: [`owner@${siteUrl}`],
			});
		}
	});
}

describe("checkout snapshot reservation input and authentication", () => {
	test("requires the exact normalized bounded snapshot shape", () => {
		expect(parseReservedCheckoutSnapshot(snapshot)).toEqual(snapshot);
		expect(parseReservedCheckoutSnapshot({ ...snapshot, extra: true })).toBeNull();
		expect(parseReservedCheckoutSnapshot({ ...snapshot, items: [] })).toBeNull();
		expect(parseReservedCheckoutSnapshot({ ...snapshot, items: Array(41).fill(snapshot.items[0]) })).toBeNull();
		expect(parseReservedCheckoutSnapshot({ ...snapshot, items: [{ ...snapshot.items[0], frameOptionKey: undefined }] })).toBeNull();
		expect(parseReservedCheckoutSnapshot({ ...snapshot, items: [{ ...snapshot.items[0], productKey: ` ${"x".repeat(128)}` }] })).toBeNull();
		expect(parseReservedCheckoutSnapshot({ ...snapshot, items: [{ ...snapshot.items[0], productName: "paid" }] })).toBeNull();
	});

	test("accepts only provider account/session forms and a bounded Stripe expiry", () => {
		const valid = {
			version: 1, site: SITE_A, handle: "123e4567-e89b-42d3-a456-426614174000",
			account: ACCOUNT_A, session: SESSION,
			stripeExpiresAt: Math.floor(Date.now() / 1000) + 3600,
		};
		expect(parseReservationBindRequest(valid)).toEqual({
			site: valid.site, handle: valid.handle, account: valid.account,
			session: valid.session, stripeExpiresAt: valid.stripeExpiresAt,
		});
		expect(parseReservationBindRequest({ ...valid, account: "acct_wrong" })).toBeNull();
		expect(parseReservationBindRequest({ ...valid, session: "cs_fake_1" })).toBeNull();
		expect(parseReservationBindRequest({ ...valid, stripeExpiresAt: 9_007_199_254_740 })).toBeNull();
		expect(parseReservationBindRequest({
			...valid, stripeExpiresAt: Math.floor(Date.now() / 1000) + 24 * 60 * 60 + 301,
		})).toBeNull();
		expect(parseReservationBindRequest({
			...valid, stripeExpiresAt: Math.floor(Date.now() / 1000) + 30 * 60 - 301,
		})).toBeNull();
	});

	test("accepts current and previous tenant credentials but rejects wrong, reused, or cross-tenant authority", async () => {
		const t = convexTest(schema, modules);
		expect((await reserve(t, reserveBody(), CURRENT)).response.status).toBe(200);
		expect((await reserve(t, reserveBody("123e4567-e89b-42d3-a456-426614174001"), PREVIOUS)).response.status).toBe(200);
		expect((await reserve(t, reserveBody("123e4567-e89b-42d3-a456-426614174002"), "wrong-authority-0123456789abcdef")).response.status).toBe(401);
		expect((await reserve(t, reserveBody("123e4567-e89b-42d3-a456-426614174003", { site: SITE_B }), CURRENT)).response.status).toBe(400);
		process.env.WEBHOOK_SECRET = CURRENT;
		expect((await reserve(t, reserveBody("123e4567-e89b-42d3-a456-426614174004"))).response.status).toBe(401);
		process.env.WEBHOOK_SECRET = WEBHOOK;
		process.env.CATALOG_PRIVATE_ASSET_STORAGE_RECEIPT_SECRETS = JSON.stringify({ [SITE_A]: [CURRENT] });
		expect((await reserve(t, reserveBody("123e4567-e89b-42d3-a456-426614174005"))).response.status).toBe(401);
		delete process.env.CATALOG_PRIVATE_ASSET_STORAGE_RECEIPT_SECRETS;
		delete process.env.CHECKOUT_ROLE_CREDENTIAL_FINGERPRINTS;
		expect((await reserve(t, reserveBody("123e4567-e89b-42d3-a456-426614174006"))).response.status).toBe(401);
		process.env.CHECKOUT_ROLE_CREDENTIAL_FINGERPRINTS = JSON.stringify({
			checkoutBridge: [await serverSecretFingerprint(CURRENT)],
			checkoutSnapshotReservation: await Promise.all(
				[CURRENT, PREVIOUS, TENANT_B].map(serverSecretFingerprint),
			),
		});
		expect((await reserve(t, reserveBody("123e4567-e89b-42d3-a456-426614174007"))).response.status).toBe(401);
	});

	test("enforces exact transport and body bounds without writes", async () => {
		const t = convexTest(schema, modules);
		const wrongType = request(RESERVE_PATH, CURRENT, reserveBody(), { "Content-Type": "application/json; charset=utf-8" });
		expect((await t.fetch(`${wrongType.path}?x=1`, wrongType.init)).status).toBe(401);
		expect((await t.fetch(wrongType.path, wrongType.init)).status).toBe(401);
		const oversized = request(RESERVE_PATH, CURRENT, reserveBody(), {});
		oversized.init.body = JSON.stringify({ padding: "x".repeat(96 * 1024) });
		expect((await t.fetch(oversized.path, oversized.init)).status).toBe(400);
		expect(await rows(t)).toEqual([]);
	});
});

describe("reservation, binding, and order transfer", () => {
	test("replays identically, conflicts on changed facts, and isolates handle hashes by tenant", async () => {
		const t = convexTest(schema, modules);
		const first = await reserve(t);
		const replay = await reserve(t);
		expect(first.response.status).toBe(200);
		expect(replay.json).toEqual({ version: 2, handle: first.json.handle, replayed: true });
		const changed = await reserve(t, reserveBody(undefined, {
			snapshot: { ...snapshot, catalogProvider: "sanity" },
		}));
		expect(changed.response.status).toBe(409);
		const hashA = await reservationHandleHash(SITE_A, first.json.handle!);
		const hashB = await reservationHandleHash(SITE_B, first.json.handle!);
		expect(hashA).not.toBe(hashB);
		expect((await rows(t))[0]).not.toHaveProperty("handle");
	});

	test("rejects a changed hash collision and binds one account/session idempotently", async () => {
		const t = convexTest(schema, modules);
		const first = await reserve(t);
		const handleHash = await reservationHandleHash(SITE_A, first.json.handle!);
		const collision = await t.mutation(internal.orders.reserveCheckoutSnapshot, {
			siteUrl: SITE_A, handleHash, snapshotDigest: "0".repeat(64), snapshot,
		});
		expect(collision.outcome).toBe("conflict");
		const bound = await bind(t, first.json.handle!);
		expect(bound.json).toEqual({ bound: true, replayed: false });
		expect((await bind(t, first.json.handle!)).json).toEqual({ bound: true, replayed: true });
		expect((await bind(t, first.json.handle!, { stripeExpiresAt: 1 })).response.status).toBe(400);

		const second = await reserve(t, reserveBody("123e4567-e89b-42d3-a456-426614174006"));
		expect((await bind(t, second.json.handle!)).response.status).toBe(409);
	});

	test("fences connected-account reserve and bind to the canonical platform tenant", async () => {
		const t = convexTest(schema, modules);
		await seedPlatformClients(t);
		expect((await reserve(t, reserveBody(undefined, { account: ACCOUNT_B }))).response.status)
			.toBe(403);
		const reserved = await reserve(
			t, reserveBody("123e4567-e89b-42d3-a456-426614174010", { account: ACCOUNT_A }),
		);
		expect(reserved.response.status).toBe(200);
		expect((await bind(t, reserved.json.handle!, { account: ACCOUNT_B })).response.status)
			.toBe(403);
		expect((await bind(t, reserved.json.handle!, { account: ACCOUNT_A })).response.status)
			.toBe(200);
	});

	test("rejects fake binding facts without defeating unbound cleanup", async () => {
		const t = convexTest(schema, modules);
		const reserved = await reserve(t);
		expect((await bind(t, reserved.json.handle!, { session: "not_a_stripe_session" })).response.status)
			.toBe(400);
		expect((await rows(t))[0]?.state).toBe("reserved");
		vi.advanceTimersByTime(25 * 60 * 60 * 1000);
		await t.finishInProgressScheduledFunctions();
		expect(await rows(t)).toEqual([]);
	});

	test("copies and deletes atomically; concurrent replay and malformed existing candidates are safe", async () => {
		const t = convexTest(schema, modules);
		const first = await reserve(t);
		await bind(t, first.json.handle!);
		const candidate = { version: 2, handle: first.json.handle };
		const [created, replayed] = await Promise.all([
			t.mutation(api.orders.create, { ...orderArgs(), checkoutSnapshotReservation: candidate }),
			t.mutation(api.orders.create, { ...orderArgs(), checkoutSnapshotReservation: candidate }),
		]);
		expect(new Set([created._id, replayed._id]).size).toBe(1);
		expect((await t.run((ctx) => ctx.db.get(created._id)))?.checkoutSnapshot).toEqual(snapshot);
		expect(await rows(t)).toEqual([]);
		const existing = await t.mutation(api.orders.create, {
			...orderArgs(), checkoutSnapshotReservation: { malformed: true },
		});
		expect(existing._id).toBe(created._id);
	});

	test("derives digital fulfillment from the consumed durable snapshot on first write and retry", async () => {
		const t = convexTest(schema, modules);
		const digitalSnapshot = {
			...snapshot,
			items: [{ ...snapshot.items[0], productKind: "digital_download" as const }],
		};
		const reserved = await reserve(t, reserveBody(undefined, { snapshot: digitalSnapshot }));
		await bind(t, reserved.json.handle!);
		const candidate = { version: 2, handle: reserved.json.handle };
		const created = await t.mutation(api.orders.create, {
			...orderArgs(), fulfillmentType: "self", checkoutSnapshotReservation: candidate,
		});
		const replayed = await t.mutation(api.orders.create, {
			...orderArgs(), fulfillmentType: "self", checkoutSnapshotReservation: { malformed: true },
		});
		expect(replayed._id).toBe(created._id);
		expect((await t.run((ctx) => ctx.db.get(created._id)))?.fulfillmentType).toBe("digital");
	});

	test("retains a reservation when session, tenant, account, or count does not match", async () => {
		const t = convexTest(schema, modules);
		const first = await reserve(t);
		await bind(t, first.json.handle!);
		await expect(t.mutation(api.orders.create, {
			...orderArgs(), items: [...orderArgs().items, ...orderArgs().items],
			checkoutSnapshotReservation: { version: 2, handle: first.json.handle },
		})).rejects.toThrow("does not match paid session");
		await expect(t.mutation(api.orders.create, {
			...orderArgs(), stripeConnectedAccountId: ACCOUNT_B,
			checkoutSnapshotReservation: { version: 2, handle: first.json.handle },
		})).rejects.toThrow("does not match paid session");
		expect(await rows(t)).toHaveLength(1);
	});

	test("routes by existing order first and otherwise exposes only the bound reservation tenant", async () => {
		const t = convexTest(schema, modules);
		const first = await reserve(t);
		await bind(t, first.json.handle!);
		const reservationRoute = await t.query(api.orders.resolveCheckoutRouting, {
			stripeSessionId: SESSION, stripeTenantMetadataSiteUrl: SITE_A, webhookSecret: WEBHOOK,
		});
		expect(reservationRoute).toEqual({
			source: "reservation", siteUrl: SITE_A, stripeConnectedAccountId: undefined,
		});
		expect(JSON.stringify(reservationRoute)).not.toMatch(/snapshot|handle|digest/i);
		await expect(t.query(api.orders.resolveCheckoutRouting, {
			stripeSessionId: SESSION, stripeTenantMetadataSiteUrl: SITE_B, webhookSecret: WEBHOOK,
		})).rejects.toThrow("routing facts conflict");
		await expect(t.query(api.orders.resolveCheckoutRouting, {
			stripeSessionId: SESSION, stripeTenantMetadataSiteUrl: SITE_A, webhookSecret: "wrong",
		})).rejects.toThrow("Not authorized");
		await t.mutation(api.orders.create, orderArgs());
		expect(await t.query(api.orders.resolveCheckoutRouting, {
			stripeSessionId: SESSION, stripeTenantMetadataSiteUrl: SITE_A, webhookSecret: WEBHOOK,
		})).toEqual({ source: "order", siteUrl: SITE_A, stripeConnectedAccountId: undefined });
	});

	test("rejects contradictory existing-order accounts with a canonical legacy fallback", async () => {
		const t = convexTest(schema, modules);
		await seedPlatformClients(t);
		await t.mutation(api.orders.create, {
			...orderArgs(), stripeConnectedAccountId: ACCOUNT_A,
		});
		await expect(t.query(api.orders.resolveCheckoutRouting, {
			stripeSessionId: SESSION, stripeConnectedAccountId: ACCOUNT_B,
			stripeTenantMetadataSiteUrl: SITE_A, webhookSecret: WEBHOOK,
		})).rejects.toThrow("routing facts conflict");
		await expect(t.mutation(api.orders.create, {
			...orderArgs(), stripeConnectedAccountId: ACCOUNT_B,
		})).rejects.toThrow("routing facts conflict");

		const legacySession = "cs_live_1234567890abcdefghijklmnop";
		await t.run((ctx) => ctx.db.insert("orders", {
			siteUrl: SITE_A, orderNumber: "LEGACY-1", stripeSessionId: legacySession,
			customerEmail: "buyer@example.com", items: [], total: 0,
			fulfillmentType: "digital", status: "new",
		}));
		expect(await t.query(api.orders.resolveCheckoutRouting, {
			stripeSessionId: legacySession, stripeConnectedAccountId: ACCOUNT_A,
			webhookSecret: WEBHOOK,
		})).toMatchObject({ source: "order", siteUrl: SITE_A });
		await expect(t.query(api.orders.resolveCheckoutRouting, {
			stripeSessionId: legacySession, stripeConnectedAccountId: ACCOUNT_B,
			webhookSecret: WEBHOOK,
		})).rejects.toThrow("routing facts conflict");
	});
});

describe("reservation cleanup fences", () => {
	test("purges only the unchanged stale unbound row and never TTL-deletes a bound row", async () => {
		const t = convexTest(schema, modules);
		const unbound = await reserve(t);
		const bound = await reserve(t, reserveBody("123e4567-e89b-42d3-a456-426614174007"));
		await bind(t, bound.json.handle!, { session: BOUND_SESSION });
		vi.advanceTimersByTime(25 * 60 * 60 * 1000);
		await t.finishInProgressScheduledFunctions();
		const remaining = await rows(t);
		expect(remaining).toHaveLength(1);
		expect(remaining[0]?.state).toBe("bound");
		expect(remaining[0]?.handleHash).not.toBe(await reservationHandleHash(SITE_A, unbound.json.handle!));
	});
});
