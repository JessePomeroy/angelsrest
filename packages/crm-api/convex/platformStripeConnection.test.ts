/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const SECRET = "test-connect-binding-secret";
const PLATFORM = "acct_platform1234567890";
const ACCOUNT = "acct_client12345678901";
const OTHER_ACCOUNT = "acct_other123456789012";

beforeEach(() => {
	process.env.WEBHOOK_SECRET = SECRET;
});
afterEach(() => {
	delete process.env.WEBHOOK_SECRET;
});

function input(siteUrl: string) {
	return {
		name: siteUrl,
		email: "client@example.com",
		siteUrl,
		tier: "full" as const,
		subscriptionStatus: "active" as const,
		role: "client" as const,
		adminEmails: ["client@example.com"],
	};
}

async function setup() {
	const t = convexTest(schema, modules);
	const creatorId = await t.run(
		async (ctx) =>
			await ctx.db.insert("platformClients", {
				...input("angelsrest.online"),
				role: "creator",
				email: "creator@example.com",
				adminEmails: ["creator@example.com"],
			}),
	);
	const admin = t.withIdentity({
		subject: "creator",
		email: "creator@example.com",
		emailVerified: true,
	});
	const client = t.withIdentity({
		subject: "client",
		email: "client@example.com",
		emailVerified: true,
	});
	const clientId = await admin.mutation(api.platform.createClient, input("client.example"));
	const beginArgs = {
		clientId,
		platformAccountId: PLATFORM,
		livemode: false,
		webhookSecret: SECRET,
	};
	const begin = () => admin.mutation(api.platform.beginStripeConnectAccount, beginArgs);
	return { t, admin, client, clientId, creatorId, beginArgs, begin };
}

describe("verified Stripe account binding", () => {
	test("retains the owner after the active Stripe selection is removed", async () => {
		const s = await setup();
		const prepared = await s.begin();
		await s.admin.mutation(api.platform.bindStripeConnectAccount, {
			...s.beginArgs,
			attemptId: prepared.attempt.id,
			stripeConnectedAccountId: ACCOUNT,
		});
		// Simulate a future offboarding operation, not a public account-reset API.
		await s.t.run(async (ctx) =>
			ctx.db.patch(s.clientId, {
				stripeConnectedAccountId: undefined,
			}),
		);
		expect(
			await s.t.query(api.platform.getByStripeConnectedAccountId, {
				stripeConnectedAccountId: ACCOUNT,
				webhookSecret: SECRET,
			}),
		).toMatchObject({ _id: s.clientId, tenantId: prepared.tenantId });
		expect(
			(
				await s.t.query(api.platform.getStripeAccountForSite, {
					siteUrl: "client.example",
				})
			)?.stripeConnectedAccountId,
		).toBeUndefined();
	});

	test("a historical account cannot be rebound to a different tenant", async () => {
		const s = await setup();
		const prepared = await s.begin();
		await s.admin.mutation(api.platform.bindStripeConnectAccount, {
			...s.beginArgs,
			attemptId: prepared.attempt.id,
			stripeConnectedAccountId: ACCOUNT,
		});
		await s.t.run(async (ctx) =>
			ctx.db.patch(s.clientId, {
				stripeConnectedAccountId: undefined,
			}),
		);
		const secondId = await s.admin.mutation(api.platform.createClient, input("second.example"));
		const second = await s.admin.mutation(api.platform.beginStripeConnectAccount, {
			...s.beginArgs,
			clientId: secondId,
		});
		await expect(
			s.admin.mutation(api.platform.bindStripeConnectAccount, {
				...s.beginArgs,
				clientId: secondId,
				attemptId: second.attempt.id,
				stripeConnectedAccountId: ACCOUNT,
			}),
		).rejects.toThrow("already bound");
	});

	test("concurrent starts freeze a single attempt and tenant identity", async () => {
		const s = await setup();
		const [first, second] = await Promise.all([s.begin(), s.begin()]);
		expect(first).toEqual(second);
		expect(first.attempt).toMatchObject({
			model: "full-v1",
			platformAccountId: PLATFORM,
			livemode: false,
		});
		expect(first.tenantId).toMatch(/^tenant_/);
		expect(
			(await s.t.run(async (ctx) => await ctx.db.get(s.clientId)))?.stripeConnectAttempt,
		).toEqual(first.attempt);
	});

	test("profile edits cannot change the saved provider request on retry", async () => {
		const s = await setup();
		const first = await s.begin();
		await s.admin.mutation(api.platform.updateClient, {
			clientId: s.clientId,
			email: "updated@example.com",
			siteUrl: "renamed.example",
		});
		expect(await s.begin()).toEqual(first);
	});

	test("both creator membership and hub authority are required", async () => {
		const s = await setup();
		await expect(
			s.t.query(api.platform.getStripeConnectTarget, { siteUrl: "client.example" }),
		).rejects.toThrow("Not authenticated");
		await expect(
			s.client.query(api.platform.getStripeConnectTarget, { siteUrl: "client.example" }),
		).rejects.toThrow("Not authorized");
		await expect(
			s.client.mutation(api.platform.beginStripeConnectAccount, s.beginArgs),
		).rejects.toThrow("Not authorized");
		await expect(
			s.admin.mutation(api.platform.beginStripeConnectAccount, {
				...s.beginArgs,
				webhookSecret: "wrong",
			}),
		).rejects.toThrow("secret mismatch");
		expect(
			(await s.t.run(async (ctx) => await ctx.db.get(s.clientId)))?.stripeConnectAttempt,
		).toBeUndefined();
	});

	test("does not onboard the platform's own tenant", async () => {
		const s = await setup();
		await expect(
			s.admin.query(api.platform.getStripeConnectTarget, { siteUrl: "angelsrest.online" }),
		).rejects.toThrow("own account");
		await expect(
			s.admin.mutation(api.platform.beginStripeConnectAccount, {
				...s.beginArgs,
				clientId: s.creatorId,
			}),
		).rejects.toThrow("own account");
	});

	test("refuses a Stripe platform or test/live switch after an attempt starts", async () => {
		const s = await setup();
		await s.begin();
		for (const change of [{ platformAccountId: OTHER_ACCOUNT }, { livemode: true }]) {
			await expect(
				s.admin.mutation(api.platform.beginStripeConnectAccount, { ...s.beginArgs, ...change }),
			).rejects.toThrow("environment");
		}
	});

	test("concurrent identical binds are idempotent and different IDs cannot replace the winner", async () => {
		const s = await setup();
		const prepared = await s.begin();
		const args = {
			...s.beginArgs,
			attemptId: prepared.attempt.id,
			stripeConnectedAccountId: ACCOUNT,
		};
		const results = await Promise.all([
			s.admin.mutation(api.platform.bindStripeConnectAccount, args),
			s.admin.mutation(api.platform.bindStripeConnectAccount, args),
		]);
		expect(results).toEqual([
			{ stripeConnectedAccountId: ACCOUNT },
			{ stripeConnectedAccountId: ACCOUNT },
		]);
		await expect(
			s.admin.mutation(api.platform.bindStripeConnectAccount, {
				...args,
				stripeConnectedAccountId: OTHER_ACCOUNT,
			}),
		).rejects.toThrow("conflicts");
		expect((await s.begin()).stripeConnectedAccountId).toBe(ACCOUNT);
	});

	test("only one competing account ID can bind to a client", async () => {
		const s = await setup();
		const prepared = await s.begin();
		const results = await Promise.allSettled(
			[ACCOUNT, OTHER_ACCOUNT].map((stripeConnectedAccountId) =>
				s.admin.mutation(api.platform.bindStripeConnectAccount, {
					...s.beginArgs,
					attemptId: prepared.attempt.id,
					stripeConnectedAccountId,
				}),
			),
		);
		expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
		expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
	});

	test("one Stripe account cannot belong to two clients, even under concurrent binds", async () => {
		const s = await setup();
		const secondId = await s.admin.mutation(api.platform.createClient, input("second.example"));
		const attempts = await Promise.all([
			s.begin(),
			s.admin.mutation(api.platform.beginStripeConnectAccount, {
				...s.beginArgs,
				clientId: secondId,
			}),
		]);
		const results = await Promise.allSettled(
			attempts.map((prepared) =>
				s.admin.mutation(api.platform.bindStripeConnectAccount, {
					...s.beginArgs,
					clientId: prepared.clientId,
					attemptId: prepared.attempt.id,
					stripeConnectedAccountId: ACCOUNT,
				}),
			),
		);
		expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
		expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
	});

	test("rejects stale, untrusted, malformed, and platform-account binding", async () => {
		const s = await setup();
		const prepared = await s.begin();
		const args = {
			...s.beginArgs,
			attemptId: prepared.attempt.id,
			stripeConnectedAccountId: ACCOUNT,
		};
		for (const change of [
			{ attemptId: "stale-attempt" },
			{ platformAccountId: OTHER_ACCOUNT },
			{ livemode: true },
			{ stripeConnectedAccountId: "bad-account" },
			{ stripeConnectedAccountId: PLATFORM },
			{ webhookSecret: "wrong" },
		]) {
			await expect(
				s.admin.mutation(api.platform.bindStripeConnectAccount, { ...args, ...change }),
			).rejects.toThrow();
		}
		await expect(s.client.mutation(api.platform.bindStripeConnectAccount, args)).rejects.toThrow(
			"Not authorized",
		);
		expect((await s.begin()).stripeConnectedAccountId).toBeNull();
	});

	test("generic client writes and retired assignment endpoints cannot bypass verification", async () => {
		const s = await setup();
		await expect(
			s.admin.mutation(api.platform.createClient, {
				...input("unverified.example"),
				stripeConnectedAccountId: ACCOUNT,
			}),
		).rejects.toThrow("verified onboarding");
		await expect(
			s.admin.mutation(api.platform.updateClient, {
				clientId: s.clientId,
				stripeConnectedAccountId: ACCOUNT,
			}),
		).rejects.toThrow("verified onboarding");
		await expect(
			s.admin.mutation(api.platform.updateStripeConnectedAccount, {
				siteUrl: "client.example",
				stripeConnectedAccountId: ACCOUNT,
			}),
		).rejects.toThrow("verified onboarding");
		await expect(
			s.t.mutation(internal.platform.seedClient, {
				...input("unverified.example"),
				stripeConnectedAccountId: ACCOUNT,
			}),
		).rejects.toThrow("verified onboarding");
		await expect(
			s.t.mutation(internal.platform.setStripeConnectedAccount, {
				siteUrl: "client.example",
				stripeConnectedAccountId: ACCOUNT,
			}),
		).rejects.toThrow("verified onboarding");
	});

	test("rejects an unexplained pre-existing account mapping rather than silently adopting it", async () => {
		const s = await setup();
		await s.t.run(
			async (ctx) => await ctx.db.patch(s.clientId, { stripeConnectedAccountId: ACCOUNT }),
		);
		await expect(s.begin()).rejects.toThrow("no verified creation attempt");
	});
});
