import { describe, expect, test, vi } from "vitest";
import {
	applyOwnerTestOrderReset,
	OWNER_TEST_ORDER_RESET_AUTHORITY,
	ownerTestOrderResetChildEnvironment,
	ownerTestOrderResetCliArguments,
	ownerTestOrderResetEnvironmentReady,
	ownerTestOrderResetVerifyCliArguments,
	parseOwnerTestOrderResetResult,
	parseOwnerTestOrderResetVerification,
	runOwnerTestOrderReset,
	verifyOwnerTestOrderReset,
} from "./ownerTestOrderReset";

const operationId = "fixed-operation";
const convexUrl = "https://deployment.convex.cloud";
const readyEnvironment = {
	ORDER_RESET_OWNER_TEST_OPERATION_ID: operationId,
	ORDER_PRODUCERS_STATE: "closed",
	PUBLIC_CONVEX_URL: convexUrl,
};

describe("owner test-order reset caller", () => {
	test("requires the exact operation, host closed state, and Convex target", () => {
		expect(ownerTestOrderResetEnvironmentReady(readyEnvironment, operationId, convexUrl)).toBe(
			true,
		);
		for (const [name, value] of [
			["ORDER_RESET_OWNER_TEST_OPERATION_ID", undefined],
			["ORDER_RESET_OWNER_TEST_OPERATION_ID", "wrong"],
			["ORDER_PRODUCERS_STATE", undefined],
			["ORDER_PRODUCERS_STATE", "open"],
			["ORDER_PRODUCERS_STATE", " closed "],
			["PUBLIC_CONVEX_URL", undefined],
			["PUBLIC_CONVEX_URL", "https://other.convex.cloud"],
		] as const) {
			expect(
				ownerTestOrderResetEnvironmentReady(
					{ ...readyEnvironment, [name]: value },
					operationId,
					convexUrl,
				),
			).toBe(false);
		}
	});

	test("pins the exact mutation, authority, verifier, and deployment", () => {
		expect(OWNER_TEST_ORDER_RESET_AUTHORITY).toBe(
			"owner_test_orders_disposable_residual_provider_effects_accepted_20260809",
		);
		expect(ownerTestOrderResetCliArguments("loyal-swan-967")).toEqual([
			"run",
			"orderReset:applyOwnerTestOrders",
			'{"authority":"owner_test_orders_disposable_residual_provider_effects_accepted_20260809"}',
			"--deployment",
			"loyal-swan-967",
			"--typecheck",
			"disable",
			"--codegen",
			"disable",
		]);
		expect(ownerTestOrderResetVerifyCliArguments("loyal-swan-967")).toEqual([
			"run",
			"orderReset:verify",
			"{}",
			"--deployment",
			"loyal-swan-967",
			"--typecheck",
			"disable",
			"--codegen",
			"disable",
		]);
	});

	test("bounds both Convex calls and excludes sensitive child environment", async () => {
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
		expect(ownerTestOrderResetChildEnvironment(environment)).toEqual({
			HOME: "/home/operator",
			PATH: "/bin",
			XDG_CONFIG_HOME: "/config",
			XDG_CACHE_HOME: "/cache",
			NO_COLOR: "1",
		});
		const execute = vi
			.fn()
			.mockResolvedValueOnce({ stdout: ' {"outcome":"applied"}\n' })
			.mockResolvedValueOnce({ stdout: ' {"outcome":"complete"}\n' });
		const dependencies = {
			execute,
			convexBinary: "/repo/node_modules/.bin/convex",
			crmDirectory: "/repo/packages/crm-api",
			deployment: "loyal-swan-967",
			environment,
		};
		await expect(applyOwnerTestOrderReset(dependencies)).resolves.toBe('{"outcome":"applied"}');
		await expect(verifyOwnerTestOrderReset(dependencies)).resolves.toBe('{"outcome":"complete"}');
		for (const [index, args] of [
			ownerTestOrderResetCliArguments("loyal-swan-967"),
			ownerTestOrderResetVerifyCliArguments("loyal-swan-967"),
		].entries()) {
			expect(execute).toHaveBeenNthCalledWith(
				index + 1,
				"/repo/node_modules/.bin/convex",
				[...args],
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
		}
	});

	test.each([
		"applied",
		"already_applied",
	] as const)("claims, applies once, verifies once, and returns normalized %s", async (outcome) => {
		const order: string[] = [];
		const claimAttempt = vi.fn(async () => {
			order.push("claim");
			return true;
		});
		const applyReset = vi.fn(async () => {
			order.push("apply");
			return JSON.stringify({ outcome });
		});
		const verifyReset = vi.fn(async () => {
			order.push("verify");
			return '{"outcome":"complete"}';
		});
		await expect(
			runOwnerTestOrderReset({
				claimAttempt,
				applyReset,
				verifyReset,
				environment: readyEnvironment,
				operationId,
				expectedConvexUrl: convexUrl,
			}),
		).resolves.toBe(`owner_test_order_reset:${outcome}_verified`);
		expect(order).toEqual(["claim", "apply", "verify"]);
		expect(applyReset).toHaveBeenCalledTimes(1);
		expect(verifyReset).toHaveBeenCalledTimes(1);
	});

	test.each([
		"source_overflow",
		"source_empty",
		"live_effect",
		"conflict",
	] as const)("stops after the fixed non-success mutation result %s", async (outcome) => {
		const verifyReset = vi.fn();
		await expect(
			runOwnerTestOrderReset({
				claimAttempt: async () => true,
				applyReset: async () => JSON.stringify({ outcome }),
				verifyReset,
				environment: readyEnvironment,
				operationId,
				expectedConvexUrl: convexUrl,
			}),
		).resolves.toBe(`owner_test_order_reset:${outcome}`);
		expect(verifyReset).not.toHaveBeenCalled();
	});

	test("normalizes explicit verification conflict and unavailability without retry", async () => {
		for (const [verifyReset, expected] of [
			[async () => '{"outcome":"source_present"}', "verification_conflict"],
			[
				async () => {
					throw new Error("raw verification error");
				},
				"verification_unavailable",
			],
		] as const) {
			const applyReset = vi.fn(async () => '{"outcome":"applied"}');
			await expect(
				runOwnerTestOrderReset({
					claimAttempt: async () => true,
					applyReset,
					verifyReset,
					environment: readyEnvironment,
					operationId,
					expectedConvexUrl: convexUrl,
				}),
			).resolves.toBe(`owner_test_order_reset:applied_${expected}`);
			expect(applyReset).toHaveBeenCalledTimes(1);
		}
	});

	test("verifies once after a lost or malformed mutation response and never retries apply", async () => {
		for (const [applyReset, verifyReset, expected] of [
			[
				async () => {
					throw new Error("raw apply error");
				},
				async () => '{"outcome":"complete"}',
				"owner_test_order_reset:application_response_lost_verified",
			],
			[
				async () => "not-json",
				async () => '{"outcome":"missing"}',
				"owner_test_order_reset:application_outcome_unknown",
			],
			[
				async () => "not-json",
				async () => {
					throw new Error("raw verify error");
				},
				"owner_test_order_reset:application_outcome_unknown",
			],
		] as const) {
			const apply = vi.fn(applyReset);
			const verify = vi.fn(verifyReset);
			await expect(
				runOwnerTestOrderReset({
					claimAttempt: async () => true,
					applyReset: apply,
					verifyReset: verify,
					environment: readyEnvironment,
					operationId,
					expectedConvexUrl: convexUrl,
				}),
			).resolves.toBe(expected);
			expect(apply).toHaveBeenCalledTimes(1);
			expect(verify).toHaveBeenCalledTimes(1);
		}
	});

	test("never calls Convex when marker claim or final configuration fails", async () => {
		for (const claimAttempt of [
			async () => false,
			async () => {
				throw new Error("claim failure");
			},
		]) {
			const applyReset = vi.fn();
			const verifyReset = vi.fn();
			await expect(
				runOwnerTestOrderReset({
					claimAttempt,
					applyReset,
					verifyReset,
					environment: readyEnvironment,
					operationId,
					expectedConvexUrl: convexUrl,
				}),
			).resolves.toBe("owner_test_order_reset:operation_unavailable");
			expect(applyReset).not.toHaveBeenCalled();
			expect(verifyReset).not.toHaveBeenCalled();
		}

		const applyReset = vi.fn();
		const verifyReset = vi.fn();
		await expect(
			runOwnerTestOrderReset({
				claimAttempt: async () => true,
				applyReset,
				verifyReset,
				environment: { ...readyEnvironment, ORDER_PRODUCERS_STATE: "open" },
				operationId,
				expectedConvexUrl: convexUrl,
			}),
		).resolves.toBe("owner_test_order_reset:configuration_error");
		expect(applyReset).not.toHaveBeenCalled();
		expect(verifyReset).not.toHaveBeenCalled();
	});

	test("parses only exact one-key apply and verification outcomes", () => {
		for (const outcome of [
			"applied",
			"already_applied",
			"source_overflow",
			"source_empty",
			"live_effect",
			"conflict",
		] as const)
			expect(parseOwnerTestOrderResetResult(JSON.stringify({ outcome }))).toBe(outcome);
		for (const outcome of [
			"complete",
			"missing",
			"source_present",
			"source_overflow",
			"conflict",
		] as const) {
			expect(parseOwnerTestOrderResetVerification(JSON.stringify({ outcome }))).toBe(outcome);
		}
		for (const value of [
			"not-json",
			"null",
			"[]",
			"{}",
			'"applied"',
			'{"outcome":"unknown"}',
			'{"outcome":"applied","count":2}',
			'{"outcome":"complete","id":"redacted"}',
			'{"outcome":"conflict","error":"raw"}',
		]) {
			expect(() => parseOwnerTestOrderResetResult(value)).toThrow("invalid");
			expect(() => parseOwnerTestOrderResetVerification(value)).toThrow("invalid");
		}
	});
});
