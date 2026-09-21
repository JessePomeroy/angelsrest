/// <reference types="vite/client" />
import { ConvexHttpClient } from "convex/browser";
import { convexTest } from "convex-test";
import type Stripe from "stripe";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { resolveCommerceTenant, resolveStoredCommerceTenant } from "$lib/server/commerceTenant";
import { consumeCheckoutSessionAdmission } from "../../../../packages/crm-api/convex/commerceClosure";
import schema from "../../../../packages/crm-api/convex/schema";

const modules = import.meta.glob("../../../../packages/crm-api/convex/**/*.ts");
const SECRET = "alias-payment-synthetic-secret";
const TENANT = "tenant_05eb6092-5d8c-43ce-ad26-1a59522bd07b";
const ACCOUNT = "acct_original123456789";
const SITE = "client.example";
const SESSION = "cs_test_alias1234567890";
vi.mock("$env/dynamic/private", () => ({
	env: { WEBHOOK_SECRET: "alias-payment-synthetic-secret" },
}));
beforeEach(() => vi.stubEnv("WEBHOOK_SECRET", SECRET));
afterEach(() => vi.unstubAllEnvs());

async function setup(siteUrl: string) {
	const t = convexTest(schema, modules);
	const convex = new ConvexHttpClient("https://synthetic.invalid");
	vi.spyOn(convex, "query").mockImplementation((...args: Parameters<ConvexHttpClient["query"]>) =>
		t.query(args[0], args[1]),
	);
	await t.run(async (ctx) => {
		const clientId = await ctx.db.insert("platformClients", {
			tenantId: TENANT,
			siteUrl,
			name: "Client",
			email: "owner@example.invalid",
			adminEmails: [],
			tier: "full",
			subscriptionStatus: "active",
		});
		await ctx.db.insert("tenantAliases", {
			tenantId: TENANT,
			kind: "domain",
			value: SITE,
			verifiedAt: Date.now(),
			verificationMethod: "operator",
		});
		await ctx.db.insert("stripeAccountBindings", {
			stripeConnectedAccountId: ACCOUNT,
			clientId,
			tenantId: TENANT,
			attemptId: "original-attempt",
			platformAccountId: "acct_platform1234567890",
			livemode: false,
			boundAt: Date.now(),
		});
		await ctx.db.insert("checkoutSessionAdmissions", {
			protocolVersion: 1,
			tenantId: TENANT,
			siteUrl: SITE,
			accountScope: `connected:${ACCOUNT}`,
			stripeConnectedAccountId: ACCOUNT,
			attemptDigest: "a".repeat(64),
			proofClass: "signed_bridge_body",
			admissionHandleHash: "b".repeat(64),
			hostGeneration: 1,
			admissionGeneration: 1,
			state: "bound",
			requestFingerprint: "c".repeat(64),
			stripeSessionId: SESSION,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
	});
	return { t, convex };
}

test.each([
	"https://www.client.example/",
	"https://www.renamed.example/",
])("paid intake retains its admission partition when the current client URL is %s", async (storedSite) => {
	const { t, convex } = await setup(storedSite);
	const event = {
		type: "checkout.session.completed",
		account: ACCOUNT,
		data: {
			object: { id: SESSION, metadata: { commerceTenantId: TENANT, commerceTenantSiteUrl: SITE } },
		},
	} as unknown as Stripe.CheckoutSessionCompletedEvent;
	const resolved = await resolveCommerceTenant(event, convex, SITE, TENANT);
	expect(resolved.notificationProfile.siteUrl).toBe(storedSite);
	await expect(
		t.run((ctx) =>
			consumeCheckoutSessionAdmission(ctx, {
				siteUrl: resolved.siteUrl,
				stripeConnectedAccountId: ACCOUNT,
				stripeSessionId: SESSION,
				candidate: { version: 1, handleHash: "b".repeat(64) },
			}),
		),
	).resolves.toMatchObject({ siteUrl: SITE, stripeConnectedAccountId: ACCOUNT });
});

test("saved-order recovery keeps its original partition and account after a rename and detachment", async () => {
	const { convex } = await setup("https://www.renamed.example/");
	const original = { siteUrl: SITE, tenantId: TENANT, stripeConnectedAccountId: ACCOUNT };
	await expect(resolveStoredCommerceTenant(original, convex)).resolves.toMatchObject({
		siteUrl: SITE,
		tenantId: TENANT,
		stripeRequestOptions: { stripeAccount: ACCOUNT },
	});
	await expect(
		resolveStoredCommerceTenant({ ...original, siteUrl: "foreign.example" }, convex),
	).rejects.toThrow("identity does not match");
});
