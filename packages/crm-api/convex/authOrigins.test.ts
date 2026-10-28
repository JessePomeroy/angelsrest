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
