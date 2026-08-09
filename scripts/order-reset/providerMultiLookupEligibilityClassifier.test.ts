import { describe, expect, test, vi } from "vitest";
import {
	formatProviderMultiLookupEligibilityClassification,
	parseProviderMultiLookupEligibilityClassification,
	providerMultiLookupEligibilityClassifierChildEnvironment,
	providerMultiLookupEligibilityClassifierCliArguments,
	providerMultiLookupEligibilityClassifierEnvironmentReady,
	readProviderMultiLookupEligibilityClassification,
	runProviderMultiLookupEligibilityClassifier,
} from "./providerMultiLookupEligibilityClassifier";

const operationId = "fixed-operation";
const convexUrl = "https://deployment.convex.cloud";

const readyEnvironment = {
	ORDER_RESET_PROVIDER_MULTI_LOOKUP_ELIGIBILITY_CLASSIFIER_ID: operationId,
	ORDER_PRODUCERS_STATE: "closed",
	PUBLIC_CONVEX_URL: convexUrl,
};

describe("provider multi-lookup eligibility classifier caller", () => {
	test("requires the exact operation, host closed state, and Convex target", () => {
		expect(
			providerMultiLookupEligibilityClassifierEnvironmentReady(
				readyEnvironment,
				operationId,
				convexUrl,
			),
		).toBe(true);
		for (const [name, value] of [
			["ORDER_RESET_PROVIDER_MULTI_LOOKUP_ELIGIBILITY_CLASSIFIER_ID", undefined],
			["ORDER_RESET_PROVIDER_MULTI_LOOKUP_ELIGIBILITY_CLASSIFIER_ID", "wrong"],
			["ORDER_PRODUCERS_STATE", undefined],
			["ORDER_PRODUCERS_STATE", "open"],
			["ORDER_PRODUCERS_STATE", " closed "],
			["PUBLIC_CONVEX_URL", undefined],
			["PUBLIC_CONVEX_URL", "https://other.convex.cloud"],
		] as const) {
			expect(
				providerMultiLookupEligibilityClassifierEnvironmentReady(
					{ ...readyEnvironment, [name]: value },
					operationId,
					convexUrl,
				),
			).toBe(false);
		}
	});

	test("pins the internal read and deployment while reducing the child environment", async () => {
		expect(providerMultiLookupEligibilityClassifierCliArguments("loyal-swan-967")).toEqual([
			"run",
			"orderReset:classifyProviderMultiLookupEligibility",
			"{}",
			"--deployment",
			"loyal-swan-967",
			"--typecheck",
			"disable",
			"--codegen",
			"disable",
		]);
		const environment = {
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
		expect(providerMultiLookupEligibilityClassifierChildEnvironment(environment)).toEqual({
			HOME: "/home/operator",
			PATH: "/bin",
			XDG_CONFIG_HOME: "/config",
			XDG_CACHE_HOME: "/cache",
			NO_COLOR: "1",
		});
		const execute = vi.fn().mockResolvedValue({
			stdout: '  {"outcome":"lookup_shape_eligible"}\n',
		});
		await expect(
			readProviderMultiLookupEligibilityClassification({
				execute,
				convexBinary: "/repo/node_modules/.bin/convex",
				crmDirectory: "/repo/packages/crm-api",
				deployment: "loyal-swan-967",
				environment,
			}),
		).resolves.toBe('{"outcome":"lookup_shape_eligible"}');
		expect(execute).toHaveBeenCalledWith(
			"/repo/node_modules/.bin/convex",
			[
				"run",
				"orderReset:classifyProviderMultiLookupEligibility",
				"{}",
				"--deployment",
				"loyal-swan-967",
				"--typecheck",
				"disable",
				"--codegen",
				"disable",
			],
			{
				cwd: "/repo/packages/crm-api",
				timeout: 30_000,
				maxBuffer: 16 * 1024,
				encoding: "utf8",
				env: {
					HOME: "/home/operator",
					PATH: "/bin",
					XDG_CONFIG_HOME: "/config",
					XDG_CACHE_HOME: "/cache",
					NO_COLOR: "1",
				},
			},
		);
	});

	test.each([
		"source_conflict",
		"live_effect_conflict",
		"state_changed",
		"lookup_shape_eligible",
		"lookup_shape_ineligible",
	] as const)("claims once before the read and returns only normalized %s", async (outcome) => {
		const order: string[] = [];
		const claimAttempt = vi.fn(async () => {
			order.push("claim");
			return true;
		});
		const readClassification = vi.fn(async () => {
			order.push("read");
			return JSON.stringify({ outcome });
		});
		await expect(
			runProviderMultiLookupEligibilityClassifier({
				claimAttempt,
				readClassification,
				environment: readyEnvironment,
				operationId,
				expectedConvexUrl: convexUrl,
			}),
		).resolves.toBe(`provider_multi_lookup_eligibility_classifier:${outcome}`);
		expect(order).toEqual(["claim", "read"]);
		expect(claimAttempt).toHaveBeenCalledTimes(1);
		expect(readClassification).toHaveBeenCalledTimes(1);
	});

	test("never reads when the marker claim or final host gate fails", async () => {
		const readClassification = vi.fn();
		await expect(
			runProviderMultiLookupEligibilityClassifier({
				claimAttempt: async () => false,
				readClassification,
				environment: readyEnvironment,
				operationId,
				expectedConvexUrl: convexUrl,
			}),
		).resolves.toBe("provider_multi_lookup_eligibility_classifier:operation_unavailable");
		expect(readClassification).not.toHaveBeenCalled();

		const order: string[] = [];
		await expect(
			runProviderMultiLookupEligibilityClassifier({
				claimAttempt: async () => {
					order.push("claim");
					return true;
				},
				readClassification: async () => {
					order.push("read");
					return '{"outcome":"lookup_shape_eligible"}';
				},
				environment: { ...readyEnvironment, ORDER_PRODUCERS_STATE: "open" },
				operationId,
				expectedConvexUrl: convexUrl,
			}),
		).resolves.toBe("provider_multi_lookup_eligibility_classifier:configuration_error");
		expect(order).toEqual(["claim"]);
	});

	test.each([
		async () => {
			throw new Error("raw child error");
		},
		async () => "not-json",
		async () => '{"outcome":"lookup_shape_eligible","count":2}',
	])("normalizes every child or parser failure", async (readClassification) => {
		await expect(
			runProviderMultiLookupEligibilityClassifier({
				claimAttempt: async () => true,
				readClassification,
				environment: readyEnvironment,
				operationId,
				expectedConvexUrl: convexUrl,
			}),
		).resolves.toBe("provider_multi_lookup_eligibility_classifier:configuration_error");
	});

	test("parses and formats only exact one-key normalized classes", () => {
		for (const outcome of [
			"source_conflict",
			"live_effect_conflict",
			"state_changed",
			"lookup_shape_eligible",
			"lookup_shape_ineligible",
		] as const) {
			const parsed = parseProviderMultiLookupEligibilityClassification(JSON.stringify({ outcome }));
			expect(parsed).toEqual({ outcome });
			expect(formatProviderMultiLookupEligibilityClassification(parsed)).toBe(
				`provider_multi_lookup_eligibility_classifier:${outcome}`,
			);
		}
	});

	test.each([
		"not-json",
		"null",
		"[]",
		"{}",
		'"lookup_shape_eligible"',
		'{"outcome":"unknown"}',
		'{"outcome":"lookup_shape_eligible","count":2}',
		'{"outcome":"lookup_shape_ineligible","externalId":"redacted"}',
		'{"outcome":"source_conflict","error":"raw"}',
		'{"outcome":["lookup_shape_eligible"]}',
	])("rejects malformed or disclosure-bearing classifier output", (value) => {
		expect(() => parseProviderMultiLookupEligibilityClassification(value)).toThrow("invalid");
	});
});
