import { describe, expect, test, vi } from "vitest";
import {
	providerMultiInvestigationChildEnvironment,
	providerMultiInvestigationCliArguments,
	providerMultiInvestigationConfiguration,
	readProviderMultiInvestigationTargets,
	runProviderMultiInvestigationCaller,
} from "./providerMultiInvestigationCaller";

const operationId = "fixed-operation";
const convexUrl = "https://deployment.convex.cloud";
const externalIds = ["cs_live_1234567890abcdef", "cs_live_1234567890abcdeg"];
const environment = {
	ORDER_RESET_PROVIDER_MULTI_INVESTIGATION_ID: operationId,
	ORDER_PRODUCERS_STATE: "closed",
	PUBLIC_CONVEX_URL: convexUrl,
	LUMAPRINTS_USE_SANDBOX: "false",
	LUMAPRINTS_API_KEY: "key",
	LUMAPRINTS_API_SECRET: "secret",
	LUMAPRINTS_STORE_ID: "42",
};

describe("multi-target provider investigation caller", () => {
	test("requires the exact closed Production provider configuration", () => {
		expect(providerMultiInvestigationConfiguration(environment, operationId, convexUrl)).toEqual({
			apiKey: "key",
			apiSecret: "secret",
			storeId: 42,
			baseUrl: "https://us.api.lumaprints.com",
		});
		for (const [name, value] of [
			["ORDER_RESET_PROVIDER_MULTI_INVESTIGATION_ID", "wrong"],
			["ORDER_PRODUCERS_STATE", "open"],
			["ORDER_PRODUCERS_STATE", " closed "],
			["PUBLIC_CONVEX_URL", "https://other.convex.cloud"],
			["LUMAPRINTS_USE_SANDBOX", "true"],
			["LUMAPRINTS_API_KEY", undefined],
			["LUMAPRINTS_API_SECRET", undefined],
			["LUMAPRINTS_STORE_ID", "0"],
			["LUMAPRINTS_STORE_ID", "42.0"],
		] as const) {
			expect(
				providerMultiInvestigationConfiguration(
					{ ...environment, [name]: value },
					operationId,
					convexUrl,
				),
			).toBeNull();
		}
	});

	test("pins the internal function and deployment and sanitizes the child environment", async () => {
		expect(providerMultiInvestigationCliArguments("loyal-swan-967")).toEqual([
			"run",
			"orderReset:providerMultiInvestigationTargets",
			"{}",
			"--deployment",
			"loyal-swan-967",
			"--typecheck",
			"disable",
			"--codegen",
			"disable",
		]);
		const childSource = {
			HOME: "/home/operator",
			PATH: "/bin",
			XDG_CONFIG_HOME: "/config",
			XDG_CACHE_HOME: "/cache",
			LUMAPRINTS_API_SECRET: "must-not-pass",
			WEBHOOK_SECRET: "must-not-pass",
		};
		expect(providerMultiInvestigationChildEnvironment(childSource)).toEqual({
			HOME: "/home/operator",
			PATH: "/bin",
			XDG_CONFIG_HOME: "/config",
			XDG_CACHE_HOME: "/cache",
			NO_COLOR: "1",
		});
		const execute = vi.fn().mockResolvedValue({
			stdout: `  ${JSON.stringify({ outcome: "ready", externalIds })}\n`,
		});
		await expect(
			readProviderMultiInvestigationTargets({
				execute,
				convexBinary: "/repo/node_modules/.bin/convex",
				crmDirectory: "/repo/packages/crm-api",
				deployment: "loyal-swan-967",
				environment: childSource,
			}),
		).resolves.toBe(JSON.stringify({ outcome: "ready", externalIds }));
		expect(execute).toHaveBeenCalledWith(
			"/repo/node_modules/.bin/convex",
			[...providerMultiInvestigationCliArguments("loyal-swan-967")],
			{
				cwd: "/repo/packages/crm-api",
				timeout: 30_000,
				maxBuffer: 32 * 1024,
				encoding: "utf8",
				env: providerMultiInvestigationChildEnvironment(childSource),
			},
		);
	});

	test("claims before configuration or reads and returns aggregate output only", async () => {
		const order: string[] = [];
		await expect(
			runProviderMultiInvestigationCaller({
				claimAttempt: async () => {
					order.push("claim");
					return true;
				},
				readTargets: async () => {
					order.push("read");
					return JSON.stringify({ outcome: "ready", externalIds });
				},
				environment,
				operationId,
				expectedConvexUrl: convexUrl,
				observeMatches: async (targets, configuration) => {
					order.push("observe");
					expect(targets).toEqual(externalIds);
					expect(configuration.storeId).toBe(42);
					return "some_observed";
				},
			}),
		).resolves.toBe("provider_multi_investigation:some_observed");
		expect(order).toEqual(["claim", "read", "observe", "read"]);
	});

	test("does not read when marker or configuration fails", async () => {
		const readTargets = vi.fn();
		await expect(
			runProviderMultiInvestigationCaller({
				claimAttempt: async () => false,
				readTargets,
				environment,
				operationId,
				expectedConvexUrl: convexUrl,
			}),
		).resolves.toBe("provider_multi_investigation:operation_unavailable");
		expect(readTargets).not.toHaveBeenCalled();
		await expect(
			runProviderMultiInvestigationCaller({
				claimAttempt: async () => true,
				readTargets,
				environment: { ...environment, ORDER_PRODUCERS_STATE: "open" },
				operationId,
				expectedConvexUrl: convexUrl,
			}),
		).resolves.toBe("provider_multi_investigation:configuration_error");
		expect(readTargets).not.toHaveBeenCalled();
	});
});
