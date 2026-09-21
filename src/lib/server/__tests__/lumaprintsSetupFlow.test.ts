import { ConvexHttpClient } from "convex/browser";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api } from "$convex/api";
import schema from "../../../../packages/crm-api/convex/schema";
import {
	loadLumaPrintsSetup,
	normalizeLumaPrintsSetupError,
	verifyAndRegisterLumaPrintsConnection,
} from "../lumaprintsSetup.server";

const modules = import.meta.glob("../../../../packages/crm-api/convex/**/*.ts");
const secret = "synthetic-setup-hub-secret";
const { privateEnv } = vi.hoisted(() => ({ privateEnv: {} as Record<string, string | undefined> }));
vi.mock("$env/dynamic/private", () => ({ env: privateEnv }));
beforeEach(() => {
	vi.stubEnv("WEBHOOK_SECRET", secret);
	for (const key of Object.keys(privateEnv)) delete privateEnv[key];
	Object.assign(privateEnv, { WEBHOOK_SECRET: secret, LUMAPRINTS_CLIENT_SETUP_ENABLED: "true" });
	vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Unexpected provider request")));
});
afterEach(() => {
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

async function fixture() {
	const t = convexTest(schema, modules);
	const creatorId = await t.run((ctx) =>
		ctx.db.insert("platformClients", {
			name: "Creator",
			role: "creator",
			siteUrl: "angelsrest.online",
			email: "operator@example.invalid",
			adminEmails: ["operator@example.invalid"],
			tier: "full",
			subscriptionStatus: "active",
		}),
	);
	const creator = t.withIdentity({
		subject: "operator",
		email: "operator@example.invalid",
		emailVerified: true,
	});
	const client = t.withIdentity({
		subject: "client",
		email: "owner@client1.example",
		emailVerified: true,
	});
	const connections = [];
	const clientIds = [];
	for (let index = 1; index <= 2; index++) {
		const clientId = await creator.mutation(api.platform.createClient, {
			name: `Client ${index}`,
			role: "client",
			siteUrl: `client${index}.example`,
			email: `owner@client${index}.example`,
			adminEmails: [`owner@client${index}.example`],
			tier: "full",
			subscriptionStatus: "active",
		});
		const target = await creator.query(api.platform.getLumaPrintsSetupTarget, {
			siteUrl: `client${index}.example`,
		});
		clientIds.push(clientId);
		connections.push({
			version: 1,
			connectionRef: `lp_client_${index}_setup`,
			tenantId: target.tenantId,
			storeId: 101,
			environment: "sandbox",
			credentialRef: `CLIENT${index}`,
		});
		Object.assign(privateEnv, {
			[`LUMAPRINTS_CONNECTION_CLIENT${index}_API_KEY`]: `synthetic-key${index}`,
			[`LUMAPRINTS_CONNECTION_CLIENT${index}_API_SECRET`]: `synthetic-secret${index}`,
			[`LUMAPRINTS_CONNECTION_CLIENT${index}_WEBHOOK_USERNAME`]: `client${index}`,
			[`LUMAPRINTS_CONNECTION_CLIENT${index}_WEBHOOK_PASSWORD`]: `synthetic-password${index}`,
		});
	}
	privateEnv.LUMAPRINTS_CONNECTIONS = JSON.stringify({ version: 1, connections });
	const convex = new ConvexHttpClient("https://test.convex.cloud");
	const mutate = (...parameters: Parameters<ConvexHttpClient["mutation"]>) =>
		creator.mutation(parameters[0], parameters[1]);
	const query = vi
		.spyOn(convex, "query")
		.mockImplementation((...parameters: Parameters<ConvexHttpClient["query"]>) =>
			creator.query(parameters[0], parameters[1]),
		);
	const mutation = vi.spyOn(convex, "mutation").mockImplementation(mutate);
	const input = {
		siteUrl: "client1.example",
		connectionRef: "lp_client_1_setup",
		accountOwnershipConfirmed: true,
		billingConfirmed: true,
	};
	const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
		Response.json([{ storeId: 101, storeName: "Fictional client store" }]),
	);
	vi.stubGlobal("fetch", fetchMock);
	return {
		t,
		creator,
		client,
		creatorId,
		clientIds,
		connections,
		convex,
		query,
		mutation,
		mutate,
		input,
		fetchMock,
	};
}

it("shows only the authorized client's non-secret choices without contacting the supplier", async () => {
	const s = await fixture();
	expect(await loadLumaPrintsSetup(s.convex, s.input.siteUrl)).toEqual({
		siteUrl: "client1.example",
		clientName: "Client 1",
		status: "available",
		choices: [{ connectionRef: "lp_client_1_setup", storeId: 101, environment: "sandbox" }],
		connection: null,
	});
	expect(s.fetchMock).not.toHaveBeenCalled();
});

it("verifies the selected store before atomically saving the client's original identity", async () => {
	const s = await fixture();
	const result = await verifyAndRegisterLumaPrintsConnection(s.convex, s.input);
	expect(s.fetchMock).toHaveBeenCalledWith(
		"https://us.api-sandbox.lumaprints.com/api/v1/stores",
		expect.objectContaining({
			headers: expect.objectContaining({
				Authorization: `Basic ${btoa("synthetic-key1:synthetic-secret1")}`,
			}),
		}),
	);
	const call = s.fetchMock.mock.calls[0];
	if (!call) throw new Error("Expected store verification");
	expect(new Request(call[0], call[1]).method).toBe("GET");
	expect(result).toMatchObject({
		connectionRef: s.input.connectionRef,
		tenantId: s.connections[0].tenantId,
		storeId: 101,
		environment: "sandbox",
	});
	expect(await loadLumaPrintsSetup(s.convex, s.input.siteUrl)).toMatchObject({
		status: "connected",
		choices: [],
		connection: { connectionRef: s.input.connectionRef },
	});
	expect(await s.t.run((ctx) => ctx.db.query("lumaprintsConnections").take(3))).toHaveLength(1);
});

it.each([
	undefined,
	"false",
	"1",
])("keeps setup disabled for flag %s without querying an undeployed backend", async (flag) => {
	const s = await fixture();
	privateEnv.LUMAPRINTS_CLIENT_SETUP_ENABLED = flag;
	expect(await loadLumaPrintsSetup(s.convex, s.input.siteUrl)).toMatchObject({
		status: "disabled",
		choices: [],
	});
	await expect(verifyAndRegisterLumaPrintsConnection(s.convex, s.input)).rejects.toThrow(
		"not open yet",
	);
	expect(s.query).not.toHaveBeenCalled();
	expect(s.fetchMock).not.toHaveBeenCalled();
});

it("denies client and anonymous identities before reading credentials or making provider requests", async () => {
	const s = await fixture();
	privateEnv.LUMAPRINTS_CONNECTIONS = "invalid-config";
	for (const caller of [s.t, s.client]) {
		s.query.mockImplementation((...parameters: Parameters<ConvexHttpClient["query"]>) =>
			caller.query(parameters[0], parameters[1]),
		);
		for (const action of [
			() => loadLumaPrintsSetup(s.convex, s.input.siteUrl),
			() => verifyAndRegisterLumaPrintsConnection(s.convex, s.input),
		]) {
			try {
				await action();
				throw new Error("Expected forbidden setup");
			} catch (cause) {
				expect(normalizeLumaPrintsSetupError(cause).status).toBe(403);
			}
		}
	}
	expect(s.fetchMock).not.toHaveBeenCalled();
	expect(s.mutation).not.toHaveBeenCalled();
});

it.each([
	[false, false],
	[true, false],
	[false, true],
])("requires both ownership/billing confirmations (%s/%s)", async (accountOwnershipConfirmed, billingConfirmed) => {
	const s = await fixture();
	await expect(
		verifyAndRegisterLumaPrintsConnection(s.convex, {
			...s.input,
			accountOwnershipConfirmed,
			billingConfirmed,
		}),
	).rejects.toThrow("Confirm");
	expect(s.fetchMock).not.toHaveBeenCalled();
	expect(s.mutation).not.toHaveBeenCalled();
});

it("rejects another tenant's configured connection before provider access", async () => {
	const s = await fixture();
	await expect(
		verifyAndRegisterLumaPrintsConnection(s.convex, {
			...s.input,
			connectionRef: "lp_client_2_setup",
		}),
	).rejects.toThrow("for this client");
	expect(s.fetchMock).not.toHaveBeenCalled();
});

it.each([
	"API_SECRET",
	"WEBHOOK_PASSWORD",
])("does not save a connection missing %s", async (suffix) => {
	const s = await fixture();
	delete privateEnv[`LUMAPRINTS_CONNECTION_CLIENT1_${suffix}`];
	await expect(verifyAndRegisterLumaPrintsConnection(s.convex, s.input)).rejects.toThrow();
	expect(s.fetchMock).not.toHaveBeenCalled();
	expect(s.mutation).not.toHaveBeenCalled();
});

it.each([
	"absent_store",
	"unauthorized",
])("does not bind after supplier verification failure: %s", async (failure) => {
	const s = await fixture();
	s.fetchMock.mockImplementation(async () =>
		failure === "absent_store" ? Response.json([]) : new Response("Denied", { status: 401 }),
	);
	await expect(verifyAndRegisterLumaPrintsConnection(s.convex, s.input)).rejects.toThrow();
	expect(s.mutation).not.toHaveBeenCalled();
	expect(await s.t.run((ctx) => ctx.db.query("lumaprintsConnections").take(1))).toEqual([]);
});

it("concurrent and retried setup preserves one connection and original confirmations", async () => {
	const s = await fixture();
	const [a, b] = await Promise.all([
		verifyAndRegisterLumaPrintsConnection(s.convex, s.input),
		verifyAndRegisterLumaPrintsConnection(s.convex, s.input),
	]);
	expect(a).toEqual(b);
	const saved = await s.t.run((ctx) => ctx.db.query("lumaprintsConnections").unique());
	await verifyAndRegisterLumaPrintsConnection(s.convex, s.input);
	expect(await s.t.run((ctx) => ctx.db.query("lumaprintsConnections").unique())).toEqual(saved);
});

it("recovers a lost persistence response without creating or moving a connection", async () => {
	const s = await fixture();
	s.mutation.mockImplementationOnce(
		async (...parameters: Parameters<ConvexHttpClient["mutation"]>) => {
			await s.mutate(...parameters);
			throw new Error("synthetic response loss");
		},
	);
	await expect(verifyAndRegisterLumaPrintsConnection(s.convex, s.input)).rejects.toThrow(
		"response loss",
	);
	const saved = await s.t.run((ctx) => ctx.db.query("lumaprintsConnections").unique());
	await verifyAndRegisterLumaPrintsConnection(s.convex, s.input);
	expect(await s.t.run((ctx) => ctx.db.query("lumaprintsConnections").unique())).toEqual(saved);
});

it.each([
	"authority",
	"tenant",
])("rechecks %s after the provider read before committing", async (change) => {
	const s = await fixture();
	s.fetchMock.mockImplementationOnce(async () => {
		await s.t.run((ctx) =>
			change === "authority"
				? ctx.db.patch(s.creatorId, { adminEmails: [] })
				: ctx.db.patch(s.clientIds[0], { tenantId: "tenant_00000000-0000-4000-8000-000000000001" }),
		);
		return Response.json([{ storeId: 101, storeName: "Fictional store" }]);
	});
	await expect(verifyAndRegisterLumaPrintsConnection(s.convex, s.input)).rejects.toThrow();
	expect(await s.t.run((ctx) => ctx.db.query("lumaprintsConnections").take(1))).toEqual([]);
});

it("retains alias ownership and refuses reactivation after a future detachment", async () => {
	const s = await fixture();
	await verifyAndRegisterLumaPrintsConnection(s.convex, s.input);
	await s.creator.mutation(api.platform.updateClient, {
		clientId: s.clientIds[0],
		siteUrl: "renamed.example",
	});
	expect(await loadLumaPrintsSetup(s.convex, s.input.siteUrl)).toMatchObject({
		siteUrl: "renamed.example",
		status: "connected",
	});
	await s.t.run((ctx) => ctx.db.patch(s.clientIds[0], { lumaprintsConnectionRef: undefined }));
	expect(await loadLumaPrintsSetup(s.convex, s.input.siteUrl)).toMatchObject({
		status: "historical",
		choices: [],
	});
	s.fetchMock.mockClear();
	await expect(verifyAndRegisterLumaPrintsConnection(s.convex, s.input)).rejects.toThrow(
		"separate operator review",
	);
	expect(s.fetchMock).not.toHaveBeenCalled();
});
