import { beforeEach, describe, expect, it, vi } from "vitest";

const { privateEnv, publicEnv } = vi.hoisted(() => ({
	privateEnv: {} as Record<string, string | undefined>,
	publicEnv: {} as Record<string, string | undefined>,
}));

vi.mock("$env/dynamic/private", () => ({ env: privateEnv }));
vi.mock("$env/dynamic/public", () => ({ env: publicEnv }));

describe("server runtime configuration", () => {
	beforeEach(() => {
		for (const key of Object.keys(privateEnv)) delete privateEnv[key];
		for (const key of Object.keys(publicEnv)) delete publicEnv[key];
	});

	it("imports without configuration and fails only when an integration is requested", async () => {
		const config = await import("$lib/server/runtimeConfig");
		expect(() => config.getStripeSecretKey()).toThrow("Stripe is not configured");
		expect(() => config.getResendApiKey()).toThrow("Resend is not configured");
		expect(() => config.getConvexUrl()).toThrow("Convex is not configured");
	});

	it("returns canonical public origins without exposing invalid configuration", async () => {
		publicEnv.PUBLIC_SITE_URL = "https://www.angelsrest.online/";
		publicEnv.PUBLIC_CONVEX_URL = "https://example.convex.cloud";
		const config = await import("$lib/server/runtimeConfig");
		expect(config.getPublicSiteOrigin()).toBe("https://www.angelsrest.online");
		expect(config.getConvexUrl()).toBe("https://example.convex.cloud");
		publicEnv.PUBLIC_SITE_URL = "https://user:secret@example.com";
		expect(() => config.getPublicSiteOrigin()).toThrow("Public site origin is not configured");
	});

	it("validates and freezes LumaPrints configuration at use time", async () => {
		Object.assign(privateEnv, {
			LUMAPRINTS_API_KEY: "key",
			LUMAPRINTS_API_SECRET: "secret",
			LUMAPRINTS_STORE_ID: "83765",
			LUMAPRINTS_USE_SANDBOX: "true",
		});
		const { getLumaPrintsRuntimeConfig } = await import("$lib/server/runtimeConfig");
		const config = getLumaPrintsRuntimeConfig();
		expect(config).toEqual({
			baseUrl: "https://us.api-sandbox.lumaprints.com",
			apiKey: "key",
			apiSecret: "secret",
			storeId: 83765,
		});
		expect(Object.isFrozen(config)).toBe(true);
		delete privateEnv.LUMAPRINTS_USE_SANDBOX;
		expect(() => getLumaPrintsRuntimeConfig()).toThrow("LumaPrints is not configured");
		privateEnv.LUMAPRINTS_USE_SANDBOX = "false";
		expect(getLumaPrintsRuntimeConfig().baseUrl).toBe("https://us.api.lumaprints.com");
	});

	it("selects CMS-media credentials by trusted tenant", async () => {
		publicEnv.PUBLIC_SITE_URL = "https://www.angelsrest.online";
		privateEnv.CMS_MEDIA_WORKER_SECRET = "hub-secret";
		privateEnv.CATALOG_PRINT_SOURCE_ISSUER_SECRET = "hub-issuer";
		privateEnv.CMS_MEDIA_WORKER_TENANT_SECRETS = JSON.stringify({
			"client.example": ["c".repeat(32)],
		});
		privateEnv.CATALOG_PRINT_SOURCE_ISSUER_TENANT_SECRETS = JSON.stringify({
			"client.example": ["i".repeat(32)],
		});
		const { getCatalogPrintSourceIssuerSecret, getCmsMediaTenantSecret } = await import(
			"$lib/server/runtimeConfig"
		);

		expect(getCmsMediaTenantSecret("angelsrest.online")).toBe("hub-secret");
		expect(getCmsMediaTenantSecret("client.example")).toBe("c".repeat(32));
		expect(getCatalogPrintSourceIssuerSecret("angelsrest.online")).toBe("hub-issuer");
		expect(getCatalogPrintSourceIssuerSecret("client.example")).toBe("i".repeat(32));
		expect(() => getCmsMediaTenantSecret("unknown.example")).toThrow("CMS media is not configured");
		expect(() => getCatalogPrintSourceIssuerSecret("unknown.example")).toThrow(
			"Print source issuer is not configured",
		);
		privateEnv.CATALOG_PRINT_SOURCE_ISSUER_TENANT_SECRETS = JSON.stringify({
			"client.example": ["i".repeat(32), "i".repeat(32)],
		});
		expect(() => getCatalogPrintSourceIssuerSecret("client.example")).toThrow(
			"Print source issuer is not configured",
		);
	});

	it("rejects credential reuse across tenants, rotations, and Worker roles", async () => {
		publicEnv.PUBLIC_SITE_URL = "https://angelsrest.online";
		privateEnv.CMS_MEDIA_WORKER_SECRET = "u".repeat(32);
		privateEnv.CATALOG_PRINT_SOURCE_ISSUER_SECRET = "i".repeat(32);
		privateEnv.CMS_MEDIA_WORKER_TENANT_SECRETS = JSON.stringify({
			"a.example": ["a".repeat(32), "p".repeat(32)],
			"b.example": ["b".repeat(32)],
		});
		privateEnv.CATALOG_PRINT_SOURCE_ISSUER_TENANT_SECRETS = JSON.stringify({
			"a.example": ["x".repeat(32)],
			"b.example": ["p".repeat(32)],
		});
		const { getCatalogPrintSourceIssuerSecret } = await import("$lib/server/runtimeConfig");

		expect(() => getCatalogPrintSourceIssuerSecret("a.example")).toThrow(
			"Print source issuer is not configured",
		);
		privateEnv.CATALOG_PRINT_SOURCE_ISSUER_TENANT_SECRETS = JSON.stringify({
			"a.example": ["x".repeat(32)],
			"b.example": ["i".repeat(32)],
		});
		expect(() => getCatalogPrintSourceIssuerSecret("a.example")).toThrow(
			"Print source issuer is not configured",
		);
		privateEnv.CATALOG_PRINT_SOURCE_ISSUER_TENANT_SECRETS = JSON.stringify({
			"a.example": ["u".repeat(32)],
		});
		expect(() => getCatalogPrintSourceIssuerSecret("a.example")).toThrow(
			"Print source issuer is not configured",
		);
	});
});
