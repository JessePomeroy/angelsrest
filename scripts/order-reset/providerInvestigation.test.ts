import { chmod, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test, vi } from "vitest";
import {
	claimProtectedOperationAttempt,
	claimProviderInvestigationAttempt,
	claimProviderMultiInvestigationAttempt,
	observeProviderMatch,
	observeProviderMatches,
	type ProviderConfiguration,
	parseProviderInvestigationTarget,
	parseProviderMultiInvestigationTargets,
	productionProviderModeIsSafe,
	runProviderInvestigation,
	runProviderMultiInvestigation,
} from "./providerInvestigation";

const externalId = "cs_live_1234567890abcdef";
const secondExternalId = "cs_live_1234567890abcdeg";
const testExternalId = "cs_test_1234567890abcdeh";
const configuration: ProviderConfiguration = {
	apiKey: "key",
	apiSecret: "secret",
	storeId: 42,
	baseUrl: "https://us.api.lumaprints.com",
};

function response(
	orders: Array<Record<string, unknown>>,
	overrides: Partial<{ totalOrders: number; currentPage: number; totalPages: number }> = {},
) {
	return new Response(
		JSON.stringify({
			orders,
			totalOrders: overrides.totalOrders ?? orders.length,
			currentPage: overrides.currentPage ?? 1,
			totalPages: overrides.totalPages ?? (orders.length === 0 ? 0 : 1),
		}),
		{ headers: { "content-type": "application/json" } },
	);
}

function order(id: string, number = "10000000001") {
	return { externalId: id, orderNumber: number, storeId: 42 };
}

describe("bounded print-provider investigation", () => {
	test("accepts only explicit or documented implicit Production provider mode", () => {
		expect(productionProviderModeIsSafe(undefined)).toBe(true);
		expect(productionProviderModeIsSafe("false")).toBe(true);
		expect(productionProviderModeIsSafe("true")).toBe(false);
		expect(productionProviderModeIsSafe("")).toBe(false);
		expect(productionProviderModeIsSafe(" false ")).toBe(false);
	});

	test("accepts only the exact bounded target carrier", () => {
		expect(
			parseProviderInvestigationTarget(
				JSON.stringify({
					outcome: "ready",
					externalId,
				}),
			),
		).toEqual({ outcome: "ready", externalId });
		expect(parseProviderInvestigationTarget('{"outcome":"source_conflict"}')).toEqual({
			outcome: "source_conflict",
		});
		for (const invalid of [
			"not-json",
			'{"outcome":"ready","externalId":"invalid"}',
			'{"outcome":"ready","externalId":"cs_live_1234567890abcdef","extra":true}',
			'{"outcome":"unknown"}',
		])
			expect(() => parseProviderInvestigationTarget(invalid)).toThrow("invalid");
	});

	test("accepts only an exact bounded sorted multi-target carrier", () => {
		expect(
			parseProviderMultiInvestigationTargets(
				JSON.stringify({
					outcome: "ready",
					externalIds: [externalId, secondExternalId],
				}),
			),
		).toEqual({ outcome: "ready", externalIds: [externalId, secondExternalId] });
		expect(parseProviderMultiInvestigationTargets('{"outcome":"target_conflict"}')).toEqual({
			outcome: "target_conflict",
		});
		for (const invalid of [
			"not-json",
			JSON.stringify({ outcome: "ready", externalIds: [externalId] }),
			JSON.stringify({ outcome: "ready", externalIds: [secondExternalId, externalId] }),
			JSON.stringify({ outcome: "ready", externalIds: [externalId, externalId] }),
			JSON.stringify({ outcome: "ready", externalIds: [externalId, "cs_test_1234567890abcdef"] }),
			JSON.stringify({
				outcome: "ready",
				externalIds: [externalId, secondExternalId],
				extra: true,
			}),
		])
			expect(() => parseProviderMultiInvestigationTargets(invalid)).toThrow("invalid");
	});

	test("atomically consumes one protected external attempt marker", async () => {
		const directory = await mkdtemp(join(tmpdir(), "provider-investigation-test-"));
		try {
			await chmod(directory, 0o700);
			await expect(
				Promise.all([
					claimProviderInvestigationAttempt(directory),
					claimProviderInvestigationAttempt(directory),
				]),
			).resolves.toEqual(expect.arrayContaining([true, false]));
			await expect(claimProviderInvestigationAttempt(directory)).resolves.toBe(false);
			const marker = join(directory, "production-provider-investigation-attempted");
			expect(await readFile(marker, "utf8")).toBe("provider_investigation_attempted\n");
			expect((await stat(marker)).mode & 0o777).toBe(0o600);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});

	test("atomically consumes one protected multi-target attempt marker", async () => {
		const directory = await mkdtemp(join(tmpdir(), "provider-multi-investigation-test-"));
		try {
			await chmod(directory, 0o700);
			await expect(
				Promise.all([
					claimProviderMultiInvestigationAttempt(directory),
					claimProviderMultiInvestigationAttempt(directory),
				]),
			).resolves.toEqual(expect.arrayContaining([true, false]));
			const marker = join(directory, "production-provider-multi-investigation-attempted");
			expect(await readFile(marker, "utf8")).toBe("provider_multi_investigation_attempted\n");
			expect((await stat(marker)).mode & 0o777).toBe(0o600);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});

	test("creates a fixed custom operation marker and rejects unsafe marker inputs", async () => {
		const directory = await mkdtemp(join(tmpdir(), "protected-operation-test-"));
		try {
			await chmod(directory, 0o700);
			await expect(
				claimProtectedOperationAttempt(
					directory,
					"production-target-conflict-classifier-attempted",
					"provider_target_classifier_attempted\n",
				),
			).resolves.toBe(true);
			const marker = join(directory, "production-target-conflict-classifier-attempted");
			expect(await readFile(marker, "utf8")).toBe("provider_target_classifier_attempted\n");
			expect((await stat(marker)).mode & 0o777).toBe(0o600);
			await expect(
				claimProtectedOperationAttempt(directory, "../unsafe", "unsafe\n"),
			).resolves.toBe(false);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});

	test("refuses an unprotected attempt directory", async () => {
		const directory = await mkdtemp(join(tmpdir(), "provider-investigation-mode-test-"));
		try {
			await chmod(directory, 0o755);
			await expect(claimProviderInvestigationAttempt(directory)).resolves.toBe(false);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});

	test("observes one exact match without a POST or request body", async () => {
		const fetcher = vi.fn().mockResolvedValue(response([order(externalId)]));

		await expect(observeProviderMatch(externalId, configuration, fetcher)).resolves.toBe(
			"observed",
		);
		expect(fetcher).toHaveBeenCalledOnce();
		const [url, init] = fetcher.mock.calls[0];
		expect(String(url)).toBe("https://us.api.lumaprints.com/api/v1/orders?storeId=42&page=1");
		expect(init.method).toBe("GET");
		expect(init.body).toBeUndefined();
		expect(init.cache).toBe("no-store");
		expect(init.redirect).toBe("error");
	});

	test("returns not observed only after a complete stable bounded scan", async () => {
		const fetcher = vi
			.fn()
			.mockResolvedValueOnce(
				response([order("cs_live_ABCDEFGHIJKLMNOP")], {
					totalOrders: 2,
					currentPage: 1,
					totalPages: 2,
				}),
			)
			.mockResolvedValueOnce(
				response([order("cs_live_QRSTUVWXYZabcdef", "10000000002")], {
					totalOrders: 2,
					currentPage: 2,
					totalPages: 2,
				}),
			);

		await expect(observeProviderMatch(externalId, configuration, fetcher)).resolves.toBe(
			"not_observed",
		);
		expect(fetcher).toHaveBeenCalledTimes(2);
		for (const [, init] of fetcher.mock.calls) {
			expect(init.method).toBe("GET");
			expect(init.body).toBeUndefined();
		}
	});

	test.each([
		new Response(null, { status: 500 }),
		new Response("{}", { headers: { "content-type": "text/plain" } }),
		response([order(externalId), order(externalId, "10000000002")]),
		response([order("cs_live_ABCDEFGHIJKLMNOP")], { totalOrders: 1, totalPages: 11 }),
	])("normalizes provider failures, ambiguity, and resource overflow", async (providerResponse) => {
		await expect(
			observeProviderMatch(externalId, configuration, vi.fn().mockResolvedValue(providerResponse)),
		).resolves.toBe("inconclusive");
	});

	test("rejects unsupported encoding metadata, BOM, invalid UTF-8, and oversized bodies", async () => {
		const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...Buffer.from("{}")]);
		const invalidUtf8 = new Uint8Array([0xc3, 0x28]);
		const oversized = new Uint8Array(2 * 1024 * 1024 + 1);
		for (const providerResponse of [
			new Response("{}", {
				headers: { "content-type": "application/json", "content-encoding": "zstd" },
			}),
			new Response(bom, { headers: { "content-type": "application/json" } }),
			new Response(invalidUtf8, { headers: { "content-type": "application/json" } }),
			new Response(oversized, { headers: { "content-type": "application/json" } }),
		]) {
			await expect(
				observeProviderMatch(
					externalId,
					configuration,
					vi.fn().mockResolvedValue(providerResponse),
				),
			).resolves.toBe("inconclusive");
		}
	});

	test("cancels non-success bodies and normalizes transport failures", async () => {
		const cancel = vi.fn();
		const body = new ReadableStream({ cancel });
		await expect(
			observeProviderMatch(
				externalId,
				configuration,
				vi.fn().mockResolvedValue(new Response(body, { status: 500 })),
			),
		).resolves.toBe("inconclusive");
		expect(cancel).toHaveBeenCalledOnce();
		await expect(
			observeProviderMatch(
				externalId,
				configuration,
				vi.fn().mockRejectedValue(new Error("raw transport error")),
			),
		).resolves.toBe("inconclusive");
	});

	test("normalizes aggregate provider observations without target data", async () => {
		await expect(
			observeProviderMatches(
				[externalId, secondExternalId],
				configuration,
				vi
					.fn()
					.mockResolvedValue(response([order(externalId), order(secondExternalId, "10000000002")])),
			),
		).resolves.toBe("all_observed");
		await expect(
			observeProviderMatches(
				[externalId, secondExternalId],
				configuration,
				vi.fn().mockResolvedValue(response([order(externalId)])),
			),
		).resolves.toBe("some_observed");
		await expect(
			observeProviderMatches(
				[externalId, secondExternalId],
				configuration,
				vi.fn().mockResolvedValue(response([order("cs_live_ABCDEFGHIJKLMNOP")])),
			),
		).resolves.toBe("none_observed");
		await expect(
			observeProviderMatches(
				[externalId, secondExternalId],
				configuration,
				vi.fn().mockResolvedValue(response([order(externalId), order(externalId, "10000000002")])),
			),
		).resolves.toBe("inconclusive");
	});

	test("uses the shared exact test-or-live identity shape for provider observation", async () => {
		await expect(
			observeProviderMatches(
				[externalId, testExternalId],
				configuration,
				vi
					.fn()
					.mockResolvedValue(response([order(externalId), order(testExternalId, "10000000002")])),
			),
		).resolves.toBe("all_observed");
		await expect(
			observeProviderMatches([externalId, `cs_test_${"A".repeat(15)}`], configuration, vi.fn()),
		).resolves.toBe("inconclusive");
	});

	test("normalizes multi-target orchestration and fails a changed recheck closed", async () => {
		for (const observation of [
			"all_observed",
			"some_observed",
			"none_observed",
			"inconclusive",
		] as const) {
			await expect(
				runProviderMultiInvestigation({
					getTargets: async () => ({
						outcome: "ready",
						externalIds: [externalId, secondExternalId],
					}),
					observeMatches: async () => observation,
				}),
			).resolves.toBe(`provider_multi_investigation:${observation}`);
		}
		await expect(
			runProviderMultiInvestigation({
				getTargets: async () => ({ outcome: "source_conflict" }),
				observeMatches: async () => "all_observed",
			}),
		).resolves.toBe("provider_multi_investigation:source_conflict");
		const getChangingTargets = vi
			.fn()
			.mockResolvedValueOnce({ outcome: "ready", externalIds: [externalId, secondExternalId] })
			.mockResolvedValueOnce({
				outcome: "ready",
				externalIds: [externalId, `${secondExternalId}X`],
			});
		await expect(
			runProviderMultiInvestigation({
				getTargets: getChangingTargets,
				observeMatches: async () => "all_observed",
			}),
		).resolves.toBe("provider_multi_investigation:target_conflict");
		await expect(
			runProviderMultiInvestigation({
				getTargets: async () => {
					throw new Error("raw error");
				},
				observeMatches: async () => "all_observed",
			}),
		).resolves.toBe("provider_multi_investigation:configuration_error");
	});

	test("normalizes target and provider outcomes without returning target data", async () => {
		await expect(
			runProviderInvestigation({
				getTarget: async () => ({ outcome: "ready", externalId }),
				observeMatch: async () => "observed",
			}),
		).resolves.toBe("provider_investigation:match_observed");
		await expect(
			runProviderInvestigation({
				getTarget: async () => ({ outcome: "ready", externalId }),
				observeMatch: async () => "not_observed",
			}),
		).resolves.toBe("provider_investigation:match_not_observed");
		await expect(
			runProviderInvestigation({
				getTarget: async () => ({ outcome: "target_conflict" }),
				observeMatch: async () => "observed",
			}),
		).resolves.toBe("provider_investigation:target_conflict");
		const getChangingTarget = vi
			.fn()
			.mockResolvedValueOnce({ outcome: "ready", externalId })
			.mockResolvedValueOnce({ outcome: "source_conflict" });
		await expect(
			runProviderInvestigation({
				getTarget: getChangingTarget,
				observeMatch: async () => "observed",
			}),
		).resolves.toBe("provider_investigation:target_conflict");
		await expect(
			runProviderInvestigation({
				getTarget: async () => {
					throw new Error("raw error");
				},
				observeMatch: async () => "observed",
			}),
		).resolves.toBe("provider_investigation:configuration_error");
	});
});
