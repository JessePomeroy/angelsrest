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
	});
});
