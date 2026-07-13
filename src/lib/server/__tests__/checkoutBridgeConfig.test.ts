import { describe, expect, it } from "vitest";
import {
	getCheckoutBridgeTenantConfig,
	parseCheckoutBridgeTenantRegistry,
} from "../checkoutBridgeConfig";

const PRIMARY_SECRET = "p".repeat(32);
const LEGACY_SECRET = "l".repeat(32);

function registry(
	overrides: Record<string, unknown> = {},
	additionalTenants: Record<string, unknown> = {},
) {
	return JSON.stringify({
		"zippymiggy.com": {
			secrets: [PRIMARY_SECRET],
			redirectOrigins: ["https://reflecting-pool.vercel.app", "https://margarethelena.com"],
			...overrides,
		},
		...additionalTenants,
	});
}

describe("checkout bridge tenant registry", () => {
	it("resolves a configured tenant and scopes the migration secret to that tenant", () => {
		expect(
			getCheckoutBridgeTenantConfig("zippymiggy.com", registry(), LEGACY_SECRET, "zippymiggy.com"),
		).toEqual({
			secrets: [PRIMARY_SECRET, LEGACY_SECRET],
			redirectOrigins: ["https://reflecting-pool.vercel.app", "https://margarethelena.com"],
		});
		expect(
			getCheckoutBridgeTenantConfig(
				"future-client.com",
				registry(),
				LEGACY_SECRET,
				"zippymiggy.com",
			),
		).toBeNull();
	});

	it("does not grant the legacy secret to another configured tenant", () => {
		const futureSecret = "f".repeat(32);
		const twoTenantRegistry = registry(
			{},
			{
				"future-client.com": {
					secrets: [futureSecret],
					redirectOrigins: ["https://future-client.com"],
				},
			},
		);
		expect(
			getCheckoutBridgeTenantConfig(
				"future-client.com",
				twoTenantRegistry,
				LEGACY_SECRET,
				"zippymiggy.com",
			),
		).toEqual({
			secrets: [futureSecret],
			redirectOrigins: ["https://future-client.com"],
		});
	});

	it("fails closed for missing, malformed, or empty registries", () => {
		expect(() => parseCheckoutBridgeTenantRegistry(undefined)).toThrow("not configured");
		expect(() => parseCheckoutBridgeTenantRegistry("not-json")).toThrow("invalid JSON");
		expect(() => parseCheckoutBridgeTenantRegistry("{}")).toThrow("tenant count");
	});

	it("requires bounded secrets and explicit HTTPS origins", () => {
		expect(() =>
			getCheckoutBridgeTenantConfig("zippymiggy.com", registry(), LEGACY_SECRET),
		).toThrow("LEGACY_SITE_URL");
		expect(() => parseCheckoutBridgeTenantRegistry(registry({ secrets: ["short"] }))).toThrow(
			"Invalid checkout bridge secret",
		);
		expect(() =>
			parseCheckoutBridgeTenantRegistry(
				registry({ redirectOrigins: ["https://example.com/path"] }),
			),
		).toThrow("must be origins");
		expect(() =>
			parseCheckoutBridgeTenantRegistry(registry({ redirectOrigins: ["http://example.com"] })),
		).toThrow("must use HTTPS");
		expect(() =>
			getCheckoutBridgeTenantConfig(
				"zippymiggy.com",
				registry({ secrets: [PRIMARY_SECRET, "s".repeat(32)] }),
				LEGACY_SECRET,
				"zippymiggy.com",
			),
		).toThrow("too many active secrets");
	});
});
