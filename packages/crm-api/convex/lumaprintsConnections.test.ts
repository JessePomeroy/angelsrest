/// <reference types="vite/client" />
// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const SECRET = "supplier-binding-test-secret";
const REF = "lp_client_one_sandbox";
const OTHER = "lp_client_two_sandbox";

beforeEach(() => { process.env.WEBHOOK_SECRET = SECRET; });
afterEach(() => { delete process.env.WEBHOOK_SECRET; vi.restoreAllMocks(); });

async function setup() {
	const t = convexTest(schema, modules);
	const creatorId = await t.run(ctx => ctx.db.insert("platformClients", {
		name: "Creator", siteUrl: "angelsrest.online", email: "creator@example.invalid",
		role: "creator", adminEmails: ["creator@example.invalid"], tier: "full", subscriptionStatus: "active",
	}));
	const creator = t.withIdentity({ subject: "creator", email: "creator@example.invalid", emailVerified: true });
	const client = t.withIdentity({ subject: "client", email: "client@example.invalid", emailVerified: true });
	const clientId = await creator.mutation(api.platform.createClient, {
		name: "Client", siteUrl: "client.example", email: "client@example.invalid", adminEmails: ["client@example.invalid"],
		role: "client", tier: "full", subscriptionStatus: "active",
	});
	const args = { clientId, connectionRef: REF, storeId: 123, environment: "sandbox" as const, accountOwnershipConfirmed: true as const, billingConfirmed: true as const, webhookSecret: SECRET };
	const bind = () => creator.mutation(api.platform.registerVerifiedLumaPrintsConnection, args);
	const current = (siteUrl = "client.example") => t.query(api.platform.getLumaPrintsConnectionForSite, { siteUrl, webhookSecret: SECRET });
	const history = (connectionRef = REF) => t.query(api.platform.getLumaPrintsConnectionByRef, { connectionRef, webhookSecret: SECRET });
	return { t, creator, client, creatorId, clientId, args, bind, current, history };
}

describe("immutable LumaPrints connection identity", () => {
	test("requires creator membership and hub authority before binding", async () => {
		const s = await setup();
		await expect(s.t.mutation(api.platform.registerVerifiedLumaPrintsConnection, s.args)).rejects.toThrow("Not authenticated");
		await expect(s.client.mutation(api.platform.registerVerifiedLumaPrintsConnection, s.args)).rejects.toThrow("not a creator");
		await expect(s.creator.mutation(api.platform.registerVerifiedLumaPrintsConnection, { ...s.args, webhookSecret: "wrong" })).rejects.toThrow("secret mismatch");
		expect(await s.current()).toBeNull();
		expect(await s.history()).toBeNull();
	});

	test("does not let session authority substitute for hub-only supplier reads", async () => {
		const s = await setup();
		await s.bind();
		for (const caller of [s.t, s.creator, s.client]) {
			await expect(caller.query(api.platform.getLumaPrintsConnectionForSite, { siteUrl: "client.example", webhookSecret: "wrong" })).rejects.toThrow("secret mismatch");
			await expect(caller.query(api.platform.getLumaPrintsConnectionByRef, { connectionRef: REF, webhookSecret: "wrong" })).rejects.toThrow("secret mismatch");
		}
	});

	test("records only immutable non-secret routing and confirmation times", async () => {
		const s = await setup();
		const context = await s.bind();
		expect(context).toEqual({ version: 1, connectionRef: REF, tenantId: expect.stringMatching(/^tenant_/), storeId: 123, environment: "sandbox" });
		expect(await s.current()).toEqual(context);
		expect(await s.history()).toEqual(context);
		const row = await s.t.run(ctx => ctx.db.query("lumaprintsConnections").unique());
		expect(row).toMatchObject({ ...context, clientId: s.clientId, storeVerifiedAt: expect.any(Number), accountOwnershipConfirmedAt: expect.any(Number), billingConfirmedAt: expect.any(Number) });
		expect(Object.keys(context).sort()).toEqual(["connectionRef", "environment", "storeId", "tenantId", "version"]);
	});

	test("retries and concurrent identical requests preserve one binding and its original confirmations", async () => {
		const s = await setup();
		const results = await Promise.all([s.bind(), s.bind()]);
		expect(results[0]).toEqual(results[1]);
		const original = await s.t.run(ctx => ctx.db.query("lumaprintsConnections").unique());
		vi.spyOn(Date, "now").mockReturnValue(Date.now() + 1000);
		await s.bind();
		expect(await s.t.run(ctx => ctx.db.query("lumaprintsConnections").unique())).toEqual(original);
	});

	test("concurrent conflicting setup never changes the winning identity", async () => {
		const s = await setup();
		const outcomes = await Promise.allSettled([
			s.bind(),
			s.creator.mutation(api.platform.registerVerifiedLumaPrintsConnection, { ...s.args, connectionRef: OTHER, storeId: 456 }),
		]);
		expect(outcomes.filter(result => result.status === "fulfilled")).toHaveLength(1);
		expect(outcomes.filter(result => result.status === "rejected")).toHaveLength(1);
		const winner = outcomes.find(result => result.status === "fulfilled");
		if (!winner || winner.status !== "fulfilled") throw new Error("Missing successful binding");
		expect(await s.current()).toEqual(winner.value);
		expect(await s.t.run(ctx => ctx.db.query("lumaprintsConnections").take(2))).toHaveLength(1);
	});

	test.each(["store", "environment", "reference"])("cannot overwrite a bound %s", async kind => {
		const s = await setup();
		const original = await s.bind();
		await expect(s.creator.mutation(api.platform.registerVerifiedLumaPrintsConnection, {
			...s.args,
			...(kind === "store" ? { storeId: 456 } : kind === "environment" ? { environment: "production" as const } : { connectionRef: OTHER }),
		})).rejects.toThrow();
		expect(await s.current()).toEqual(original);
	});

	test("two tenants retain separate connections even with equal provider-local store numbers", async () => {
		const s = await setup();
		const first = await s.bind();
		const secondId = await s.creator.mutation(api.platform.createClient, { name: "Second", siteUrl: "second.example", email: "second@example.invalid", adminEmails: [], tier: "full", subscriptionStatus: "active" });
		await expect(s.creator.mutation(api.platform.registerVerifiedLumaPrintsConnection, { ...s.args, clientId: secondId })).rejects.toThrow("already bound");
		const second = await s.creator.mutation(api.platform.registerVerifiedLumaPrintsConnection, { ...s.args, clientId: secondId, connectionRef: OTHER });
		expect(first.tenantId).not.toBe(second.tenantId);
		expect(await s.current()).toEqual(first);
		expect(await s.current("second.example")).toEqual(second);
		expect(await s.history(OTHER)).toEqual(second);
	});

	test("allows the hub's own supplier to be pinned without Stripe Connect", async () => {
		const s = await setup();
		const context = await s.creator.mutation(api.platform.registerVerifiedLumaPrintsConnection, { ...s.args, clientId: s.creatorId, connectionRef: "lp_angelsrest_production", environment: "production" });
		expect(await s.current("angelsrest.online")).toEqual(context);
	});

	test("missing client configuration is null and never the hub connection", async () => {
		const s = await setup();
		await s.creator.mutation(api.platform.registerVerifiedLumaPrintsConnection, { ...s.args, clientId: s.creatorId, connectionRef: "lp_angelsrest_production", environment: "production" });
		expect(await s.current()).toBeNull();
		expect(await s.current("unknown.example")).toBeNull();
	});

	test("cannot claim a dangling active reference or ambiguous tenant identity", async () => {
		const s = await setup();
		await s.t.run(ctx => ctx.db.patch(s.creatorId, { lumaprintsConnectionRef: REF }));
		await expect(s.bind()).rejects.toThrow("ownership is missing");
		await s.t.run(async ctx => {
			const client = await ctx.db.get(s.clientId);
			await ctx.db.patch(s.creatorId, { lumaprintsConnectionRef: undefined, tenantId: client?.tenantId });
		});
		await expect(s.bind()).rejects.toThrow();
		expect(await s.t.run(ctx => ctx.db.query("lumaprintsConnections").take(1))).toEqual([]);
	});

	test("domain changes and retained aliases preserve supplier identity", async () => {
		const s = await setup();
		const original = await s.bind();
		await s.creator.mutation(api.platform.updateClient, { clientId: s.clientId, siteUrl: "renamed.example" });
		expect(await s.current()).toEqual(original);
		expect(await s.current("renamed.example")).toEqual(original);
		expect(await s.bind()).toEqual(original);
	});

	test("historical identity survives a future detachment without enabling reactivation or replacement", async () => {
		const s = await setup();
		const original = await s.bind();
		await s.t.run(ctx => ctx.db.patch(s.clientId, { lumaprintsConnectionRef: undefined }));
		expect(await s.current()).toBeNull();
		expect(await s.history()).toEqual(original);
		await expect(s.bind()).rejects.toThrow("cannot be reactivated");
		await expect(s.creator.mutation(api.platform.registerVerifiedLumaPrintsConnection, { ...s.args, connectionRef: OTHER })).rejects.toThrow("replacement requires");
	});

	test.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN])("rejects invalid store ID %s", async storeId => {
		const s = await setup();
		await expect(s.creator.mutation(api.platform.registerVerifiedLumaPrintsConnection, { ...s.args, storeId })).rejects.toThrow();
		expect(await s.current()).toBeNull();
	});

	test.each(["", "lp_short", "lp_has spaces", "lp_" + "x".repeat(81)])("rejects invalid credential reference %s", async connectionRef => {
		const s = await setup();
		await expect(s.creator.mutation(api.platform.registerVerifiedLumaPrintsConnection, { ...s.args, connectionRef })).rejects.toThrow("Invalid LumaPrints");
		expect(await s.current()).toBeNull();
	});

	test.each(["missing", "duplicate", "tenant", "owner", "cross-selection", "duplicate-tenant"])("refuses corrupt %s ownership", async kind => {
		const s = await setup();
		await s.bind();
		await s.t.run(async ctx => {
			const row = await ctx.db.query("lumaprintsConnections").unique();
			const client = await ctx.db.get(s.clientId);
			if (!row || !client) throw new Error("Missing fixture");
			if (kind === "missing") await ctx.db.delete(row._id);
			if (kind === "duplicate") { const { _id, _creationTime, ...fields } = row; await ctx.db.insert("lumaprintsConnections", fields); }
			if (kind === "tenant") await ctx.db.patch(s.clientId, { tenantId: "tenant_00000000-0000-4000-8000-000000000001" });
			if (kind === "owner") await ctx.db.patch(row._id, { clientId: s.creatorId });
			if (kind === "cross-selection") await ctx.db.patch(s.creatorId, { lumaprintsConnectionRef: REF });
			if (kind === "duplicate-tenant") await ctx.db.patch(s.creatorId, { tenantId: client.tenantId });
		});
		await expect(s.current()).rejects.toThrow();
		await expect(s.history()).rejects.toThrow();
	});
});
