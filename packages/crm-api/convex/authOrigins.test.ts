/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import betterAuthTest from "@convex-dev/better-auth/test";
import { hashPassword } from "better-auth/crypto";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createAuth } from "./auth";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const customOrigin = "https://queenworm.com";
const email = "domain-test@example.invalid";
const password = "Custom-Domain-Fixture-Password-42!";

beforeEach(() => {
	vi.stubEnv("SITE_URL", "https://angelsrest.online");
	vi.stubEnv("CONVEX_SITE_URL", "https://fixture.convex.site");
	vi.stubEnv("AUTH_GOOGLE_ID", "fixture-google-id");
	vi.stubEnv("AUTH_GOOGLE_SECRET", "fixture-google-secret");
	vi.stubEnv("BETTER_AUTH_SECRET", "fixture-better-auth-secret-at-least-32-characters");
	vi.stubEnv("BETTER_AUTH_TRUSTED_ORIGINS", "");
	vi.stubEnv("BETTER_AUTH_ALLOWED_HOSTS", "");
});

afterEach(() => vi.unstubAllEnvs());

describe("operator-configured custom-domain authentication", () => {
	test("trusts only the explicitly configured custom origin alongside existing origins", async () => {
		vi.stubEnv("BETTER_AUTH_TRUSTED_ORIGINS", customOrigin);
		const t = convexTest(schema, modules);
		betterAuthTest.register(t);
		await t.run(async (ctx) => {
			const context = await createAuth(ctx).$context;
			for (const origin of [
				customOrigin,
				"https://angelsrest.online",
				"https://www.angelsrest.online",
				"http://localhost:5173",
				"http://localhost:4173",
			]) {
				expect(context.isTrustedOrigin(origin), origin).toBe(true);
			}
			for (const origin of [
				"https://unregistered.example",
				"https://queenworm.com.unregistered.example",
				"https://subdomain.queenworm.com",
				"http://queenworm.com",
				"https://queenworm.com:8443",
			]) {
				expect(context.isTrustedOrigin(origin), origin).toBe(false);
			}
		});
	});

	test.each([
		["BETTER_AUTH_TRUSTED_ORIGINS", customOrigin],
		["BETTER_AUTH_ALLOWED_HOSTS", "queenworm.com"],
	])("accepts custom-domain sign-in configured through %s and rejects unconfigured origins", async (envName, configuredValue) => {
		const t = convexTest(schema, modules);
		betterAuthTest.register(t);
		const passwordHash = await hashPassword(password);
		await t.run(async (ctx) => {
			const { internalAdapter } = await createAuth(ctx).$context;
			const user = await internalAdapter.createUser({
				name: "Domain fixture",
				email,
				emailVerified: true,
			});
			await internalAdapter.createAccount({
				userId: user.id,
				accountId: user.id,
				providerId: "credential",
				password: passwordHash,
			});
		});
		async function signIn(origin: string) {
			return await t.run(async (ctx) => {
				const auth = createAuth(ctx);
				// Better Auth disables origin enforcement in test mode; exercise production checks.
				(await auth.$context).skipOriginCheck = false;
				const response = await auth.handler(
					new Request("https://fixture.convex.site/api/auth/sign-in/email", {
						method: "POST",
						headers: { "Content-Type": "application/json", Origin: origin },
						body: JSON.stringify({ email, password }),
					}),
				);
				return {
					status: response.status,
					body: await response.text(),
					cookie: response.headers.get("set-cookie"),
				};
			});
		}
		const unconfigured = await signIn(customOrigin);
		expect(unconfigured.status).toBe(403);
		expect(JSON.parse(unconfigured.body)).toMatchObject({ code: "INVALID_ORIGIN" });
		vi.stubEnv(envName, configuredValue);
		const configured = await signIn(customOrigin);
		expect(configured.status).toBe(200);
		expect(JSON.parse(configured.body)).toMatchObject({ user: { email } });
		expect(configured.cookie).toContain("session_token=");
		const unrelated = await signIn("https://unregistered.example");
		expect(unrelated.status).toBe(403);
		expect(JSON.parse(unrelated.body)).toMatchObject({ code: "INVALID_ORIGIN" });
	});
});

describe("Gmail permission does not own admin sign-in", () => {
	test("normal Google login requests only identity scopes with Gmail unavailable", async () => {
		vi.stubEnv("GMAIL_OAUTH_CLIENT_ID", ""); vi.stubEnv("GMAIL_CONNECTOR_SECRET", "");
		vi.stubEnv("ORDER_LOOKUP_SECRET", "");
		const t = convexTest(schema, modules); betterAuthTest.register(t);
		await t.run(async ctx => {
			const auth = createAuth(ctx);
			const result = await auth.api.signInSocial({ body: { provider: "google", callbackURL: "https://angelsrest.online/admin", disableRedirect: true }, headers: new Headers({ origin: "https://angelsrest.online" }) });
			const scopes = new URL(result.url!).searchParams.get("scope")!.split(" ");
			expect(scopes).toEqual(expect.arrayContaining(["openid", "email", "profile"]));
			expect(scopes.some(scope => scope.includes("gmail"))).toBe(false);
		});
	});
	test.each(["get-access-token", "refresh-token"])("does not expose mailbox tokens through the browser %s endpoint", async path => {
		const t = convexTest(schema, modules); betterAuthTest.register(t);
		await t.run(async ctx => {
			const auth = createAuth(ctx);
			const response = await auth.handler(new Request(`https://fixture.convex.site/api/auth/${path}`, { method: "POST", headers: { origin: "https://angelsrest.online", "content-type": "application/json" }, body: JSON.stringify({ providerId: "google" }) }));
			expect(response.status).toBe(403);
			expect(await response.text()).toContain("Provider tokens are available only to server integrations");
		});
	});
	test("trusted server refresh API still authenticates through its session", async () => {
		const t = convexTest(schema, modules); betterAuthTest.register(t);
		await t.run(async ctx => {
			const auth = createAuth(ctx);
			await expect(auth.api.refreshToken({ body: { providerId: "google" }, headers: new Headers() })).rejects.toMatchObject({ status: "UNAUTHORIZED" });
		});
	});
});

test("installed Better Auth requests additional scopes only on an authenticated explicit link", async()=>{
 const t=convexTest(schema,modules);betterAuthTest.register(t);
 const passwordHash=await hashPassword(password);
 await t.run(async ctx=>{
  const auth=createAuth(ctx),{internalAdapter}=await auth.$context;
  const user=await internalAdapter.createUser({name:"Link fixture",email,emailVerified:true});
  await internalAdapter.createAccount({userId:user.id,accountId:user.id,providerId:"credential",password:passwordHash});
  const login=await auth.handler(new Request("https://fixture.convex.site/api/auth/sign-in/email",{method:"POST",headers:{origin:"https://angelsrest.online","content-type":"application/json"},body:JSON.stringify({email,password})}));
  expect(login.status).toBe(200);
  const cookie=login.headers.getSetCookie().map(value=>value.split(";")[0]).join("; ");
  for(const scopes of [undefined,["https://www.googleapis.com/auth/gmail.readonly","https://www.googleapis.com/auth/gmail.send"]]){
   const linked=await auth.api.linkSocialAccount({body:{provider:"google",disableRedirect:true,callbackURL:"https://angelsrest.online/admin",...(scopes?{scopes}:{})},headers:new Headers({cookie,origin:"https://angelsrest.online"})});
   const actual=new URL(linked.url).searchParams.get("scope")!.split(" ");
   expect(actual.filter(scope=>scope.includes("gmail"))).toEqual(scopes??[]);
  }
  expect((await auth.$context).options).not.toHaveProperty("account.accountLinking.allowDifferentEmails", true);
 });
});

test.each([false, true])("installed Google token refresh persists safely through the Convex adapter (rotation=%s)", async rotates => {
	const t = convexTest(schema, modules);
	betterAuthTest.register(t);
	const scope = "openid,https://www.googleapis.com/auth/gmail.readonly,https://www.googleapis.com/auth/gmail.send";
	const request = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
		const url = input instanceof Request ? input.url : String(input);
		if (url !== "https://oauth2.googleapis.com/token") throw new Error("Unexpected external request");
		expect(new URLSearchParams(String(init?.body)).get("refresh_token")).toBe("fixture-refresh-original");
		return Response.json({
			access_token: "fixture-access-refreshed",
			token_type: "Bearer",
			expires_in: 3600,
			scope: scope.replaceAll(",", " "),
			...(rotates ? { refresh_token: "fixture-refresh-rotated" } : {}),
		});
	});
	try {
		await t.run(async ctx => {
			const auth = createAuth(ctx), { internalAdapter } = await auth.$context;
			const user = await internalAdapter.createUser({ name: "Refresh fixture", email, emailVerified: true });
			const account = await internalAdapter.createAccount({
				userId: user.id,
				accountId: "fixture-google-subject",
				providerId: "google",
				accessToken: "fixture-access-original",
				refreshToken: "fixture-refresh-original",
				accessTokenExpiresAt: new Date(Date.now() + 3600_000),
				scope,
			});
			const refreshed = await auth.api.refreshToken({ body: { providerId: "google", userId: user.id } });
			expect(refreshed.accessToken).toBe("fixture-access-refreshed");
			expect(refreshed.refreshToken).toBe(rotates ? "fixture-refresh-rotated" : "fixture-refresh-original");
			const saved = await internalAdapter.findAccounts(user.id);
			expect(saved).toHaveLength(1);
			expect(saved[0]).toMatchObject({
				id: account.id,
				userId: user.id,
				accountId: "fixture-google-subject",
				providerId: "google",
				accessToken: "fixture-access-refreshed",
				refreshToken: refreshed.refreshToken,
			});
			expect(request).toHaveBeenCalledOnce();
		});
	} finally {
		request.mockRestore();
	}
});
