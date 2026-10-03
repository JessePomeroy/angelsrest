/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import betterAuthTest from "@convex-dev/better-auth/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, components } from "./_generated/api";
import { createAuth } from "./auth";
import { DEFAULT_LIST_LIMIT } from "./helpers/limits";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const issuer = "https://fixture.convex.site";
const owner = { issuer, subject: "operator", email: "operator@example.invalid", emailVerified: true };
const input = { name: "Cedar Finch", email: "owner@cedar.example", siteUrl: "cedar.example", tier: "basic" as const };
const passwordHash = `${"a".repeat(32)}:${"b".repeat(128)}`;
const otherTenantId = "tenant_00000000-0000-4000-8000-000000000001";

beforeEach(() => {
	vi.stubEnv("SITE_URL", "https://angelsrest.online");
	vi.stubEnv("CONVEX_SITE_URL", issuer);
	vi.stubEnv("AUTH_GOOGLE_ID", "fixture-google-id");
	vi.stubEnv("AUTH_GOOGLE_SECRET", "fixture-google-secret");
	vi.stubEnv("BETTER_AUTH_SECRET", "fixture-better-auth-secret-at-least-32-characters");
	vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected external request"); }));
});
afterEach(() => {
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

async function setup() {
	const t = convexTest(schema, modules);
	betterAuthTest.register(t);
	await t.run(async (ctx) => {
		await ctx.db.insert("platformClients", {
			name: "Angels Rest", email: owner.email, siteUrl: "angelsrest.online", tier: "full",
			role: "creator", subscriptionStatus: "none", adminEmails: [owner.email],
			adminIdentityIds: [`${issuer}|${owner.subject}`],
		});
	});
	return t;
}

async function provision(t: Awaited<ReturnType<typeof setup>>) {
	const { clientId } = await t.withIdentity(owner).mutation(api.platform.createClientWithAdmin, { ...input, passwordHash });
	const client = await t.run((ctx) => ctx.db.get(clientId));
	if (!client?.tenantId) throw new Error("Fixture tenant identity is missing");
	return { clientId, tenantId: client.tenantId, client };
}

describe("creator client setup status", () => {
	test("denies anonymous and ordinary tenant identities before reading setup state", async () => {
		const t = await setup();
		const { client } = await provision(t);
		await expect(t.query(api.platform.getClientSetupStatus, input)).rejects.toThrow("Not authenticated");
		const tokenIdentifier = client.adminIdentityIds?.[0];
		if (!tokenIdentifier) throw new Error("Fixture membership is missing");
		const member = { issuer, subject: tokenIdentifier.slice(issuer.length + 1), email: input.email, emailVerified: false };
		for (const identity of [member, { ...owner, subject: "different-user" }]) {
			await expect(t.withIdentity(identity).query(api.platform.getClientSetupStatus, input)).rejects.toThrow("not a creator");
		}
	});

	test("absence never reveals account existence or authorizes replacement of an expected tenant", async () => {
		const t = await setup();
		const creator = t.withIdentity(owner);
		const normalized = { ...input, name: ` ${input.name} `, email: input.email.toUpperCase(), siteUrl: "https://www.cedar.example/" };
		expect(await creator.query(api.platform.getClientSetupStatus, normalized)).toEqual({ kind: "absent", siteUrl: input.siteUrl });
		await t.run(async (ctx) => {
			const { internalAdapter } = await createAuth(ctx).$context;
			await internalAdapter.createUser({ name: input.name, email: input.email, emailVerified: true });
		});
		expect(await creator.query(api.platform.getClientSetupStatus, normalized)).toEqual({ kind: "absent", siteUrl: input.siteUrl });
		expect(await creator.query(api.platform.getClientSetupStatus, { ...input, expectedTenantId: otherTenantId })).toEqual({
			kind: "conflict", siteUrl: input.siteUrl, clientId: null, tenantId: null, conflicts: ["expectedTenantId"],
		});
		await expect(creator.query(api.platform.getClientSetupStatus, { ...input, expectedTenantId: "invalid-private-input" })).rejects.toThrow("Invalid expected tenant identity");
	});

	test("reconciles a committed creation after a lost response without changing credentials or returning private fields", async () => {
		const t = await setup();
		const { clientId, tenantId, client } = await provision(t);
		const accountBefore = await t.run(async (ctx) => (await createAuth(ctx).$context).internalAdapter.findUserByEmail(input.email, { includeAccounts: true }));
		const expected = { kind: "matching", siteUrl: input.siteUrl, clientId, tenantId };
		for (const args of [
			input,
			{ ...input, name: ` ${input.name} `, email: input.email.toUpperCase(), siteUrl: "https://www.cedar.example/", expectedTenantId: tenantId },
		]) expect(await t.withIdentity(owner).query(api.platform.getClientSetupStatus, args)).toEqual(expected);
		expect(await t.run((ctx) => ctx.db.get(clientId))).toEqual(client);
		expect(await t.run(async (ctx) => (await createAuth(ctx).$context).internalAdapter.findUserByEmail(input.email, { includeAccounts: true }))).toEqual(accountBefore);
		// Status only reads the projected auth user; credentials are not needed even to configure Better Auth.
		vi.stubEnv("BETTER_AUTH_SECRET", "");
		vi.stubEnv("AUTH_GOOGLE_SECRET", "");
		expect(await t.withIdentity(owner).query(api.platform.getClientSetupStatus, input)).toEqual(expected);
		expect(fetch).not.toHaveBeenCalled();
	});

	test("finds the exact tenant when the platform list no longer includes it", async () => {
		const t = await setup();
		const { clientId, tenantId } = await provision(t);
		let now = Date.now();
		vi.spyOn(Date, "now").mockImplementation(() => ++now);
		await t.run(async (ctx) => {
			for (let index = 0; index <= DEFAULT_LIST_LIMIT; index++) {
				await ctx.db.insert("platformClients", {
					name: "Synthetic other client", email: `owner${index}@other.example`, siteUrl: `client${index}.example`,
					tier: "basic", role: "client", subscriptionStatus: "none", adminEmails: [],
				});
			}
		});
		const creator = t.withIdentity(owner);
		expect((await creator.query(api.platform.listAll, {})).some((client) => client._id === clientId)).toBe(false);
		expect(await creator.query(api.platform.getClientSetupStatus, input)).toEqual({ kind: "matching", siteUrl: input.siteUrl, clientId, tenantId });
	});

	test("reports mismatched saved intent, legacy roles and offboarding without repairing the row", async () => {
		const t = await setup();
		const { clientId, tenantId, client } = await provision(t);
		const { _id, _creationTime, ...fields } = client;
		for (const [conflict, patch] of [
			["name", { name: "Different business" }],
			["email", { email: "different@example.invalid" }],
			["tier", { tier: "full" }],
			["role", { role: "creator" }],
			["role", { role: undefined }],
			["offboarding", { offboarding: { disabledAt: 1, disabledBy: "operator", retainUntil: 2 } }],
		] as const) {
			await t.run((ctx) => ctx.db.replace(clientId, { ...fields, ...patch }));
			const before = await t.run((ctx) => ctx.db.get(clientId));
			expect(await t.withIdentity(owner).query(api.platform.getClientSetupStatus, input)).toEqual({
				kind: "conflict", siteUrl: input.siteUrl, clientId, tenantId, conflicts: [conflict],
			});
			expect(await t.run((ctx) => ctx.db.get(clientId))).toEqual(before);
		}
	});

	test("respects alias ownership and immutable IDs instead of treating a renamed or legacy tenant as absent", async () => {
		const t = await setup();
		const { clientId, tenantId, client } = await provision(t);
		await t.run((ctx) => ctx.db.insert("platformClients", {
			name: "Unrelated tenant", email: "unrelated@example.invalid", siteUrl: "unrelated.example", tier: "basic",
			role: "client", subscriptionStatus: "none", adminEmails: [], tenantId: otherTenantId,
		}));
		await t.run((ctx) => ctx.db.insert("tenantAliases", {
			tenantId, kind: "domain", value: "another-alias.example", verifiedAt: 1, verificationMethod: "operator",
		}));
		expect(await t.withIdentity(owner).query(api.platform.getClientSetupStatus, { ...input, siteUrl: "another-alias.example" })).toEqual({
			kind: "conflict", siteUrl: "another-alias.example", clientId, tenantId, conflicts: ["siteUrl"],
		});
		expect(await t.withIdentity(owner).query(api.platform.getClientSetupStatus, { ...input, expectedTenantId: otherTenantId })).toEqual({
			kind: "conflict", siteUrl: input.siteUrl, clientId, tenantId, conflicts: ["expectedTenantId"],
		});
		const legacyId = await t.run((ctx) => ctx.db.insert("platformClients", {
			name: input.name, email: input.email, siteUrl: "legacy.example", tier: input.tier, role: "client",
			subscriptionStatus: "none", adminEmails: [input.email], adminIdentityIds: client.adminIdentityIds,
		}));
		expect(await t.withIdentity(owner).query(api.platform.getClientSetupStatus, { ...input, siteUrl: "legacy.example" })).toEqual({
			kind: "conflict", siteUrl: "legacy.example", clientId: legacyId, tenantId: null, conflicts: ["tenantIdentity"],
		});
		await t.run((ctx) => ctx.db.patch(legacyId, { tenantId: "unvalidated-private-value" }));
		expect(await t.withIdentity(owner).query(api.platform.getClientSetupStatus, { ...input, siteUrl: "legacy.example" })).toEqual({
			kind: "conflict", siteUrl: "legacy.example", clientId: legacyId, tenantId: null, conflicts: ["tenantIdentity"],
		});
	});

	test("never treats the hub as a resumable client, even through legacy creator authorization", async () => {
		const t = await setup();
		const hubId = await t.run(async (ctx) => {
			const hub = await ctx.db.query("platformClients").withIndex("by_siteUrl", (q) => q.eq("siteUrl", "angelsrest.online")).unique();
			if (!hub) throw new Error("Fixture creator is missing");
			await ctx.db.patch(hub._id, { role: "client", tenantId: otherTenantId });
			return hub._id;
		});
		expect(await t.withIdentity(owner).query(api.platform.getClientSetupStatus, {
			name: "Angels Rest", email: owner.email, siteUrl: "angelsrest.online", tier: "full",
		})).toEqual({ kind: "conflict", siteUrl: "angelsrest.online", clientId: hubId, tenantId: otherTenantId, conflicts: ["role"] });
	});

	test("requires the actual auth user identity rather than an invited email or stale membership", async () => {
		const t = await setup();
		const { clientId, tenantId, client } = await provision(t);
		const creator = t.withIdentity(owner);
		for (const adminIdentityIds of [[], [`${issuer}|different-user`], [`https://wrong.convex.site|${client.adminIdentityIds?.[0].slice(issuer.length + 1)}`]]) {
			await t.run((ctx) => ctx.db.patch(clientId, { adminIdentityIds }));
			expect(await creator.query(api.platform.getClientSetupStatus, input)).toEqual({
				kind: "conflict", siteUrl: input.siteUrl, clientId, tenantId, conflicts: ["adminIdentity"],
			});
		}
		await t.run((ctx) => ctx.db.patch(clientId, { adminIdentityIds: client.adminIdentityIds }));
		const userId = client.adminIdentityIds?.[0].slice(issuer.length + 1);
		if (!userId) throw new Error("Fixture auth user is missing");
		await t.run((ctx) => ctx.runMutation(components.betterAuth.adapter.deleteOne, { input: { model: "user", where: [{ field: "_id", value: userId }] } }));
		expect(await creator.query(api.platform.getClientSetupStatus, input)).toEqual({
			kind: "conflict", siteUrl: input.siteUrl, clientId, tenantId, conflicts: ["adminIdentity"],
		});
	});
});
