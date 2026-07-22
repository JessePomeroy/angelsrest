import { chmod, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import journal from "./migrations/angelsrest-catalog/sanity-catalog-private-asset-map.json";
import {
	clearV2CanaryArtifactsForExecution,
	clearV2CanaryFailureArtifactAfterSuccess,
	clearV2CanaryReportForExecution,
	createV2CanaryFailureArtifact,
	executeV2CanaryStateMachine,
	loadV2CanarySelection,
	parseV2CanaryBackfillResult,
	parseV2CanaryOptions,
	postV2CanaryWorkerReceipt,
	readV2CanaryConvexSelectorFile,
	readV2CanarySecretFile,
	resetV2CanaryArtifactDirectory,
	runV2CanaryCatalogStateValidation,
	runV2CanaryCatalogTransport,
	runV2CanaryConvexFunction,
	V2_CANARY_CONFIRMATION,
	V2_CANARY_CONVEX_SELECTOR,
	V2_CANARY_CONVEX_SITE_ORIGIN,
	V2_CANARY_DECODER_POLICY,
	V2_CANARY_FAILURE_ARTIFACT_PATH,
	V2_CANARY_FAILURES,
	V2_CANARY_INSPECTION_PATH,
	V2_CANARY_PHASES,
	V2_CANARY_STORAGE_PATH,
	type V2CanaryPhase,
	v2CanaryConvexChildEnvironment,
	writeV2CanaryFailureArtifact,
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

function response(
	status: "pending_inspection" | "verified",
	replayed: boolean,
	role: "storage" | "inspection" = "storage",
) {
	return {
		status,
		replayed,
		assetCount: 3 as const,
		receiptSetId,
		attestation: {
			schemaVersion: 2 as const,
			role,
			derivedReceiptSetId: receiptSetId,
			convexDeployment: V2_CANARY_CONVEX_SELECTOR,
			convexSiteOrigin: V2_CANARY_CONVEX_SITE_ORIGIN,
			decoderPolicy: V2_CANARY_DECODER_POLICY,
			decoderPolicyState: role === "storage" ? ("required" as const) : ("matched" as const),
		},
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
		expect(V2_CANARY_PHASES).toEqual([
			"preflight",
			"backfill",
			"storage_resume",
			"storage_replay",
			"inspection",
			"final_replay",
		]);
		expect(V2_CANARY_FAILURES).toEqual([
			"transport",
			"worker_4xx",
			"worker_5xx",
			"invalid_attestation",
			"state_drift",
			"operator",
		]);
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

	test("atomically creates and updates the bounded failure artifact with exact mode 0600", async () => {
		const directory = await mkdtemp(join(tmpdir(), "v2-canary-failure-test-"));
		temporaryDirectories.push(directory);
		const failurePath = join(directory, "failure.json");
		const timestamp = "2026-07-21T12:34:56.000Z";
		const forbiddenValues = [
			V2_CANARY_CONVEX_SELECTOR,
			"sites/angelsrest.online/catalog/private/object",
			receiptSetId,
			"https://worker.example.test/private",
			"a".repeat(64),
			"q970hm4246ek96y29w5hrsjkvh8axepc",
			"credential-secret-value",
			"raw upstream response text",
			"full-raster evidence",
			"angelsrest.online",
			"acct_forbidden",
		];
		const first = createV2CanaryFailureArtifact(
			new Error(forbiddenValues.join(" ")),
			"preflight",
			timestamp,
		);
		await writeV2CanaryFailureArtifact(failurePath, first);
		expect((await stat(failurePath)).mode & 0o777).toBe(0o600);
		const firstContents = await readFile(failurePath, "utf8");
		expect(JSON.parse(firstContents)).toEqual({
			schemaVersion: 1,
			phase: "preflight",
			failure: "operator",
			timestamp,
		});
		for (const forbidden of forbiddenValues) expect(firstContents).not.toContain(forbidden);
		expect(Buffer.byteLength(firstContents)).toBeLessThanOrEqual(512);

		await chmod(failurePath, 0o644);
		await writeV2CanaryFailureArtifact(failurePath, {
			schemaVersion: 1,
			phase: "inspection",
			failure: "worker_5xx",
			httpStatus: 503,
			timestamp: "2026-07-21T12:35:00.000Z",
		});
		expect((await stat(failurePath)).mode & 0o777).toBe(0o600);
		const updated = await readFile(failurePath, "utf8");
		expect(JSON.parse(updated)).toEqual({
			schemaVersion: 1,
			phase: "inspection",
			failure: "worker_5xx",
			httpStatus: 503,
			timestamp: "2026-07-21T12:35:00.000Z",
		});
		await expect(
			writeV2CanaryFailureArtifact(failurePath, {
				...first,
				credential: "must-not-write",
			} as Parameters<typeof writeV2CanaryFailureArtifact>[1]),
		).rejects.toThrow(/artifact is invalid/);
		await expect(
			writeV2CanaryFailureArtifact(failurePath, {
				...first,
				httpStatus: 600,
			}),
		).rejects.toThrow(/artifact is invalid/);
		await expect(readFile(failurePath, "utf8")).resolves.toBe(updated);
		expect(V2_CANARY_FAILURE_ARTIFACT_PATH).toMatch(/\/failure\.json$/);
	});

	test("rejects a destination symlink and deterministic write failures without touching its target", async () => {
		const directory = await mkdtemp(join(tmpdir(), "v2-canary-destination-test-"));
		temporaryDirectories.push(directory);
		const targetPath = join(directory, "target.json");
		const failurePath = join(directory, "failure.json");
		await writeFile(targetPath, "forensic-target", { mode: 0o600 });
		await symlink(targetPath, failurePath);
		const artifact = createV2CanaryFailureArtifact(new Error("raw"), "preflight");
		await expect(writeV2CanaryFailureArtifact(failurePath, artifact)).rejects.toThrow(/unsafe/);
		await expect(readFile(targetPath, "utf8")).resolves.toBe("forensic-target");
		await expect(
			writeV2CanaryFailureArtifact(join(directory, "missing", "failure.json"), artifact),
		).rejects.toThrow(/directory is unavailable/);
	});

	test("uses a fresh owner-only directory and cleans forensic state on success and start", async () => {
		const root = await mkdtemp(join(tmpdir(), "v2-canary-private-parent-test-"));
		temporaryDirectories.push(root);
		const directory = join(root, "artifacts");
		const failurePath = join(directory, "failure.json");
		await resetV2CanaryArtifactDirectory(directory);
		expect((await stat(directory)).mode & 0o777).toBe(0o700);
		await writeV2CanaryFailureArtifact(
			failurePath,
			createV2CanaryFailureArtifact(new Error("raw"), "inspection"),
		);
		await expect(readFile(failurePath, "utf8")).resolves.toContain('"phase": "inspection"');
		await clearV2CanaryFailureArtifactAfterSuccess(failurePath);
		await expect(readFile(failurePath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
		await writeV2CanaryFailureArtifact(
			failurePath,
			createV2CanaryFailureArtifact(new Error("raw"), "inspection"),
		);
		await resetV2CanaryArtifactDirectory(directory);
		expect((await stat(directory)).mode & 0o777).toBe(0o700);
		await expect(readFile(failurePath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
	});

	test("removes both success and failure artifacts only at execution start", async () => {
		const directory = await mkdtemp(join(tmpdir(), "v2-canary-artifacts-test-"));
		temporaryDirectories.push(directory);
		const successPath = join(directory, "success.json");
		const failurePath = join(directory, "failure.json");
		await Promise.all([
			writeFile(successPath, "success", { mode: 0o600 }),
			writeFile(failurePath, "failure", { mode: 0o600 }),
		]);
		await clearV2CanaryArtifactsForExecution([], [successPath, failurePath]);
		await expect(readFile(successPath, "utf8")).resolves.toBe("success");
		await expect(readFile(failurePath, "utf8")).resolves.toBe("failure");
		await clearV2CanaryArtifactsForExecution(["--execute"], [successPath, failurePath]);
		await expect(readFile(successPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
		await expect(readFile(failurePath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
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

	test("posts the exact schema-2 expectation and requires exact route attestations", async () => {
		for (const path of [V2_CANARY_STORAGE_PATH, V2_CANARY_INSPECTION_PATH] as const) {
			const role = path === V2_CANARY_STORAGE_PATH ? "storage" : "inspection";
			const fetcher = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
				expect(JSON.parse(String(init?.body))).toEqual({
					schemaVersion: 2,
					siteUrl: "angelsrest.online",
					privateObjectKeys: ["one", "two", "three"],
					expectation: {
						receiptSetId,
						convexDeployment: "prod:loyal-swan-967",
						convexSiteOrigin: "https://loyal-swan-967.convex.site",
						decoderPolicy: {
							printSource: {
								method: "sharp_libvips_full_raster_v1",
								sharpVersion: "0.35.3",
								libvipsVersion: "8.18.3",
							},
							paidDigitalFile: { method: "safe_zip_v1" },
						},
					},
				});
				expect(init?.redirect).toBe("error");
				return Response.json(
					response(
						path === V2_CANARY_STORAGE_PATH ? "pending_inspection" : "verified",
						false,
						role,
					),
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
		const valid = response("pending_inspection", false);
		const oldUnattestedResponse = {
			status: "pending_inspection",
			replayed: false,
			assetCount: 3,
			receiptSetId,
		};
		for (const responseValue of [
			new Response("{}", { headers: { "Content-Type": "text/plain" } }),
			new Response("{}", {
				headers: { "Content-Type": "application/json", "Content-Length": "70000" },
			}),
			new Response("redirect", { status: 307, headers: { Location: "https://example.test" } }),
			Response.json(oldUnattestedResponse),
			Response.json({ ...valid, unexpected: "field" }),
			Response.json({
				...valid,
				receiptSetId: `catalog-private-assets-v2:${"b".repeat(64)}`,
			}),
			Response.json({
				...valid,
				attestation: {
					...valid.attestation,
					derivedReceiptSetId: `catalog-private-assets-v2:${"b".repeat(64)}`,
				},
			}),
			Response.json({
				...valid,
				attestation: { ...valid.attestation, role: "inspection" },
			}),
			Response.json({
				...valid,
				attestation: { ...valid.attestation, convexDeployment: "prod:wrong" },
			}),
			Response.json({
				...valid,
				attestation: { ...valid.attestation, convexSiteOrigin: "https://wrong.convex.site" },
			}),
			Response.json({
				...valid,
				attestation: {
					...valid.attestation,
					decoderPolicy: {
						...valid.attestation.decoderPolicy,
						printSource: {
							...valid.attestation.decoderPolicy.printSource,
							method: "wrong",
						},
					},
				},
			}),
			...(["sharpVersion", "libvipsVersion"] as const).map((field) =>
				Response.json({
					...valid,
					attestation: {
						...valid.attestation,
						decoderPolicy: {
							...valid.attestation.decoderPolicy,
							printSource: {
								...valid.attestation.decoderPolicy.printSource,
								[field]: "wrong",
							},
						},
					},
				}),
			),
			Response.json({
				...valid,
				attestation: {
					...valid.attestation,
					decoderPolicy: {
						...valid.attestation.decoderPolicy,
						paidDigitalFile: { method: "wrong" },
					},
				},
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

	test("classifies catalog network as transport and malformed fixed state as state drift", async () => {
		const timestamp = "2026-07-21T12:59:00.000Z";
		const networkFailure = await runV2CanaryCatalogTransport(async () => {
			throw new Error("raw catalog network response");
		}).catch((error: unknown) => error);
		expect(createV2CanaryFailureArtifact(networkFailure, "preflight", timestamp)).toEqual({
			schemaVersion: 1,
			phase: "preflight",
			failure: "transport",
			timestamp,
		});

		for (const malformed of [
			async () => JSON.parse("malformed journal"),
			async () => {
				throw new Error("malformed catalog");
			},
			async () => {
				throw new Error("baseline drift");
			},
		]) {
			const failure = await runV2CanaryCatalogStateValidation(malformed).catch(
				(error: unknown) => error,
			);
			expect(createV2CanaryFailureArtifact(failure, "preflight", timestamp).failure).toBe(
				"state_drift",
			);
		}
		const malformedBackfill = await Promise.resolve()
			.then(() => parseV2CanaryBackfillResult({ replayed: "yes", targetCount: 12 }))
			.catch((error: unknown) => error);
		expect(createV2CanaryFailureArtifact(malformedBackfill, "backfill", timestamp).failure).toBe(
			"state_drift",
		);

		let phase: V2CanaryPhase = "preflight";
		const stateMachineFailure = await executeV2CanaryStateMachine({
			preManifest: "manifest",
			tenantSecret: "t".repeat(32),
			inspectionSecret: "i".repeat(32),
			privateObjectKeys: ["one", "two", "three"],
			onPhase: (nextPhase) => {
				phase = nextPhase;
			},
			dependencies: {
				snapshot: async () => snapshot("absent"),
				backfill: async () =>
					({ replayed: "malformed", targetCount: 12 }) as unknown as {
						replayed: boolean;
						targetCount: 12;
					},
				postWorker: vi.fn(),
				readPublishedManifest: async () => "manifest",
			},
		}).catch((error: unknown) => error);
		expect(createV2CanaryFailureArtifact(stateMachineFailure, phase, timestamp)).toMatchObject({
			phase: "backfill",
			failure: "state_drift",
		});
	});

	test("classifies transport, malformed 2xx, redirects, and bounded Worker failures without raw values", async () => {
		const timestamp = "2026-07-21T13:00:00.000Z";
		const classify = async (fetcher: typeof fetch) => {
			let failure: unknown;
			try {
				await postV2CanaryWorkerReceipt({
					path: V2_CANARY_INSPECTION_PATH,
					secret: "s".repeat(32),
					privateObjectKeys: ["one", "two", "three"],
					expectedReceiptSetId: receiptSetId,
					fetcher,
				});
			} catch (error) {
				failure = error;
			}
			return createV2CanaryFailureArtifact(failure, "inspection", timestamp);
		};
		const rawForbidden = `${V2_CANARY_CONVEX_SELECTOR} sites/private ${receiptSetId} credential`;
		const cases = [
			{
				fetcher: vi.fn(async () => {
					throw new Error(rawForbidden);
				}) as typeof fetch,
				expected: { failure: "transport" },
			},
			{
				fetcher: vi.fn(
					async () =>
						new Response(rawForbidden, {
							headers: { "Content-Type": "application/json" },
						}),
				) as typeof fetch,
				expected: { failure: "invalid_attestation" },
			},
			{
				fetcher: vi.fn(async () => Response.json({ raw: rawForbidden })) as typeof fetch,
				expected: { failure: "invalid_attestation" },
			},
			{
				fetcher: vi.fn(async () => new Response(rawForbidden, { status: 307 })) as typeof fetch,
				expected: { failure: "transport", httpStatus: 307 },
			},
			{
				fetcher: vi.fn(async () => new Response(rawForbidden, { status: 429 })) as typeof fetch,
				expected: { failure: "worker_4xx", httpStatus: 429 },
			},
			{
				fetcher: vi.fn(async () => new Response(rawForbidden, { status: 503 })) as typeof fetch,
				expected: { failure: "worker_5xx", httpStatus: 503 },
			},
		] as const;
		for (const item of cases) {
			const artifact = await classify(item.fetcher);
			expect(artifact).toEqual({
				schemaVersion: 1,
				phase: "inspection",
				...item.expected,
				timestamp,
			});
			expect(JSON.stringify(artifact)).not.toContain(rawForbidden);
		}
	});

	test("executes the strict first-run delta and proves every replay byte-identical", async () => {
		const absent = snapshot("absent");
		const pending = snapshot("pending_inspection", "2");
		const verified = snapshot("verified", "3");
		const snapshots = [absent, absent, absent, pending, pending, verified, verified, verified];
		const workerResults = [
			response("pending_inspection", false, "storage"),
			response("pending_inspection", true, "storage"),
			response("verified", false, "inspection"),
			response("verified", true, "storage"),
			response("verified", true, "inspection"),
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

	test("resumes pending state in exact call order and marks inspection before attempting it", async () => {
		const pending = snapshot("pending_inspection", "2");
		const verified = snapshot("verified", "3");
		const snapshots = [pending, pending, pending, pending, pending, verified, verified, verified];
		const workerResults = [
			response("pending_inspection", true, "storage"),
			response("pending_inspection", true, "storage"),
			response("verified", false, "inspection"),
			response("verified", true, "storage"),
			response("verified", true, "inspection"),
		];
		const phases: string[] = [];
		const postWorker = vi.fn(async () => shiftRequired(workerResults));
		await executeV2CanaryStateMachine({
			preManifest: "manifest",
			tenantSecret: "t".repeat(32),
			inspectionSecret: "i".repeat(32),
			privateObjectKeys: ["one", "two", "three"],
			onPhase: (phase) => phases.push(phase),
			dependencies: {
				snapshot: async () => shiftRequired(snapshots),
				backfill: async () => ({ replayed: true, targetCount: 12 }),
				postWorker,
				readPublishedManifest: async () => "manifest",
			},
		});
		expect(phases).toEqual([
			"preflight",
			"backfill",
			"storage_resume",
			"storage_replay",
			"inspection",
			"final_replay",
		]);
		expect(postWorker.mock.calls.map(([path]) => path)).toEqual([
			V2_CANARY_STORAGE_PATH,
			V2_CANARY_STORAGE_PATH,
			V2_CANARY_INSPECTION_PATH,
			V2_CANARY_STORAGE_PATH,
			V2_CANARY_INSPECTION_PATH,
		]);
		expect(postWorker.mock.calls.map(([, secret]) => secret)).toEqual([
			"t".repeat(32),
			"t".repeat(32),
			"i".repeat(32),
			"t".repeat(32),
			"i".repeat(32),
		]);
	});

	test.each([
		{ initialStatus: "pending_inspection", replayStatus: "verified" },
		{ initialStatus: "verified", replayStatus: "pending_inspection" },
	] as const)("rejects a $initialStatus storage replay response that disagrees with observed server status", async ({
		initialStatus,
		replayStatus,
	}) => {
		const observed = snapshot(initialStatus, initialStatus === "verified" ? "3" : "2");
		const snapshots = [observed, observed, observed, observed, observed];
		const workerResults = [
			response(initialStatus, true, "storage"),
			response(replayStatus, true, "storage"),
		];
		const postWorker = vi.fn(async () => shiftRequired(workerResults));
		const failure = await executeV2CanaryStateMachine({
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
		}).catch((error: unknown) => error);
		expect(createV2CanaryFailureArtifact(failure, "storage_replay")).toMatchObject({
			failure: "state_drift",
			phase: "storage_replay",
		});
		expect(postWorker).toHaveBeenCalledTimes(2);
	});

	test("resumes an ambiguous inspection commit from verified-at-start state without another write", async () => {
		const verified = snapshot("verified", "3");
		const snapshots = Array.from({ length: 8 }, () => verified);
		const workerResults = [
			response("verified", true, "storage"),
			response("verified", true, "storage"),
			response("verified", true, "inspection"),
			response("verified", true, "storage"),
			response("verified", true, "inspection"),
		];
		const postWorker = vi.fn(async () => shiftRequired(workerResults));
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
		).resolves.toMatchObject({ status: "verified", checks: { byteIdenticalReplays: true } });
		expect(postWorker.mock.calls.map(([path]) => path)).toEqual([
			V2_CANARY_STORAGE_PATH,
			V2_CANARY_STORAGE_PATH,
			V2_CANARY_INSPECTION_PATH,
			V2_CANARY_STORAGE_PATH,
			V2_CANARY_INSPECTION_PATH,
		]);
	});

	test("records inspection phase before an attempted pending-resume inspection fails", async () => {
		const pending = snapshot("pending_inspection", "2");
		const snapshots = [pending, pending, pending, pending, pending];
		let phase: V2CanaryPhase = "preflight";
		const postWorker = vi.fn(async (path: string) => {
			if (path === V2_CANARY_INSPECTION_PATH) throw new Error("secret raw inspection failure");
			return response("pending_inspection", true, "storage");
		});
		let failure: unknown;
		try {
			await executeV2CanaryStateMachine({
				preManifest: "manifest",
				tenantSecret: "t".repeat(32),
				inspectionSecret: "i".repeat(32),
				privateObjectKeys: ["one", "two", "three"],
				onPhase: (nextPhase) => {
					phase = nextPhase;
				},
				dependencies: {
					snapshot: async () => shiftRequired(snapshots),
					backfill: async () => ({ replayed: true, targetCount: 12 }),
					postWorker,
					readPublishedManifest: async () => "manifest",
				},
			});
		} catch (error) {
			failure = error;
		}
		expect(postWorker.mock.calls.map(([path]) => path)).toEqual([
			V2_CANARY_STORAGE_PATH,
			V2_CANARY_STORAGE_PATH,
			V2_CANARY_INSPECTION_PATH,
		]);
		expect(createV2CanaryFailureArtifact(failure, phase)).toMatchObject({
			phase: "inspection",
			failure: "transport",
		});
	});

	test("stops before inspection when storage does not change the pinned deployment", async () => {
		const unchanged = snapshot("absent");
		const snapshots = [unchanged, unchanged, unchanged, unchanged];
		const postWorker = vi.fn(async () => response("pending_inspection", false));
		const failure = await executeV2CanaryStateMachine({
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
		}).catch((error: unknown) => error);
		expect(failure).toBeInstanceOf(Error);
		expect((failure as Error).message).toMatch(/First storage receipt/);
		expect(createV2CanaryFailureArtifact(failure, "storage_resume")).toMatchObject({
			phase: "storage_resume",
			failure: "state_drift",
		});
		expect(postWorker).toHaveBeenCalledOnce();
		expect(postWorker).toHaveBeenCalledWith(
			V2_CANARY_STORAGE_PATH,
			"t".repeat(32),
			["one", "two", "three"],
			receiptSetId,
		);
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
		).rejects.toThrow(/did not complete/);
		expect(postWorker).toHaveBeenCalledOnce();
	});
});
