import { chmod, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import journal from "./migrations/angelsrest-catalog/sanity-catalog-private-asset-map.json";
import {
	clearV2CanaryReportForExecution,
	executeV2CanaryStateMachine,
	loadV2CanarySelection,
	parseV2CanaryOptions,
	postV2CanaryWorkerReceipt,
	readV2CanaryConvexSelectorFile,
	readV2CanarySecretFile,
	runV2CanaryConvexFunction,
	V2_CANARY_CONFIRMATION,
	V2_CANARY_CONVEX_SELECTOR,
	V2_CANARY_INSPECTION_PATH,
	V2_CANARY_STORAGE_PATH,
	v2CanaryConvexChildEnvironment,
} from "./sanityCatalogPrivateAssetV2Canary";

const temporaryDirectories: string[] = [];
const receiptSetId = `catalog-private-assets-v2:${"a".repeat(64)}`;
const targets = [
	{ label: "jpeg", kind: "print_source", targetId: "q970hm4246ek96y29w5hrsjkvh8axepc" },
	{ label: "oversized_png", kind: "print_source", targetId: "q97em2xrgehs2gg4jmeajgmj9n8awazy" },
	{ label: "paid_zip", kind: "paid_digital_file", targetId: "q57679yxvbbbkz74563mvg34gn8axprw" },
] as const;
const digestKeys = [
	"receipts",
	"coordinations",
	"timestamps",
	"authorities",
	"registryTargets",
	"products",
	"revisions",
	"variants",
	"mediaPlacements",
	"printSources",
	"setMembers",
	"digitalFiles",
	"shopPlacements",
	"publicationPointers",
] as const;

function snapshot(status: "absent" | "pending_inspection" | "verified", coordinationMarker = "1") {
	return {
		schemaVersion: 1 as const,
		canary: {
			receiptSetId,
			targets: targets.map((target) => ({ ...target })),
			oversizedPng: { sizeBytes: 55_009_177, widthPixels: 6_935, heightPixels: 4_623 },
		},
		v2: {
			status,
			evidence:
				status === "verified"
					? {
							fullRaster: true as const,
							safeZip: true as const,
							sharpVersion: "0.35.3",
							libvipsVersion: "8.18.3",
						}
					: null,
		},
		counts: {
			receiptCoordinations: status === "absent" ? 1 : 2,
			authorities: 12,
			printTargets: 11,
			paidTargets: 1,
			products: 33,
			revisions: 33,
			variants: 69,
			mediaPlacements: 38,
			printSources: 16,
			setMembers: 5,
			digitalFiles: 1,
			shopPlacements: 33,
			publicationPointers: 0,
		},
		digests: Object.fromEntries(
			digestKeys.map((key) => [
				key,
				["receipts", "coordinations", "timestamps"].includes(key)
					? coordinationMarker.repeat(64)
					: "f".repeat(64),
			]),
		),
	};
}

function response(status: "pending_inspection" | "verified", replayed: boolean) {
	return {
		status,
		replayed,
		assetCount: 3 as const,
		receiptSetId,
		convexDeployment: V2_CANARY_CONVEX_SELECTOR,
	};
}

function shiftRequired<T>(items: T[]) {
	const item = items.shift();
	if (!item) throw new Error("fixture queue is empty");
	return item;
}

afterEach(async () => {
	vi.restoreAllMocks();
	await Promise.all(
		temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true })),
	);
});

describe("catalog private asset V2 canary runner", () => {
	test("keeps plan mode free of execution inputs and fixes the exact confirmation", () => {
		expect(parseV2CanaryOptions([])).toEqual({ execute: false });
		expect(() => parseV2CanaryOptions(["--tenant-secret-file", "/tmp/secret"])).toThrow(
			/require --execute/,
		);
		expect(() =>
			parseV2CanaryOptions([
				"--execute",
				"--confirm",
				"wrong",
				"--tenant-secret-file",
				"/tmp/a",
				"--inspection-secret-file",
				"/tmp/b",
				"--convex-env-file",
				"/tmp/c",
			]),
		).toThrow(/requires --confirm/);
		expect(
			parseV2CanaryOptions([
				"--execute",
				"--confirm",
				V2_CANARY_CONFIRMATION,
				"--tenant-secret-file",
				"/tmp/a",
				"--inspection-secret-file",
				"/tmp/b",
				"--convex-env-file",
				"/tmp/c",
			]).execute,
		).toBe(true);
	});

	test("derives only the immutable three-object set from the checked journal", () => {
		const prints = Object.keys(journal.targets.printSources);
		const paid = Object.keys(journal.targets.paidFiles);
		const selected = loadV2CanarySelection(journal, prints, paid);
		expect(selected.map((item) => item.label)).toEqual(["jpeg", "oversized_png", "paid_zip"]);
		expect(new Set(selected.map((item) => item.targetId)).size).toBe(3);
		expect(() =>
			loadV2CanarySelection({ ...journal, receiptSetId: "drift" }, prints, paid),
		).toThrow(/identity has drifted/);
		expect(() =>
			loadV2CanarySelection(
				journal,
				[...prints.slice(0, -1), prints.at(0) ?? "missing-print"],
				paid,
			),
		).toThrow(/target set differs/);
	});

	test("requires owner-only regular secret and exact selector files", async () => {
		const directory = await mkdtemp(join(tmpdir(), "v2-canary-test-"));
		temporaryDirectories.push(directory);
		const secretPath = join(directory, "secret");
		const selectorPath = join(directory, "selector");
		await writeFile(secretPath, "s".repeat(32), { mode: 0o600 });
		await writeFile(selectorPath, "CONVEX_DEPLOYMENT=prod:loyal-swan-967\n", { mode: 0o600 });
		await expect(readV2CanarySecretFile(secretPath, "Secret file")).resolves.toBe("s".repeat(32));
		await expect(readV2CanaryConvexSelectorFile(selectorPath)).resolves.toBeUndefined();
		await chmod(secretPath, 0o640);
		await expect(readV2CanarySecretFile(secretPath, "Secret file")).rejects.toThrow(/0600/);
		const link = join(directory, "link");
		await symlink(selectorPath, link);
		await expect(readV2CanaryConvexSelectorFile(link)).rejects.toThrow(/regular file/);
		await chmod(secretPath, 0o600);
		await writeFile(selectorPath, "CONVEX_DEPLOY_KEY=forbidden\n", { mode: 0o600 });
		await expect(readV2CanaryConvexSelectorFile(selectorPath)).rejects.toThrow(/only the pinned/);
	});

	test("removes a stale success report before parsing an execution rerun", async () => {
		const directory = await mkdtemp(join(tmpdir(), "v2-canary-report-test-"));
		temporaryDirectories.push(directory);
		const reportPath = join(directory, "report.json");
		await writeFile(reportPath, '{"status":"verified"}\n', { mode: 0o600 });
		await clearV2CanaryReportForExecution([], reportPath);
		await expect(readFile(reportPath, "utf8")).resolves.toContain("verified");
		await clearV2CanaryReportForExecution(["--execute", "--invalid"], reportPath);
		await expect(readFile(reportPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
	});

	test("strips inherited Convex and unrelated credential variables from the child", () => {
		expect(
			v2CanaryConvexChildEnvironment({
				HOME: "/home/operator",
				PATH: "/bin",
				CONVEX_DEPLOY_KEY: "secret",
				CONVEX_OVERRIDE_ACCESS_TOKEN: "secret",
				VERCEL_TOKEN: "secret",
				NPM_TOKEN: "secret",
			}),
		).toEqual({
			HOME: "/home/operator",
			PATH: "/bin",
			CI: "1",
			CONVEX_DEPLOYMENT: V2_CANARY_CONVEX_SELECTOR,
		});
	});

	test("posts explicit schema 2 only to the two Worker receipt routes", async () => {
		for (const path of [V2_CANARY_STORAGE_PATH, V2_CANARY_INSPECTION_PATH] as const) {
			const fetcher = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
				expect(JSON.parse(String(init?.body))).toEqual({
					schemaVersion: 2,
					siteUrl: "angelsrest.online",
					privateObjectKeys: ["one", "two", "three"],
					expectedReceiptSetId: receiptSetId,
					expectedConvexDeployment: V2_CANARY_CONVEX_SELECTOR,
				});
				expect(init?.redirect).toBe("error");
				return Response.json(
					response(path === V2_CANARY_STORAGE_PATH ? "pending_inspection" : "verified", false),
				);
			});
			await expect(
				postV2CanaryWorkerReceipt({
					path,
					secret: "s".repeat(32),
					privateObjectKeys: ["one", "two", "three"],
					expectedReceiptSetId: receiptSetId,
					fetcher,
				}),
			).resolves.toMatchObject({ assetCount: 3 });
			expect(fetcher).toHaveBeenCalledOnce();
		}
	});

	test("rejects non-allowlisted Convex calls and malformed Worker boundaries", async () => {
		await expect(
			runV2CanaryConvexFunction({
				repositoryRoot: "/unused",
				functionName: "catalogPrivateAssets:recordStorageReceiptSet" as
					| "catalogPrivateAssets:getV2CanarySnapshot"
					| "catalogPrivateAssets:backfillTargetAuthorities",
			}),
		).rejects.toThrow(/not allowlisted/);
		for (const responseValue of [
			new Response("{}", { headers: { "Content-Type": "text/plain" } }),
			new Response("{}", {
				headers: { "Content-Type": "application/json", "Content-Length": "70000" },
			}),
			new Response("redirect", { status: 307, headers: { Location: "https://example.test" } }),
			Response.json({ ...response("pending_inspection", false), convexDeployment: "prod:wrong" }),
			Response.json({
				...response("pending_inspection", false),
				receiptSetId: `catalog-private-assets-v2:${"b".repeat(64)}`,
			}),
		]) {
			await expect(
				postV2CanaryWorkerReceipt({
					path: V2_CANARY_STORAGE_PATH,
					secret: "s".repeat(32),
					privateObjectKeys: ["one", "two", "three"],
					expectedReceiptSetId: receiptSetId,
					fetcher: async () => responseValue,
				}),
			).rejects.toThrow(/Worker/);
		}
	});

	test("executes the strict first-run delta and proves every replay byte-identical", async () => {
		const absent = snapshot("absent");
		const pending = snapshot("pending_inspection", "2");
		const verified = snapshot("verified", "3");
		const snapshots = [absent, absent, absent, pending, pending, verified, verified, verified];
		const workerResults = [
			response("pending_inspection", false),
			response("pending_inspection", true),
			response("verified", false),
			response("verified", true),
			response("verified", true),
		];
		const postWorker = vi.fn(async () => shiftRequired(workerResults));
		const result = await executeV2CanaryStateMachine({
			preManifest: "manifest",
			tenantSecret: "t".repeat(32),
			inspectionSecret: "i".repeat(32),
			privateObjectKeys: ["one", "two", "three"],
			dependencies: {
				snapshot: async () => shiftRequired(snapshots),
				backfill: async () => ({ replayed: true, targetCount: 12 }),
				postWorker,
				readPublishedManifest: async () => "manifest",
			},
		});
		expect(result).toMatchObject({
			schemaVersion: 2,
			convexDeployment: V2_CANARY_CONVEX_SELECTOR,
			receiptSetId,
			checks: {
				byteIdenticalReplays: true,
				sanityManifestUnchanged: true,
				publicationPointerCount: 0,
			},
		});
		expect(Number.isNaN(Date.parse(result.completedAt))).toBe(false);
		expect(postWorker.mock.calls.map((call) => call[0])).toEqual([
			V2_CANARY_STORAGE_PATH,
			V2_CANARY_STORAGE_PATH,
			V2_CANARY_INSPECTION_PATH,
			V2_CANARY_STORAGE_PATH,
			V2_CANARY_INSPECTION_PATH,
		]);
		expect(postWorker.mock.calls.every((call) => call[3] === receiptSetId)).toBe(true);
		const sanitized = JSON.stringify(result);
		for (const forbidden of ["image-", "file-", "sites/", "q970", "q97e", "q576", "sha256", "http"])
			expect(sanitized).not.toContain(forbidden);
	});

	test("stops after one injected network failure and relies on safe server-side resume", async () => {
		const snapshots = [snapshot("absent"), snapshot("absent"), snapshot("absent")];
		const postWorker = vi.fn(async () => {
			throw new Error("injected retryable failure");
		});
		await expect(
			executeV2CanaryStateMachine({
				preManifest: "manifest",
				tenantSecret: "t".repeat(32),
				inspectionSecret: "i".repeat(32),
				privateObjectKeys: ["one", "two", "three"],
				dependencies: {
					snapshot: async () => shiftRequired(snapshots),
					backfill: async () => ({ replayed: true, targetCount: 12 }),
					postWorker,
					readPublishedManifest: async () => "manifest",
				},
			}),
		).rejects.toThrow(/injected retryable failure/);
		expect(postWorker).toHaveBeenCalledOnce();
	});
});
