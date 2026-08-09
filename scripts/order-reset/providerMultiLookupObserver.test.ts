import { describe, expect, test, vi } from "vitest";
import {
	parseProviderMultiLookupObserverTargets,
	providerMultiLookupObserverChildEnvironment,
	providerMultiLookupObserverCliArguments,
	providerMultiLookupObserverConfiguration,
	readProviderMultiLookupObserverTargets,
	runProviderMultiLookupObserver,
} from "./providerMultiLookupObserver";

const operationId = "fixed-operation";
const convexUrl = "https://deployment.convex.cloud";
const externalIds = ["cs_live_1234567890abcdef", "cs_test_1234567890abcdeg"];
const readyTargets = JSON.stringify({ outcome: "ready", externalIds });
const environment = {
	ORDER_RESET_PROVIDER_MULTI_LOOKUP_OBSERVER_ID: operationId,
	ORDER_PRODUCERS_STATE: "closed",
	PUBLIC_CONVEX_URL: convexUrl,
	LUMAPRINTS_USE_SANDBOX: "false",
	LUMAPRINTS_API_KEY: "key",
	LUMAPRINTS_API_SECRET: "secret",
	LUMAPRINTS_STORE_ID: "42",
};

describe("multi-target lookup-eligible provider observer", () => {
	test("requires the exact closed Production provider configuration", () => {
		expect(providerMultiLookupObserverConfiguration(environment, operationId, convexUrl)).toEqual({
			apiKey: "key",
			apiSecret: "secret",
			storeId: 42,
			baseUrl: "https://us.api.lumaprints.com",
		});
		for (const [name, value] of [
			["ORDER_RESET_PROVIDER_MULTI_LOOKUP_OBSERVER_ID", undefined],
			["ORDER_RESET_PROVIDER_MULTI_LOOKUP_OBSERVER_ID", "wrong"],
			["ORDER_PRODUCERS_STATE", undefined],
			["ORDER_PRODUCERS_STATE", "open"],
			["ORDER_PRODUCERS_STATE", " closed "],
			["PUBLIC_CONVEX_URL", undefined],
			["PUBLIC_CONVEX_URL", "https://other.convex.cloud"],
			["LUMAPRINTS_USE_SANDBOX", "true"],
			["LUMAPRINTS_USE_SANDBOX", ""],
			["LUMAPRINTS_API_KEY", undefined],
			["LUMAPRINTS_API_SECRET", undefined],
			["LUMAPRINTS_STORE_ID", undefined],
			["LUMAPRINTS_STORE_ID", "0"],
			["LUMAPRINTS_STORE_ID", "42.0"],
		] as const) {
			expect(
				providerMultiLookupObserverConfiguration(
					{ ...environment, [name]: value },
					operationId,
					convexUrl,
				),
			).toBeNull();
		}
	});

	test("pins the private selector and deployment while withholding provider secrets", async () => {
		expect(providerMultiLookupObserverCliArguments("loyal-swan-967")).toEqual([
			"run",
			"orderReset:providerMultiLookupEligibleTargets",
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
			LUMAPRINTS_API_KEY: "must-not-pass",
			LUMAPRINTS_API_SECRET: "must-not-pass",
			LUMAPRINTS_STORE_ID: "must-not-pass",
			WEBHOOK_SECRET: "must-not-pass",
			STRIPE_SECRET_KEY: "must-not-pass",
			VERCEL_TOKEN: "must-not-pass",
		};
		expect(providerMultiLookupObserverChildEnvironment(childSource)).toEqual({
			HOME: "/home/operator",
			PATH: "/bin",
			XDG_CONFIG_HOME: "/config",
			XDG_CACHE_HOME: "/cache",
			NO_COLOR: "1",
		});
		const execute = vi.fn().mockResolvedValue({ stdout: `  ${readyTargets}\n` });
		await expect(
			readProviderMultiLookupObserverTargets({
				execute,
				convexBinary: "/repo/node_modules/.bin/convex",
				crmDirectory: "/repo/packages/crm-api",
				deployment: "loyal-swan-967",
				environment: childSource,
			}),
		).resolves.toBe(readyTargets);
		expect(execute).toHaveBeenCalledWith(
			"/repo/node_modules/.bin/convex",
			[...providerMultiLookupObserverCliArguments("loyal-swan-967")],
			{
				cwd: "/repo/packages/crm-api",
				timeout: 30_000,
				maxBuffer: 16 * 1024,
				encoding: "utf8",
				env: providerMultiLookupObserverChildEnvironment(childSource),
			},
		);
	});

	test("accepts only exact bounded sorted test-or-live target carriers", () => {
		expect(parseProviderMultiLookupObserverTargets(readyTargets)).toEqual({
			outcome: "ready",
			externalIds,
		});
		for (const outcome of ["source_conflict", "target_conflict", "live_effect_conflict"] as const) {
			expect(parseProviderMultiLookupObserverTargets(JSON.stringify({ outcome }))).toEqual({
				outcome,
			});
		}
		const fifty = Array.from(
			{ length: 50 },
			(_, index) => `cs_test_${String(index).padStart(16, "0")}`,
		);
		expect(
			parseProviderMultiLookupObserverTargets(
				JSON.stringify({ outcome: "ready", externalIds: fifty }),
			),
		).toEqual({ outcome: "ready", externalIds: fifty });
		const boundaryIds = [`cs_live_${"A".repeat(120)}`, `cs_test_${"B".repeat(16)}`];
		expect(
			parseProviderMultiLookupObserverTargets(
				JSON.stringify({
					outcome: "ready",
					externalIds: boundaryIds,
				}),
			),
		).toEqual({ outcome: "ready", externalIds: boundaryIds });

		for (const invalid of [
			"not-json",
			"null",
			"[]",
			"{}",
			JSON.stringify({ outcome: "ready", externalIds: [externalIds[0]] }),
			JSON.stringify({ outcome: "ready", externalIds: [...externalIds].reverse() }),
			JSON.stringify({ outcome: "ready", externalIds: [externalIds[0], externalIds[0]] }),
			JSON.stringify({ outcome: "ready", externalIds: [externalIds[0], "invalid"] }),
			JSON.stringify({
				outcome: "ready",
				externalIds: [externalIds[0], `cs_test_${"A".repeat(15)}`],
			}),
			JSON.stringify({
				outcome: "ready",
				externalIds: [externalIds[0], `cs_test_${"A".repeat(121)}`],
			}),
			JSON.stringify({ outcome: "ready", externalIds, count: 2 }),
			JSON.stringify({ outcome: "source_conflict", error: "raw" }),
			JSON.stringify({
				outcome: "ready",
				externalIds: Array.from(
					{ length: 51 },
					(_, index) => `cs_test_${String(index).padStart(16, "0")}`,
				),
			}),
		])
			expect(() => parseProviderMultiLookupObserverTargets(invalid)).toThrow("invalid");
	});

	test.each([
		"all_observed",
		"some_observed",
		"none_observed",
		"inconclusive",
	] as const)("claims once, rechecks the exact array, and returns only aggregate %s", async (outcome) => {
		const order: string[] = [];
		const claimAttempt = vi.fn(async () => {
			order.push("claim");
			return true;
		});
		const readTargets = vi.fn(async () => {
			order.push("read");
			return readyTargets;
		});
		const observeMatches = vi.fn(async (targets) => {
			order.push("observe");
			expect(targets).toEqual(externalIds);
			return outcome;
		});
		await expect(
			runProviderMultiLookupObserver({
				claimAttempt,
				readTargets,
				environment,
				operationId,
				expectedConvexUrl: convexUrl,
				observeMatches,
			}),
		).resolves.toBe(`provider_multi_lookup_observer:${outcome}`);
		expect(order).toEqual(["claim", "read", "observe", "read"]);
		expect(claimAttempt).toHaveBeenCalledTimes(1);
		expect(readTargets).toHaveBeenCalledTimes(2);
		expect(observeMatches).toHaveBeenCalledTimes(1);
	});

	test.each([
		"source_conflict",
		"target_conflict",
		"live_effect_conflict",
	] as const)("returns normalized selector outcome %s without a provider read", async (outcome) => {
		const observeMatches = vi.fn();
		await expect(
			runProviderMultiLookupObserver({
				claimAttempt: async () => true,
				readTargets: async () => JSON.stringify({ outcome }),
				environment,
				operationId,
				expectedConvexUrl: convexUrl,
				observeMatches,
			}),
		).resolves.toBe(`provider_multi_lookup_observer:${outcome}`);
		expect(observeMatches).not.toHaveBeenCalled();
	});

	test("never reads targets or the provider when claim or configuration fails", async () => {
		for (const claimAttempt of [
			async () => false,
			async () => {
				throw new Error("raw claim failure");
			},
		]) {
			const readTargets = vi.fn();
			const observeMatches = vi.fn();
			await expect(
				runProviderMultiLookupObserver({
					claimAttempt,
					readTargets,
					environment,
					operationId,
					expectedConvexUrl: convexUrl,
					observeMatches,
				}),
			).resolves.toBe("provider_multi_lookup_observer:operation_unavailable");
			expect(readTargets).not.toHaveBeenCalled();
			expect(observeMatches).not.toHaveBeenCalled();
		}

		const readTargets = vi.fn();
		const observeMatches = vi.fn();
		await expect(
			runProviderMultiLookupObserver({
				claimAttempt: async () => true,
				readTargets,
				environment: { ...environment, ORDER_PRODUCERS_STATE: "open" },
				operationId,
				expectedConvexUrl: convexUrl,
				observeMatches,
			}),
		).resolves.toBe("provider_multi_lookup_observer:configuration_error");
		expect(readTargets).not.toHaveBeenCalled();
		expect(observeMatches).not.toHaveBeenCalled();
	});

	test("suppresses an observation whenever the exact target-array recheck changes or fails", async () => {
		for (const secondRead of [
			JSON.stringify({ outcome: "target_conflict" }),
			JSON.stringify({
				outcome: "ready",
				externalIds: [externalIds[0], "cs_test_1234567890abcdeh"],
			}),
			JSON.stringify({
				outcome: "ready",
				externalIds: [...externalIds, "cs_test_1234567890abcdeh"],
			}),
			JSON.stringify({ outcome: "ready", externalIds: [...externalIds].reverse() }),
			"not-json",
		] as const) {
			const readTargets = vi
				.fn()
				.mockResolvedValueOnce(readyTargets)
				.mockResolvedValueOnce(secondRead);
			await expect(
				runProviderMultiLookupObserver({
					claimAttempt: async () => true,
					readTargets,
					environment,
					operationId,
					expectedConvexUrl: convexUrl,
					observeMatches: async () => "all_observed",
				}),
			).resolves.toBe("provider_multi_lookup_observer:target_conflict");
		}

		const readTargets = vi
			.fn()
			.mockResolvedValueOnce(readyTargets)
			.mockRejectedValueOnce(new Error("raw Convex error"));
		await expect(
			runProviderMultiLookupObserver({
				claimAttempt: async () => true,
				readTargets,
				environment,
				operationId,
				expectedConvexUrl: convexUrl,
				observeMatches: async () => "none_observed",
			}),
		).resolves.toBe("provider_multi_lookup_observer:target_conflict");
	});

	test("normalizes initial target and provider failures without raw output", async () => {
		for (const readTargets of [
			async () => {
				throw new Error("raw Convex error");
			},
			async () => "not-json",
		]) {
			await expect(
				runProviderMultiLookupObserver({
					claimAttempt: async () => true,
					readTargets,
					environment,
					operationId,
					expectedConvexUrl: convexUrl,
				}),
			).resolves.toBe("provider_multi_lookup_observer:configuration_error");
		}

		const readTargets = vi.fn(async () => readyTargets);
		await expect(
			runProviderMultiLookupObserver({
				claimAttempt: async () => true,
				readTargets,
				environment,
				operationId,
				expectedConvexUrl: convexUrl,
				observeMatches: async () => {
					throw new Error("raw provider error");
				},
			}),
		).resolves.toBe("provider_multi_lookup_observer:inconclusive");
		expect(readTargets).toHaveBeenCalledTimes(2);

		await expect(
			runProviderMultiLookupObserver({
				claimAttempt: async () => true,
				readTargets: async () => readyTargets,
				environment,
				operationId,
				expectedConvexUrl: convexUrl,
				observeMatches: async () => "raw-provider-output" as never,
			}),
		).resolves.toBe("provider_multi_lookup_observer:inconclusive");
	});
});
