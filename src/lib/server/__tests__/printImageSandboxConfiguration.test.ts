import { beforeEach, expect, test, vi } from "vitest";

const { env } = vi.hoisted(() => ({ env: {} as Record<string, string> }));
vi.mock("$env/dynamic/private", () => ({ env }));
vi.mock("$lib/server/catalogCommerceClients", () => ({
	issueTenantPrintSourceCapability: vi.fn(),
}));

import { sandboxDiagnosticConfiguration } from "../printImageSandboxDiagnostic";

beforeEach(() => {
	for (const key of Object.keys(env)) delete env[key];
	Object.assign(env, {
		LUMAPRINTS_API_KEY: "production-key",
		LUMAPRINTS_API_SECRET: "production-secret",
		LUMAPRINTS_STORE_ID: "83765",
		LUMAPRINTS_USE_SANDBOX: "false",
		LUMAPRINTS_SANDBOX_API_KEY: "sandbox-key",
		LUMAPRINTS_SANDBOX_API_SECRET: "sandbox-secret",
		LUMAPRINTS_SANDBOX_STORE_ID: "84630",
	});
});

test("sandbox uses only dedicated credentials and a fixed sandbox origin", () => {
	expect(sandboxDiagnosticConfiguration()).toEqual({
		baseUrl: "https://us.api-sandbox.lumaprints.com",
		apiKey: "sandbox-key",
		apiSecret: "sandbox-secret",
		storeId: 84630,
	});
});

test.each([
	"API_KEY",
	"API_SECRET",
	"STORE_ID",
])("missing sandbox %s never falls back to production", (suffix) => {
	delete env[`LUMAPRINTS_SANDBOX_${suffix}`];
	expect(() => sandboxDiagnosticConfiguration()).toThrow("Sandbox diagnostic is not configured");
});

test.each([
	"0",
	"-1",
	"1.5",
	"9007199254740993",
	"84630extra",
])("invalid sandbox store fails closed: %s", (store) => {
	env.LUMAPRINTS_SANDBOX_STORE_ID = store;
	expect(() => sandboxDiagnosticConfiguration()).toThrow();
});

test.each(["API_KEY", "API_SECRET"])("reusing production %s fails closed", (suffix) => {
	env[`LUMAPRINTS_SANDBOX_${suffix}`] = env[`LUMAPRINTS_${suffix}`];
	expect(() => sandboxDiagnosticConfiguration()).toThrow();
});
