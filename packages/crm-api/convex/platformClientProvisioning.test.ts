/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import betterAuthTest from "@convex-dev/better-auth/test";
import { hashPassword, verifyPassword } from "better-auth/crypto";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import { createAuth } from "./auth";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const issuer = "https://fixture.convex.site";
const owner = { subject: "operator", issuer, email: "operator@example.invalid", emailVerified: true };
const password = "Fixture-Only-Password-42!";
const input = { name: "Cedar Finch", email: "owner@cedar.example", siteUrl: "cedar.example", tier: "basic" as const };
let passwordHash: string;

beforeEach(async () => {
	vi.stubEnv("SITE_URL", "https://angelsrest.online");
	vi.stubEnv("CONVEX_SITE_URL", issuer);
	vi.stubEnv("AUTH_GOOGLE_ID", "fixture-google-id");
	vi.stubEnv("AUTH_GOOGLE_SECRET", "fixture-google-secret");
	vi.stubEnv("BETTER_AUTH_SECRET", "fixture-better-auth-secret-at-least-32-characters");
	passwordHash = await hashPassword(password);
});
afterEach(() => vi.unstubAllEnvs());

async function setup() {
	const t = convexTest(schema, modules);
	betterAuthTest.register(t);
	await t.run(async ctx => {
		await ctx.db.insert("platformClients", { name: "Angels Rest", email: owner.email, siteUrl: "angelsrest.online", tier: "full", role: "creator", subscriptionStatus: "none", adminEmails: [owner.email] });
	});
	return t;
}

describe("operator-provisioned client login", () => {
	test("creates a hashed credential and grants only the new tenant to its stable identity", async () => {
		const t = await setup();
		const result = await t.withIdentity(owner).mutation(api.platform.createClientWithAdmin, { ...input, passwordHash });
		expect(result.passwordCreated).toBe(true);
		const account = await t.run(async ctx => (await createAuth(ctx).$context).internalAdapter.findUserByEmail(input.email, { includeAccounts: true }));
		expect(account?.user.emailVerified).toBe(false);
		expect(account?.accounts).toHaveLength(1);
		expect(account?.accounts[0].password).toBe(passwordHash);
		const client = await t.run(ctx => ctx.db.get(result.clientId));
		expect(client).toMatchObject({ role: "client", subscriptionStatus: "none", catalogProductKinds: [], adminIdentityIds: [`${issuer}|${account?.user.id}`] });
		const identity = { issuer, subject: account!.user.id, email: input.email, emailVerified: false };
		expect(await t.withIdentity(identity).mutation(api.adminAuth.claimAdminAccess, { siteUrl: input.siteUrl })).toMatchObject({ authorized: true });
		expect(await t.withIdentity(identity).query(api.adminAuth.checkAdminAccess, { siteUrl: "angelsrest.online", email: input.email })).toMatchObject({ authorized: false });
	});

	test("uses Better Auth sign-in and Change password; the old password stops working", async () => {
		const t = await setup();
		await t.withIdentity(owner).mutation(api.platform.createClientWithAdmin, { ...input, passwordHash });
		const cookies = await t.run(async ctx => {
			const signedIn = await createAuth(ctx).api.signInEmail({ body: { email: input.email, password }, returnHeaders: true });
			return signedIn.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
		});
		expect(cookies).toContain("session_token=");
		const newPassword = "Client-Changed-Password-93!";
		await t.run(ctx => createAuth(ctx).api.changePassword({ body: { currentPassword: password, newPassword }, headers: new Headers({ cookie: cookies, origin: "https://angelsrest.online" }) }));
		const account = await t.run(async ctx => (await createAuth(ctx).$context).internalAdapter.findUserByEmail(input.email, { includeAccounts: true }));
		expect(await verifyPassword({ password: newPassword, hash: account!.accounts[0].password! })).toBe(true);
		await expect(t.run(ctx => createAuth(ctx).api.signInEmail({ body: { email: input.email, password } }))).rejects.toThrow();
		await expect(t.run(ctx => createAuth(ctx).api.signInEmail({ body: { email: input.email, password: newPassword } }))).resolves.toMatchObject({ user: { email: input.email } });
	});

	test("leaves existing users and their credentials unchanged", async () => {
		const t = await setup();
		const existing = await t.run(async ctx => {
			const { internalAdapter } = await createAuth(ctx).$context;
			const user = await internalAdapter.createUser({ name: "Existing", email: input.email, emailVerified: true });
			await internalAdapter.createAccount({ userId: user.id, accountId: user.id, providerId: "credential", password: passwordHash });
			return user;
		});
		const result = await t.withIdentity(owner).mutation(api.platform.createClientWithAdmin, { ...input, passwordHash });
		expect(result.passwordCreated).toBe(false);
		const saved = await t.run(async ctx => (await createAuth(ctx).$context).internalAdapter.findUserByEmail(input.email, { includeAccounts: true }));
		expect(saved?.user.id).toBe(existing.id);
		expect(saved?.accounts).toHaveLength(1);
		expect(saved?.accounts[0].password).toBe(passwordHash);
		expect((await t.run(ctx => ctx.db.get(result.clientId)))?.adminIdentityIds).toBeUndefined();
	});

	test("rejects unauthenticated and client callers before provisioning", async () => {
		const t = await setup();
		await expect(t.mutation(api.platform.createClientWithAdmin, { ...input, passwordHash })).rejects.toThrow("Not authenticated");
		await expect(t.withIdentity({ ...owner, subject: "other", email: "other@example.invalid" }).mutation(api.platform.createClientWithAdmin, { ...input, passwordHash })).rejects.toThrow("not a creator");
		expect(await t.run(async ctx => (await createAuth(ctx).$context).internalAdapter.findUserByEmail(input.email))).toBeNull();
	});

	test("a duplicate website cannot create or reset credentials", async () => {
		const t = await setup();
		await t.withIdentity(owner).mutation(api.platform.createClientWithAdmin, { ...input, passwordHash });
		await expect(t.withIdentity(owner).mutation(api.platform.createClientWithAdmin, { ...input, email: "another@example.invalid", passwordHash })).rejects.toThrow("PLATFORM_CLIENT_SITE_IN_USE");
		expect(await t.run(async ctx => (await createAuth(ctx).$context).internalAdapter.findUserByEmail("another@example.invalid"))).toBeNull();
	});

	test("invalid provisioning rolls back the tenant instead of leaving a partial client", async () => {
		const t = await setup();
		await expect(t.withIdentity(owner).mutation(api.platform.createClientWithAdmin, { ...input, passwordHash: "not-a-hash" })).rejects.toThrow("Invalid credential hash");
		expect(await t.run(ctx => ctx.db.query("platformClients").withIndex("by_siteUrl", q => q.eq("siteUrl", input.siteUrl)).unique())).toBeNull();
	});
});
