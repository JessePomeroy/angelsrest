import { describe, expect, it } from "vitest";
import {
	getCheckoutBridgeTenantConfig,
	parseCheckoutBridgeTenantRegistry,
} from "../checkoutBridgeConfig";

const PRIMARY_SECRET = "p".repeat(32);

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
	it("resolves only the configured tenant authority", () => {
		expect(getCheckoutBridgeTenantConfig("zippymiggy.com", registry())).toEqual({
			secrets: [PRIMARY_SECRET],
			redirectOrigins: ["https://reflecting-pool.vercel.app", "https://margarethelena.com"],
		});
		expect(getCheckoutBridgeTenantConfig("future-client.com", registry())).toBeNull();
	});

	it("keeps configured tenant secrets isolated", () => {
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
		expect(getCheckoutBridgeTenantConfig("future-client.com", twoTenantRegistry)).toEqual({
			secrets: [futureSecret],
			redirectOrigins: ["https://future-client.com"],
		});
		expect(getCheckoutBridgeTenantConfig("zippymiggy.com", twoTenantRegistry)?.secrets).toEqual([
			PRIMARY_SECRET,
		]);
	});

	it("fails closed for missing, malformed, or empty registries", () => {
		expect(() => parseCheckoutBridgeTenantRegistry(undefined)).toThrow("not configured");
		expect(() => parseCheckoutBridgeTenantRegistry("not-json")).toThrow("invalid JSON");
		expect(() => parseCheckoutBridgeTenantRegistry("{}")).toThrow("tenant count");
	});

	it("requires bounded secrets and explicit HTTPS origins", () => {
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
			parseCheckoutBridgeTenantRegistry(
				registry({ secrets: [PRIMARY_SECRET, "s".repeat(32), "t".repeat(32)] }),
			),
		).toThrow("Invalid checkout bridge secrets");
	});
});
