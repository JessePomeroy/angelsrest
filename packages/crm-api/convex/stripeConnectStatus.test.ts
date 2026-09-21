/// <reference types="vite/client" />
// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const SECRET = "test-stripe-status-secret";
const PLATFORM = "acct_platform1234567890";
const ACCOUNT = "acct_client12345678901";
const OTHER = "acct_other123456789012";
const ready = { kind: "observed" as const, readiness: { status: "ready" as const, chargesEnabled: true, payoutsEnabled: true, detailsSubmitted: true } };
const restricted = { kind: "observed" as const, readiness: { status: "restricted" as const, chargesEnabled: false, payoutsEnabled: false, detailsSubmitted: true } };

beforeEach(() => { process.env.WEBHOOK_SECRET = SECRET; });
afterEach(() => { delete process.env.WEBHOOK_SECRET; vi.restoreAllMocks(); });

async function setup() {
	const t = convexTest(schema, modules);
	await t.run(async ctx => await ctx.db.insert("platformClients", {
		name: "Creator", siteUrl: "angelsrest.online", email: "creator@example.invalid",
		role: "creator", adminEmails: ["creator@example.invalid"], tier: "full", subscriptionStatus: "active",
	}));
	const creator = t.withIdentity({ subject: "creator", email: "creator@example.invalid", emailVerified: true });
	const client = t.withIdentity({ subject: "client", email: "client@example.invalid", emailVerified: true });
	const outsider = t.withIdentity({ subject: "outsider", email: "outsider@example.invalid", emailVerified: true });
	const clientId = await creator.mutation(api.platform.createClient, {
		name: "Client", siteUrl: "client.example", email: "client@example.invalid", adminEmails: ["client@example.invalid"],
		role: "client", tier: "full", subscriptionStatus: "active",
	});
	const createArgs = { clientId, platformAccountId: PLATFORM, livemode: false, webhookSecret: SECRET };
	const attempt = await creator.mutation(api.platform.beginStripeConnectAccount, createArgs);
	const bindArgs = { ...createArgs, attemptId: attempt.attempt.id, stripeConnectedAccountId: ACCOUNT };
	await creator.mutation(api.platform.bindStripeConnectAccount, bindArgs);
	const args = { ...createArgs, accountId: ACCOUNT };
	const begin = () => t.mutation(api.platform.beginStripeConnectStatusRefresh, args);
	const finish = (refreshToken: string, result: typeof ready | typeof restricted = ready) => t.mutation(api.platform.finishStripeConnectStatusRefresh, { ...args, refreshToken, result });
	const read = () => client.query(api.platform.getStripeConnectStatus, { siteUrl: "client.example" });
	const disconnect = () => t.mutation(api.platform.markStripeConnectDisconnected, { ...args, eventId: "evt_disconnect1" });
	return { t, creator, client, outsider, clientId, createArgs, bindArgs, args, begin, finish, read, disconnect };
}

async function token(s: Awaited<ReturnType<typeof setup>>) {
	const result = await s.begin();
	if (result.kind !== "checking") throw new Error("Expected a fresh status claim");
	return result.refreshToken;
}

describe("persisted Stripe connection status", () => {
	test("verified client/creator may read status; no session or other tenant may not", async () => {
		const s = await setup();
		expect(await s.read()).toBeNull();
		expect(await s.creator.query(api.platform.getStripeConnectStatus, { siteUrl: "client.example" })).toBeNull();
		await expect(s.t.query(api.platform.getStripeConnectStatus, { siteUrl: "client.example" })).rejects.toThrow("Not authenticated");
		await expect(s.outsider.query(api.platform.getStripeConnectStatus, { siteUrl: "client.example" })).rejects.toThrow("STRIPE_CONNECT_FORBIDDEN");
	});

	test("provider writes require hub authority even for a creator", async () => {
		const s = await setup();
		for (const caller of [s.t, s.creator, s.client]) {
			await expect(caller.mutation(api.platform.beginStripeConnectStatusRefresh, { ...s.args, webhookSecret: "wrong" })).rejects.toThrow("secret mismatch");
			await expect(caller.mutation(api.platform.finishStripeConnectStatusRefresh, { ...s.args, webhookSecret: "wrong", refreshToken: "forged", result: ready })).rejects.toThrow("secret mismatch");
			await expect(caller.mutation(api.platform.markStripeConnectDisconnected, { ...s.args, webhookSecret: "wrong", eventId: "evt_forged" })).rejects.toThrow("secret mismatch");
		}
		expect(await s.read()).toBeNull();
	});

	test("records provider facts without changing account selection or immutable ownership", async () => {
		const s = await setup();
		const history = await s.t.run(async ctx => await ctx.db.query("stripeAccountBindings").collect());
		expect(await s.finish(await token(s))).toEqual({ applied: true });
		expect(await s.read()).toMatchObject({ accountId: ACCOUNT, state: { ...ready, checkedAt: expect.any(Number) } });
		expect((await s.t.run(async ctx => await ctx.db.get(s.clientId)))?.stripeConnectedAccountId).toBe(ACCOUNT);
		expect(await s.t.run(async ctx => await ctx.db.query("stripeAccountBindings").collect())).toEqual(history);
	});

	test.each(["platform", "mode", "account", "tenant", "attempt", "duplicate", "missing-binding", "history-only"])("rejects %s drift before changing status", async kind => {
		const s = await setup();
		const args = { ...s.args };
		if (kind === "platform") args.platformAccountId = OTHER;
		if (kind === "mode") args.livemode = true;
		if (kind === "account") args.accountId = OTHER;
		await s.t.run(async ctx => {
			const client = await ctx.db.get(s.clientId);
			const binding = await ctx.db.query("stripeAccountBindings").unique();
			if (!binding || !client?.stripeConnectAttempt) throw new Error("Missing fixture");
			if (kind === "tenant") await ctx.db.patch(s.clientId, { tenantId: "other-tenant" });
			if (kind === "attempt") await ctx.db.patch(s.clientId, { stripeConnectAttempt: { ...client.stripeConnectAttempt, id: "other-attempt" } });
			if (kind === "duplicate") {
				const { _id, _creationTime, ...fields } = binding;
				await ctx.db.insert("stripeAccountBindings", fields);
			}
			if (kind === "missing-binding") await ctx.db.delete(binding._id);
			if (kind === "history-only") await ctx.db.patch(s.clientId, { stripeConnectedAccountId: undefined });
		});
		await expect(s.t.mutation(api.platform.beginStripeConnectStatusRefresh, args)).rejects.toThrow();
		expect((await s.t.run(async ctx => await ctx.db.get(s.clientId)))?.stripeConnectStatus).toBeUndefined();
	});

	test("status reads refuse ownership that became corrupt after a successful check", async () => {
		const s = await setup();
		await s.finish(await token(s));
		await s.t.run(async ctx => {
			const binding = await ctx.db.query("stripeAccountBindings").unique();
			if (!binding) throw new Error("Missing fixture");
			await ctx.db.delete(binding._id);
		});
		await expect(s.read()).rejects.toThrow("current verified");
	});

	test("a valid account cannot update another client's state", async () => {
		const s = await setup();
		const otherId = await s.creator.mutation(api.platform.createClient, { name: "Other", siteUrl: "other.example", email: "other@example.invalid", adminEmails: ["other@example.invalid"], tier: "full", subscriptionStatus: "active" });
		await expect(s.t.mutation(api.platform.beginStripeConnectStatusRefresh, { ...s.args, clientId: otherId })).rejects.toThrow("current verified");
	});

	test("a slow ready result cannot overwrite a newer restriction, and completion cannot replay", async () => {
		const s = await setup();
		const older = await token(s);
		const newer = await token(s);
		expect(await s.finish(newer, restricted)).toEqual({ applied: true });
		expect(await s.finish(older, ready)).toEqual({ applied: false });
		expect(await s.finish(newer, ready)).toEqual({ applied: false });
		expect(await s.read()).toMatchObject({ state: restricted });
	});

	test("concurrent refreshes leave exactly one claim that can commit", async () => {
		const s = await setup();
		const tokens = await Promise.all([token(s), token(s)]);
		expect(new Set(tokens).size).toBe(2);
		const results = await Promise.all(tokens.map(value => s.finish(value)));
		expect(results.filter(result => result.applied)).toHaveLength(1);
		expect(await s.read()).toMatchObject({ state: ready });
	});

	test("pending and failed checks do not retain a usable ready snapshot", async () => {
		const s = await setup();
		await s.finish(await token(s));
		const refreshToken = await token(s);
		expect((await s.read())?.state).toEqual({ kind: "checking", startedAt: expect.any(Number) });
		await s.t.mutation(api.platform.finishStripeConnectStatusRefresh, { ...s.args, refreshToken, result: { kind: "unavailable", reason: "provider_unavailable" } });
		expect((await s.read())?.state).toEqual({ kind: "unavailable", reason: "provider_unavailable", checkedAt: expect.any(Number) });
	});

	test("a result must be current, recent, and internally consistent", async () => {
		const s = await setup();
		const now = vi.spyOn(Date, "now").mockReturnValue(1_800_000_000_000);
		const refreshToken = await token(s);
		await expect(s.t.mutation(api.platform.finishStripeConnectStatusRefresh, { ...s.args, refreshToken, result: { ...ready, readiness: { ...ready.readiness, payoutsEnabled: false } } })).rejects.toThrow("contradicts");
		now.mockReturnValue(1_800_000_060_000);
		expect(await s.finish(refreshToken)).toEqual({ applied: false });
		expect((await s.read())?.state.kind).toBe("checking");
		await s.finish(await token(s));
		expect((await s.read())?.state.kind).toBe("observed");
	});

	test("rechecks binding integrity when a pending response returns", async () => {
		const s = await setup();
		const refreshToken = await token(s);
		await s.t.run(async ctx => await ctx.db.patch(s.clientId, { stripeConnectedAccountId: OTHER }));
		await expect(s.finish(refreshToken)).rejects.toThrow("current verified");
		await expect(s.read()).rejects.toThrow("does not match");
	});

	test("disconnection invalidates pending work and never recreates access on replay", async () => {
		const s = await setup();
		const refreshToken = await token(s);
		expect(await s.disconnect()).toEqual({ applied: true });
		const status = await s.read();
		expect(status).toMatchObject({ accountId: ACCOUNT, state: { kind: "disconnected", eventId: "evt_disconnect1" } });
		expect(await s.finish(refreshToken)).toEqual({ applied: false });
		expect(await s.begin()).toEqual({ kind: "disconnected" });
		expect(await s.disconnect()).toEqual({ applied: false });
		expect(await s.read()).toEqual(status);
		await expect(s.creator.mutation(api.platform.beginStripeConnectAccount, s.createArgs)).rejects.toThrow("reconnection review");
		await expect(s.creator.mutation(api.platform.bindStripeConnectAccount, s.bindArgs)).rejects.toThrow("reconnection review");
		expect(await s.t.query(api.platform.getByStripeConnectedAccountId, { stripeConnectedAccountId: ACCOUNT, webhookSecret: SECRET })).toMatchObject({ _id: s.clientId, stripeConnectedAccountId: ACCOUNT });
	});

	test("only bounded event identifiers are retained for disconnection evidence", async () => {
		const s = await setup();
		await expect(s.t.mutation(api.platform.markStripeConnectDisconnected, { ...s.args, eventId: "untrusted body containing personal information" })).rejects.toThrow("Invalid Stripe event ID");
		expect(await s.read()).toBeNull();
	});
});
