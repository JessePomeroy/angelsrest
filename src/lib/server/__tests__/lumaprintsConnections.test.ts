import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createLegacyLumaPrintsClient,
	createLumaPrintsClient,
	LumaPrintsError,
} from "../lumaprints";
import type { LumaPrintsConnection } from "../lumaprintsConnections";
import { classifyLumaPrintsFailure } from "../webhookErrorClassification";

const { privateEnv } = vi.hoisted(() => ({ privateEnv: {} as Record<string, string | undefined> }));
vi.mock("$env/dynamic/private", () => ({ env: privateEnv }));

const alice: LumaPrintsConnection = {
	version: 1,
	connectionRef: "lp_alice_12345",
	tenantId: "tenant_11111111-1111-4111-8111-111111111111",
	storeId: 101,
	environment: "sandbox",
};
const bob: LumaPrintsConnection = {
	version: 1,
	connectionRef: "lp_bobby_12345",
	tenantId: "tenant_22222222-2222-4222-8222-222222222222",
	// Equal numeric IDs are allowed across distinct accounts/environments.
	storeId: 101,
	environment: "production",
};
const recipient = {
	firstName: "Test",
	lastName: "Buyer",
	address1: "1 Test Street",
	city: "Detroit",
	state: "MI",
	zip: "48201",
	country: "US",
};
const externalId = "cs_test_1234567890abcdefghijklmn";
const orderNumber = "10000001";
const aliceEntry = () => ({ ...alice, credentialRef: "ALICE" });
const bobEntry = () => ({ ...bob, credentialRef: "BOB" });
function registry(connections: unknown[] = [aliceEntry(), bobEntry()]) {
	privateEnv.LUMAPRINTS_CONNECTIONS = JSON.stringify({ version: 1, connections });
}
function json(value: unknown, status = 200) {
	return new Response(JSON.stringify(value), {
		status,
		headers: { "content-type": "application/json" },
	});
}
function auth(key: string, secret: string) {
	return `Basic ${btoa(`${key}:${secret}`)}`;
}

beforeEach(() => {
	for (const key of Object.keys(privateEnv)) delete privateEnv[key];
	Object.assign(privateEnv, {
		LUMAPRINTS_CONNECTION_ALICE_API_KEY: "synthetic-alice-key",
		LUMAPRINTS_CONNECTION_ALICE_API_SECRET: "synthetic-alice-secret",
		LUMAPRINTS_CONNECTION_BOB_API_KEY: "synthetic-bob-key",
		LUMAPRINTS_CONNECTION_BOB_API_SECRET: "synthetic-bob-secret",
		LUMAPRINTS_API_KEY: "synthetic-central-key",
		LUMAPRINTS_API_SECRET: "synthetic-central-secret",
		LUMAPRINTS_STORE_ID: "999",
		LUMAPRINTS_USE_SANDBOX: "false",
	});
	registry();
	vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Unexpected test request")));
});
afterEach(() => vi.unstubAllGlobals());

describe("client-owned LumaPrints provider", () => {
	it("uses each client's captured identity for store verification, POST, confirmation and search", async () => {
		const seen: Array<{ url: URL; init: RequestInit; authorization: string | null }> = [];
		const fetchMock = vi.fn(async (input: string, init: RequestInit) => {
			const url = new URL(input);
			const authorization = new Headers(init.headers).get("authorization");
			seen.push({ url, init, authorization });
			if (url.pathname === "/api/v1/stores") return json([{ storeId: 101, storeName: "Test" }]);
			if (init.method === "POST") {
				expect(JSON.parse(String(init.body)).storeId).toBe(101);
				return json({ orderNumber, message: "Queued" }, 201);
			}
			const order = { orderNumber, externalId, storeId: 101 };
			if (url.pathname.endsWith(`/${orderNumber}`)) return json(order);
			expect(url.searchParams.get("storeId")).toBe("101");
			return json({ orders: [order], totalOrders: 1, currentPage: 1, totalPages: 1 });
		});
		vi.stubGlobal("fetch", fetchMock);
		const a = createLumaPrintsClient(alice);
		const b = createLumaPrintsClient(bob);
		await Promise.all(
			[a, b].map(async (client) => {
				await client.verifyStoreAccess();
				expect(await client.createOrder(client.buildOrder(externalId, recipient, []))).toEqual({
					orderNumber,
				});
				expect(await client.confirmOrder(orderNumber, externalId)).toBe(true);
				expect(await client.findOrderByExternalId(externalId)).toEqual({ orderNumber });
			}),
		);
		expect(seen).toHaveLength(8);
		for (const call of seen) {
			const expected = call.url.hostname === "us.api-sandbox.lumaprints.com" ? "alice" : "bob";
			expect(call.url.origin).toBe(
				expected === "alice"
					? "https://us.api-sandbox.lumaprints.com"
					: "https://us.api.lumaprints.com",
			);
			expect(call.authorization).toBe(
				auth(`synthetic-${expected}-key`, `synthetic-${expected}-secret`),
			);
			expect(call.init.signal).toBeInstanceOf(AbortSignal);
		}
	});

	it("captures configuration once and picks up same-account credential rotation only in a new client", async () => {
		const saved = { ...alice };
		const client = createLumaPrintsClient(saved);
		privateEnv.LUMAPRINTS_CONNECTION_ALICE_API_SECRET = "synthetic-rotated-secret";
		saved.storeId = 202;
		const rotated = createLumaPrintsClient(alice);
		const fetchMock = vi
			.fn()
			.mockImplementation(async () => json([{ storeId: 101, storeName: "Test" }]));
		vi.stubGlobal("fetch", fetchMock);
		await client.verifyStoreAccess();
		await rotated.verifyStoreAccess();
		expect(client.buildOrder(externalId, recipient, []).storeId).toBe(101);
		expect(new Headers(fetchMock.mock.calls[0][1].headers).get("authorization")).toBe(
			auth("synthetic-alice-key", "synthetic-alice-secret"),
		);
		expect(new Headers(fetchMock.mock.calls[1][1].headers).get("authorization")).toBe(
			auth("synthetic-alice-key", "synthetic-rotated-secret"),
		);
	});

	it("keeps all search pages on the original account when the registry changes mid-request", async () => {
		const client = createLumaPrintsClient(alice);
		let page = 0;
		const fetchMock = vi.fn(async (input: string, init: RequestInit) => {
			page += 1;
			expect(new URL(input).origin).toBe("https://us.api-sandbox.lumaprints.com");
			expect(new Headers(init.headers).get("authorization")).toBe(
				auth("synthetic-alice-key", "synthetic-alice-secret"),
			);
			registry([{ ...aliceEntry(), environment: "production", storeId: 202 }]);
			privateEnv.LUMAPRINTS_CONNECTION_ALICE_API_KEY = "synthetic-different-account";
			return json({
				orders: [
					{
						externalId: page === 2 ? externalId : "unrelated",
						orderNumber: `${10000000 + page}`,
						storeId: 101,
					},
				],
				totalOrders: 2,
				currentPage: page,
				totalPages: 2,
			});
		});
		vi.stubGlobal("fetch", fetchMock);
		expect(await client.findOrderByExternalId(externalId)).toEqual({ orderNumber: "10000002" });
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(() => createLumaPrintsClient(alice)).toThrow(LumaPrintsError);
	});

	it("refuses to send a payload belonging to a different store without classifying it as refundable", async () => {
		const client = createLumaPrintsClient(alice);
		const order = { ...client.buildOrder(externalId, recipient, []), storeId: 202 };
		const failure = await client.createOrder(order).catch((error: unknown) => error);
		expect(failure).toBeInstanceOf(LumaPrintsError);
		expect(classifyLumaPrintsFailure(failure)).toBe("transient");
		expect(fetch).not.toHaveBeenCalled();
	});

	it("keeps central work explicit and does not fall back when a supplied connection is missing", () => {
		delete privateEnv.LUMAPRINTS_CONNECTIONS;
		expect(createLegacyLumaPrintsClient().buildOrder(externalId, recipient, []).storeId).toBe(999);
		expect(() => createLumaPrintsClient(alice)).toThrow(LumaPrintsError);
		expect(fetch).not.toHaveBeenCalled();
	});

	it.each([
		{ version: 2 },
		{ connectionRef: "lp_missing_1234" },
		{ tenantId: bob.tenantId },
		{ storeId: 202 },
		{ environment: "production" },
		{ storeId: 0 },
		{ storeId: 1.1 },
		{ storeId: Number.MAX_SAFE_INTEGER + 1 },
		{ tenantId: "alice.example" },
		{ environment: "other" },
	])("rejects invalid or mismatched saved context before any provider request: %j", (change) => {
		// Exercise the runtime boundary that guards corrupt stored/configured data.
		expect(() => createLumaPrintsClient({ ...alice, ...change } as LumaPrintsConnection)).toThrow(
			LumaPrintsError,
		);
		expect(fetch).not.toHaveBeenCalled();
	});

	it.each([
		undefined,
		"",
		"{",
		"null",
		"[]",
		'{"version":2,"connections":[]}',
		" ".repeat(65537),
	])("rejects missing/malformed/bounded registry without exposing it", (raw) => {
		privateEnv.LUMAPRINTS_CONNECTIONS = raw;
		let failure: unknown;
		try {
			createLumaPrintsClient(alice);
		} catch (error) {
			failure = error;
		}
		expect(failure).toMatchObject({
			message: "LumaPrints connection configuration is unavailable",
			details: { kind: "configuration" },
		});
		expect(classifyLumaPrintsFailure(failure)).toBe("transient");
		expect(JSON.stringify(failure)).not.toContain("synthetic");
		expect(fetch).not.toHaveBeenCalled();
	});

	it.each([
		() => [],
		() => [aliceEntry(), aliceEntry()],
		() => [aliceEntry(), { ...bobEntry(), credentialRef: "ALICE" }],
		() => [{ ...aliceEntry(), credentialRef: "../STRIPE_SECRET" }],
		() => [{ ...aliceEntry(), apiKey: "synthetic-secret-canary" }],
		() => [aliceEntry(), { ...bobEntry(), tenantId: "invalid" }],
		() =>
			Array.from({ length: 101 }, (_, i) => ({
				...aliceEntry(),
				connectionRef: `lp_connection_${i}`,
				credentialRef: `KEY_${i}`,
			})),
	])("rejects ambiguous, unbounded, or unsafe registry entries", (entries) => {
		registry(entries());
		expect(() => createLumaPrintsClient(alice)).toThrow(LumaPrintsError);
		expect(fetch).not.toHaveBeenCalled();
	});

	it.each([
		undefined,
		"",
		"key:secret",
		"\nsecret",
		"x".repeat(513),
		"🔑",
	])("rejects invalid selected Basic credentials", (key) => {
		privateEnv.LUMAPRINTS_CONNECTION_ALICE_API_KEY = key;
		expect(() => createLumaPrintsClient(alice)).toThrow(LumaPrintsError);
		expect(fetch).not.toHaveBeenCalled();
	});

	it("rejects credentials copied between clients but tolerates another client's missing secret", () => {
		privateEnv.LUMAPRINTS_CONNECTION_BOB_API_KEY = privateEnv.LUMAPRINTS_CONNECTION_ALICE_API_KEY;
		privateEnv.LUMAPRINTS_CONNECTION_BOB_API_SECRET =
			privateEnv.LUMAPRINTS_CONNECTION_ALICE_API_SECRET;
		expect(() => createLumaPrintsClient(alice)).toThrow(LumaPrintsError);
		delete privateEnv.LUMAPRINTS_CONNECTION_BOB_API_SECRET;
		expect(createLumaPrintsClient(alice).buildOrder(externalId, recipient, []).storeId).toBe(101);
		expect(() => createLumaPrintsClient(bob)).toThrow(LumaPrintsError);
	});

	it.each([
		[],
		{},
		[{ storeId: 202, storeName: "Other" }],
		[{ storeId: 101 }],
		[
			{ storeId: 101, storeName: "Test" },
			{ storeId: "101", storeName: "Duplicate" },
		],
		[{ storeId: 101, storeName: "x".repeat(1001) }],
		Array.from({ length: 1001 }, (_, i) => ({ storeId: i + 1, storeName: "Test" })),
	])("does not verify absent, ambiguous, malformed or oversized store listings", async (body) => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(body)));
		await expect(createLumaPrintsClient(alice).verifyStoreAccess()).rejects.toBeInstanceOf(
			LumaPrintsError,
		);
	});

	it.each([401, 403, 429, 500])("does not verify provider HTTP %s", async (status) => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status })));
		await expect(createLumaPrintsClient(alice).verifyStoreAccess()).rejects.toBeInstanceOf(
			LumaPrintsError,
		);
	});

	it("bounds store-list response bytes and redacts provider failures", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				new Response("synthetic-sensitive-body", {
					headers: { "content-type": "application/json", "content-length": String(256 * 1024 + 1) },
				}),
			),
		);
		const failure = await createLumaPrintsClient(alice)
			.verifyStoreAccess()
			.catch((error: unknown) => error);
		expect(failure).toBeInstanceOf(LumaPrintsError);
		expect(String(failure)).not.toContain("synthetic");
		expect(classifyLumaPrintsFailure(failure)).toBe("transient");
	});
});
