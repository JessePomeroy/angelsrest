import { describe, expect, test, vi } from "vitest";
import {
	formatProviderMultiTargetConflictClassification,
	parseProviderMultiTargetConflictClassification,
	providerMultiTargetClassifierChildEnvironment,
	providerMultiTargetClassifierCliArguments,
	providerMultiTargetClassifierEnvironmentReady,
	readProviderMultiTargetConflictClassification,
	runProviderMultiTargetConflictClassifier,
} from "./providerMultiTargetConflictClassifier";

const operationId = "fixed-operation";
const convexUrl = "https://deployment.convex.cloud";

describe("provider multi-target conflict classifier caller", () => {
	test("requires the exact host closed state, operation, and Convex target", () => {
		const ready = {
			ORDER_RESET_PROVIDER_MULTI_TARGET_CLASSIFIER_ID: operationId,
			ORDER_PRODUCERS_STATE: "closed",
			PUBLIC_CONVEX_URL: convexUrl,
		};
		expect(providerMultiTargetClassifierEnvironmentReady(ready, operationId, convexUrl)).toBe(true);
		for (const [name, value] of [
			["ORDER_RESET_PROVIDER_MULTI_TARGET_CLASSIFIER_ID", undefined],
			["ORDER_RESET_PROVIDER_MULTI_TARGET_CLASSIFIER_ID", "wrong"],
			["ORDER_PRODUCERS_STATE", undefined],
			["ORDER_PRODUCERS_STATE", "open"],
			["ORDER_PRODUCERS_STATE", " closed "],
			["PUBLIC_CONVEX_URL", undefined],
			["PUBLIC_CONVEX_URL", "https://other.convex.cloud"],
		] as const) {
			expect(
				providerMultiTargetClassifierEnvironmentReady(
					{ ...ready, [name]: value },
					operationId,
					convexUrl,
				),
			).toBe(false);
		}
	});

	test("pins the internal function and deployment while sanitizing the child environment", async () => {
		expect(providerMultiTargetClassifierCliArguments("loyal-swan-967")).toEqual([
			"run",
			"orderReset:classifyProviderMultiTargetConflict",
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
			LUMAPRINTS_API_SECRET: "must-not-pass",
			WEBHOOK_SECRET: "must-not-pass",
		};
		expect(providerMultiTargetClassifierChildEnvironment(environment)).toEqual({
			HOME: "/home/operator",
			PATH: "/bin",
			XDG_CONFIG_HOME: "/config",
			XDG_CACHE_HOME: "/cache",
			NO_COLOR: "1",
		});
		const execute = vi.fn().mockResolvedValue({
			stdout: '  {"outcome":"source_conflict"}\n',
		});
		await expect(
			readProviderMultiTargetConflictClassification({
				execute,
				convexBinary: "/repo/node_modules/.bin/convex",
				crmDirectory: "/repo/packages/crm-api",
				deployment: "loyal-swan-967",
				environment,
			}),
		).resolves.toBe('{"outcome":"source_conflict"}');
		expect(execute).toHaveBeenCalledWith(
			"/repo/node_modules/.bin/convex",
			[
				"run",
				"orderReset:classifyProviderMultiTargetConflict",
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

	test("assembles one marker claim, host gate, internal read, and normalized result", async () => {
		const order: string[] = [];
		const result = await runProviderMultiTargetConflictClassifier({
			claimAttempt: async () => {
				order.push("claim");
				return true;
			},
			readClassification: async () => {
				order.push("read");
				return '{"outcome":"target_conflict","classes":["preparation_only"]}';
			},
			environment: {
				ORDER_RESET_PROVIDER_MULTI_TARGET_CLASSIFIER_ID: operationId,
				ORDER_PRODUCERS_STATE: "closed",
				PUBLIC_CONVEX_URL: convexUrl,
			},
			operationId,
			expectedConvexUrl: convexUrl,
		});
		expect(order).toEqual(["claim", "read"]);
		expect(result).toBe("provider_multi_target_classifier:target_conflict:preparation_only");
	});

	test("never reads when the marker or host gate fails and normalizes child failures", async () => {
		const readClassification = vi.fn();
		await expect(
			runProviderMultiTargetConflictClassifier({
				claimAttempt: async () => false,
				readClassification,
				environment: {},
				operationId,
				expectedConvexUrl: convexUrl,
			}),
		).resolves.toBe("provider_multi_target_classifier:operation_unavailable");
		expect(readClassification).not.toHaveBeenCalled();

		await expect(
			runProviderMultiTargetConflictClassifier({
				claimAttempt: async () => true,
				readClassification,
				environment: { ORDER_PRODUCERS_STATE: "open" },
				operationId,
				expectedConvexUrl: convexUrl,
			}),
		).resolves.toBe("provider_multi_target_classifier:configuration_error");
		expect(readClassification).not.toHaveBeenCalled();

		readClassification.mockRejectedValueOnce(new Error("raw child error"));
		await expect(
			runProviderMultiTargetConflictClassifier({
				claimAttempt: async () => true,
				readClassification,
				environment: {
					ORDER_RESET_PROVIDER_MULTI_TARGET_CLASSIFIER_ID: operationId,
					ORDER_PRODUCERS_STATE: "closed",
					PUBLIC_CONVEX_URL: convexUrl,
				},
				operationId,
				expectedConvexUrl: convexUrl,
			}),
		).resolves.toBe("provider_multi_target_classifier:configuration_error");
	});

	test("parses and formats only exact deterministic normalized classes", () => {
		for (const outcome of [
			"source_conflict",
			"live_effect_conflict",
			"no_target_conflict",
		] as const) {
			const parsed = parseProviderMultiTargetConflictClassification(JSON.stringify({ outcome }));
			expect(formatProviderMultiTargetConflictClassification(parsed)).toBe(
				`provider_multi_target_classifier:${outcome}`,
			);
		}
		const parsed = parseProviderMultiTargetConflictClassification(
			JSON.stringify({
				outcome: "target_conflict",
				classes: ["preparation_only", "session_not_live"],
			}),
		);
		expect(parsed).toEqual({
			outcome: "target_conflict",
			classes: ["preparation_only", "session_not_live"],
		});
		expect(formatProviderMultiTargetConflictClassification(parsed)).toBe(
			"provider_multi_target_classifier:target_conflict:preparation_only+session_not_live",
		);
	});

	test.each([
		"not-json",
		'{"outcome":"target_conflict","classes":[]}',
		'{"outcome":"target_conflict","classes":["unknown"]}',
		'{"outcome":"target_conflict","classes":["session_not_live","preparation_only"]}',
		'{"outcome":"target_conflict","classes":["preparation_only","preparation_only"]}',
		'{"outcome":"source_conflict","extra":true}',
	])("rejects malformed or noncanonical classifier output", (value) => {
		expect(() => parseProviderMultiTargetConflictClassification(value)).toThrow("invalid");
	});
});
