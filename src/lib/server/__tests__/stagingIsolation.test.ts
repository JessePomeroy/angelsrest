import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { LumaPrintsConnection } from "../lumaprintsConnections";

const { privateEnv, publicEnv } = vi.hoisted(() => ({
	privateEnv: {} as Record<string, string | undefined>,
	publicEnv: {} as Record<string, string | undefined>,
}));
vi.mock("$env/dynamic/private", () => ({ env: privateEnv }));
vi.mock("$env/dynamic/public", () => ({ env: publicEnv }));

beforeEach(() => {
	vi.resetModules();
	for (const key of Object.keys(privateEnv)) delete privateEnv[key];
	Object.assign(publicEnv, {
		PUBLIC_SITE_URL: "https://staging.angelsrest.online",
		PUBLIC_CONVEX_URL: "https://rosy-firefly-366.convex.cloud",
		PUBLIC_CONVEX_SITE_URL: "https://rosy-firefly-366.convex.site",
	});
});
afterEach(() => vi.unstubAllGlobals());

test.each([
	"PUBLIC_SITE_URL",
	"PUBLIC_CONVEX_URL",
	"PUBLIC_CONVEX_SITE_URL",
])("a partial staging configuration fails closed: %s", async (key) => {
	delete publicEnv[key];
	const { isStagingEnvironment } = await import("../runtimeConfig");
	expect(() => isStagingEnvironment()).toThrow("Staging isolation");
});

test("staging rejects live payment keys and live supplier endpoints", async () => {
	const { getStripeSecretKey, getLumaPrintsRuntimeConfig } = await import("../runtimeConfig");
	privateEnv.STRIPE_SECRET_KEY = "sk_live_synthetic_fixture";
	expect(() => getStripeSecretKey()).toThrow("Staging Stripe sandbox");
	privateEnv.STRIPE_SECRET_KEY = "sk_test_synthetic_fixture";
	expect(getStripeSecretKey()).toBe(privateEnv.STRIPE_SECRET_KEY);
	Object.assign(privateEnv, {
		LUMAPRINTS_STORE_ID: "123",
		LUMAPRINTS_API_KEY: "fixture-key",
		LUMAPRINTS_API_SECRET: "fixture-secret",
		LUMAPRINTS_USE_SANDBOX: "false",
	});
	expect(() => getLumaPrintsRuntimeConfig()).toThrow("Staging LumaPrints sandbox");
	privateEnv.LUMAPRINTS_USE_SANDBOX = "true";
	expect(getLumaPrintsRuntimeConfig().baseUrl).toBe("https://us.api-sandbox.lumaprints.com");
});

test("slash-suffixed staging origins retain every provider guard", async () => {
	for (const key of Object.keys(publicEnv)) publicEnv[key] += "/";
	Object.assign(privateEnv, {
		STRIPE_SECRET_KEY: "sk_live_synthetic_fixture",
		RESEND_API_KEY: "re_unrestricted_fixture",
		LUMAPRINTS_STORE_ID: "123",
		LUMAPRINTS_USE_SANDBOX: "false",
	});
	const config = await import("../runtimeConfig");
	expect(config.isStagingEnvironment()).toBe(true);
	expect(() => config.getStripeSecretKey()).toThrow("Staging Stripe sandbox");
	expect(() => config.getResendApiKey()).toThrow("Staging CRM email");
	expect(() => config.getLumaPrintsRuntimeConfig()).toThrow("Staging LumaPrints sandbox");
});

test.each([
	"uppercase",
	"default-port",
	"dns-dot",
	"http",
	"path",
	"credentials",
])("noncanonical staging URLs cannot fall back to production: %s", async (variant) => {
	for (const key of Object.keys(publicEnv)) {
		const value = publicEnv[key];
		if (!value) throw new Error("Expected staging fixture URL");
		const url = new URL(value);
		publicEnv[key] =
			variant === "uppercase"
				? value.toUpperCase()
				: variant === "default-port"
					? `${value}:443`
					: variant === "dns-dot"
						? `${value}.`
						: variant === "http"
							? value.replace("https:", "http:")
							: variant === "path"
								? `${value}/unrelated`
								: `https://user@${url.host}`;
	}
	const { isStagingEnvironment } = await import("../runtimeConfig");
	expect(() => isStagingEnvironment()).toThrow("Staging isolation");
});

test("dedicated supplier connections reject live endpoints before fetch and retain sandbox access", async () => {
	const connection: LumaPrintsConnection = {
		version: 1,
		connectionRef: "lp_staging_fixture",
		tenantId: "tenant_11111111-1111-4111-8111-111111111111",
		storeId: 123,
		environment: "production",
	};
	const register = (entry: LumaPrintsConnection) => {
		privateEnv.LUMAPRINTS_CONNECTIONS = JSON.stringify({
			version: 1,
			connections: [{ ...entry, credentialRef: "STAGING" }],
		});
	};
	Object.assign(privateEnv, {
		LUMAPRINTS_CONNECTION_STAGING_API_KEY: "synthetic-key",
		LUMAPRINTS_CONNECTION_STAGING_API_SECRET: "synthetic-secret",
		LUMAPRINTS_USE_SANDBOX: "true",
	});
	const fetcher = vi.fn<typeof fetch>(async () =>
		Response.json([{ storeId: 123, storeName: "Synthetic store" }]),
	);
	vi.stubGlobal("fetch", fetcher);
	const { createLumaPrintsClient } = await import("../lumaprints");
	const { configuredLumaPrintsConnectionsForTenant } = await import("../lumaprintsConnections");
	register(connection);
	expect(() => createLumaPrintsClient(connection)).toThrow();
	expect(() => configuredLumaPrintsConnectionsForTenant(connection.tenantId)).toThrow();
	expect(fetcher).not.toHaveBeenCalled();
	const sandbox = { ...connection, environment: "sandbox" as const };
	register(sandbox);
	await createLumaPrintsClient(sandbox).verifyStoreAccess();
	expect(fetcher).toHaveBeenCalledExactlyOnceWith(
		"https://us.api-sandbox.lumaprints.com/api/v1/stores",
		expect.any(Object),
	);
});

test("staging has no fallback to unrestricted mail credentials", async () => {
	privateEnv.RESEND_API_KEY = "re_unrestricted_fixture";
	const { getResendApiKey } = await import("../runtimeConfig");
	const { getResend } = await import("../resendClient");
	expect(() => getResendApiKey()).toThrow("Staging CRM email");
	expect(() => getResend()).toThrow("Staging email");
});

test("real SDK sends only to the test recipient and retains the receipt idempotency key", async () => {
	privateEnv.STAGING_RESEND_API_KEY = "re_staging_fixture";
	const fetcher = vi.fn<typeof fetch>(async () => Response.json({ id: "test-email-id" }));
	vi.stubGlobal("fetch", fetcher);
	const { getResend } = await import("../resendClient");
	const client = getResend();
	const message = {
		from: "sender@example.invalid",
		to: ["buyer@example.invalid"],
		cc: ["copy@example.invalid"],
		bcc: ["hidden@example.invalid"],
		replyTo: "reply@example.invalid",
		subject: "Fixture receipt",
		html: "<p>Synthetic order</p>",
	};
	expect(await client.emails.send(message, { idempotencyKey: "fixture-receipt" })).toMatchObject({
		data: { id: "test-email-id" },
		error: null,
	});
	expect(fetcher).toHaveBeenCalledOnce();
	const [url, options] = fetcher.mock.calls[0];
	expect(url).toBe("https://api.resend.com/emails");
	expect(JSON.parse(String(options?.body))).toEqual({
		from: "Angel's Rest staging <staging@angelsrest.online>",
		to: ["delivered@resend.dev"],
		subject: message.subject,
		html: message.html,
	});
	expect(new Headers(options?.headers).get("Idempotency-Key")).toBe("fixture-receipt");
	expect(new Headers(options?.headers).get("Authorization")).toBe("Bearer re_staging_fixture");
	expect(message.to).toEqual(["buyer@example.invalid"]);
	await expect(client.batch.send([message])).rejects.toThrow("Staging email transport");
	await expect(client.emails.get("unrelated-id")).rejects.toThrow("Staging email transport");
	expect(fetcher).toHaveBeenCalledOnce();
});

test("production keeps its configured sender and recipients", async () => {
	Object.assign(publicEnv, {
		PUBLIC_SITE_URL: "https://www.angelsrest.online",
		PUBLIC_CONVEX_URL: "https://loyal-swan-967.convex.cloud",
		PUBLIC_CONVEX_SITE_URL: "https://loyal-swan-967.convex.site",
	});
	privateEnv.RESEND_API_KEY = "re_production_fixture";
	privateEnv.STRIPE_SECRET_KEY = "sk_live_synthetic_fixture";
	const fetcher = vi.fn<typeof fetch>(async () => Response.json({ id: "test-email-id" }));
	vi.stubGlobal("fetch", fetcher);
	const { getResend } = await import("../resendClient");
	const { getStripeSecretKey, isStagingEnvironment } = await import("../runtimeConfig");
	expect(isStagingEnvironment()).toBe(false);
	expect(getStripeSecretKey()).toBe(privateEnv.STRIPE_SECRET_KEY);
	const message = {
		from: "sender@example.invalid",
		to: "recipient@example.invalid",
		subject: "Fixture",
		html: "<p>Fixture</p>",
	};
	await getResend().emails.send(message);
	expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual(message);
});
