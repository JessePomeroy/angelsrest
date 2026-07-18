import { describe, expect, test, vi } from "vitest";
import {
	assertSafeConvexProductionEnvFile,
	BLOG_MEDIA_DERIVATIVES,
	type ConvexImportTargetProjection,
	collectPublishedSanityBlogImageAssetRefs,
	parseConvexImportTargetProjections,
	parseSanityBlogImageAssetJournal,
	parseSanityBlogMediaTransferReceipts,
	probeSanityBlogMediaDerivatives,
	type SanityBlogMediaTransferReceipts,
	sanitizedConvexCliEnvironment,
	verifySanityBlogMediaTargets,
} from "./sanityBlogMediaVerification";

const ASSET_A = "image-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-600x400-jpg";
const ASSET_B = "image-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb-400x600-png";
const MEDIA_ID_A = "nh744cpb0en9t6nx89xpjdn8ts8arc2m";
const MEDIA_ID_B = "jh744cpb0en9t6nx89xpjdn8ts8arc2n";
const WORKER_ID_A = "7e11be6a-7e30-4317-aad5-08f4c00333b4";
const WORKER_ID_B = "8e11be6a-7e30-4317-aad5-08f4c00333b5";

function receiptFile(
	receipts: SanityBlogMediaTransferReceipts["receipts"] = {
		[ASSET_A]: {
			mediaAssetId: MEDIA_ID_A,
			workerAssetId: WORKER_ID_A,
			source: {
				contentType: "image/jpeg",
				sizeBytes: 123_456,
				width: 600,
				height: 400,
			},
		},
	},
): SanityBlogMediaTransferReceipts {
	return {
		schemaVersion: 1,
		siteUrl: "angelsrest.online",
		sanity: { projectId: "n7rvza4g", dataset: "production" },
		receipts,
	};
}

function target({
	mediaAssetId = MEDIA_ID_A,
	workerAssetId = WORKER_ID_A,
	source = receiptFile().receipts[ASSET_A]?.source,
}: {
	mediaAssetId?: string;
	workerAssetId?: string;
	source?: ConvexImportTargetProjection["source"];
} = {}): ConvexImportTargetProjection {
	if (!source) throw new Error("Expected source fixture");
	const dimensions = (maxWidth: number) => {
		const width = Math.min(source.width, maxWidth);
		return {
			width,
			height: Math.max(1, Math.round(source.height * (width / source.width))),
		};
	};
	return {
		mediaAssetId,
		workerAssetId,
		siteUrl: "angelsrest.online",
		intent: "web",
		status: "ready",
		source,
		masterIdentityMatches: true,
		derivatives: Object.fromEntries(
			Object.entries(BLOG_MEDIA_DERIVATIVES).map(([name, spec]) => [
				name,
				{
					identityMatches: true,
					contentType: "image/webp",
					...dimensions(spec.maxWidth),
				},
			]),
		) as ConvexImportTargetProjection["derivatives"],
	};
}

function sourceA() {
	const source = receiptFile().receipts[ASSET_A]?.source;
	if (!source) throw new Error("Expected source fixture");
	return source;
}

describe("Sanity Blog media target verification", () => {
	test("requires an unambiguous cloud project selector for production Convex", () => {
		expect(() =>
			assertSafeConvexProductionEnvFile(
				"CONVEX_DEPLOYMENT=dev:example-deployment-123 # team/project\n",
			),
		).not.toThrow();
		expect(() =>
			assertSafeConvexProductionEnvFile("CONVEX_DEPLOYMENT=prod:example-deployment-123\n"),
		).not.toThrow();
		expect(() => assertSafeConvexProductionEnvFile("CONVEX_DEPLOY_KEY=secret\n")).toThrow(
			/forbids CONVEX_DEPLOY_KEY/,
		);
		expect(() =>
			assertSafeConvexProductionEnvFile("CONVEX_DEPLOYMENT=dev:one\nCONVEX_DEPLOYMENT=prod:two\n"),
		).toThrow(/repeats CONVEX_DEPLOYMENT/);
		expect(() =>
			assertSafeConvexProductionEnvFile(
				"CONVEX_DEPLOYMENT=dev:one\nexport CONVEX_DEPLOYMENT=prod:two\n",
			),
		).toThrow(/canonical NAME=value/);
		expect(() =>
			assertSafeConvexProductionEnvFile("PUBLIC_CONVEX_URL=https://example.com\n"),
		).toThrow(/requires one cloud CONVEX_DEPLOYMENT/);
	});

	test("removes every inherited Convex variable from the production CLI child", () => {
		expect(
			sanitizedConvexCliEnvironment({
				PATH: "/usr/bin",
				HOME: "/tmp/home",
				CONVEX_DEPLOYMENT: "dev:wrong-project",
				CONVEX_DEPLOY_KEY: "secret",
				CONVEX_OVERRIDE_ACCESS_TOKEN: "secret",
				CONVEX_PROVISION_HOST: "https://attacker.example",
			}),
		).toEqual({ PATH: "/usr/bin", HOME: "/tmp/home" });
	});

	test("strictly parses the journal, receipts, and sanitized Convex projection", () => {
		expect(parseSanityBlogImageAssetJournal({ [ASSET_A]: MEDIA_ID_A, [ASSET_B]: "" })).toEqual({
			[ASSET_A]: MEDIA_ID_A,
			[ASSET_B]: "",
		});
		expect(
			parseSanityBlogMediaTransferReceipts({
				...receiptFile(),
				receipts: receiptFile().receipts,
			}),
		).toEqual(receiptFile());
		expect(parseConvexImportTargetProjections([target()])).toEqual([target()]);

		expect(() => parseSanityBlogImageAssetJournal({ "image-not-canonical": "" })).toThrow(
			/canonical Sanity image/,
		);
		expect(() =>
			parseSanityBlogMediaTransferReceipts({ ...receiptFile(), unexpected: true }),
		).toThrow(/unexpected or missing fields/);
		expect(() =>
			parseSanityBlogMediaTransferReceipts({
				...receiptFile(),
				receipts: {
					...receiptFile().receipts,
					[ASSET_B]: {
						mediaAssetId: MEDIA_ID_A,
						workerAssetId: WORKER_ID_B,
						source: {
							contentType: "image/png",
							sizeBytes: 456,
							width: 400,
							height: 600,
						},
					},
				},
			}),
		).toThrow(/duplicate a Convex ID/);
	});

	test("collects and deduplicates only published Blog image placements", () => {
		expect(
			collectPublishedSanityBlogImageAssetRefs({
				authors: [{ image: { asset: { _ref: ASSET_A } } }],
				posts: [
					{
						mainImage: { asset: { _ref: ASSET_B } },
						body: [
							{ _type: "block", asset: { _ref: ASSET_A } },
							{ _type: "image", asset: { _ref: ASSET_A } },
						],
					},
				],
			}),
		).toEqual([ASSET_A, ASSET_B]);
	});

	test("accepts blank mappings as a verified partial state", () => {
		const report = verifySanityBlogMediaTargets({
			sourceAssetRefs: [ASSET_B, ASSET_A],
			journal: { [ASSET_A]: MEDIA_ID_A, [ASSET_B]: "" },
			receiptFile: receiptFile(),
			convexTargets: [target()],
		});

		expect(report.status).toBe("registry-verified-partial");
		expect(report.counts).toEqual({
			sourceAssets: 2,
			mappedAssets: 1,
			unmappedAssets: 1,
			registryVerifiedAssets: 1,
			issues: 0,
		});
		expect(report.assets.map((asset) => asset.status)).toEqual(["registry-verified", "unmapped"]);
	});

	test("blocks journal, receipt, tenant, state, and derivative drift", () => {
		const mismatchedTarget = target();
		mismatchedTarget.siteUrl = "other.example";
		mismatchedTarget.status = "deleting";
		mismatchedTarget.masterIdentityMatches = false;
		mismatchedTarget.derivatives.card = {
			...mismatchedTarget.derivatives.card,
			identityMatches: false,
			contentType: "image/jpeg",
			width: 1,
		};
		const report = verifySanityBlogMediaTargets({
			sourceAssetRefs: [ASSET_A],
			journal: { [ASSET_A]: MEDIA_ID_A, [ASSET_B]: MEDIA_ID_A },
			receiptFile: receiptFile(),
			convexTargets: [mismatchedTarget],
		});

		expect(report.status).toBe("blocked");
		expect(report.issues.map((issue) => issue.code)).toEqual(
			expect.arrayContaining([
				"journal-stale-source",
				"journal-duplicate-target",
				"receipt-missing",
				"convex-site-mismatch",
				"convex-status-mismatch",
				"master-identity-mismatch",
				"derivative-identity-mismatch",
				"derivative-content-type-mismatch",
				"derivative-dimensions-mismatch",
			]),
		);
		expect(report.assets[0]?.status).toBe("blocked");
	});

	test.each([
		["Worker UUID", { workerAssetId: WORKER_ID_B }, "worker-identity-mismatch"],
		[
			"source MIME",
			{ source: { ...sourceA(), contentType: "image/png" as const } },
			"source-metadata-mismatch",
		],
		["source bytes", { source: { ...sourceA(), sizeBytes: 123_457 } }, "source-metadata-mismatch"],
		["source dimensions", { source: { ...sourceA(), width: 599 } }, "source-metadata-mismatch"],
	] as const)("blocks %s drift", (_label, overrides, expectedCode) => {
		const report = verifySanityBlogMediaTargets({
			sourceAssetRefs: [ASSET_A],
			journal: { [ASSET_A]: MEDIA_ID_A },
			receiptFile: receiptFile(),
			convexTargets: [target(overrides)],
		});
		expect(report.status).toBe("blocked");
		expect(report.issues.map((issue) => issue.code)).toContain(expectedCode);
	});

	test("blocks a missing Convex target and a deleting target", () => {
		const missing = verifySanityBlogMediaTargets({
			sourceAssetRefs: [ASSET_A],
			journal: { [ASSET_A]: MEDIA_ID_A },
			receiptFile: receiptFile(),
			convexTargets: [],
		});
		const deletingTarget = target();
		deletingTarget.status = "deleting";
		const deleting = verifySanityBlogMediaTargets({
			sourceAssetRefs: [ASSET_A],
			journal: { [ASSET_A]: MEDIA_ID_A },
			receiptFile: receiptFile(),
			convexTargets: [deletingTarget],
		});

		expect(missing.status).toBe("blocked");
		expect(missing.issues.map((issue) => issue.code)).toContain("convex-target-missing");
		expect(deleting.status).toBe("blocked");
		expect(deleting.issues.map((issue) => issue.code)).toContain("convex-status-mismatch");
	});

	test("probes all five public derivatives without retaining their URLs", async () => {
		const report = verifySanityBlogMediaTargets({
			sourceAssetRefs: [ASSET_A],
			journal: { [ASSET_A]: MEDIA_ID_A },
			receiptFile: receiptFile(),
			convexTargets: [target()],
		});
		const fetcher = vi.fn<typeof fetch>(
			async () => new Response(null, { status: 200, headers: { "content-type": "image/webp" } }),
		);
		const probed = await probeSanityBlogMediaDerivatives(report, {
			fetcher,
			mediaBaseUrl: "https://media.angelsrest.online",
		});

		expect(fetcher).toHaveBeenCalledTimes(5);
		expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
			`https://media.angelsrest.online/sites/angelsrest.online/web/${WORKER_ID_A}/thumb.webp`,
			`https://media.angelsrest.online/sites/angelsrest.online/web/${WORKER_ID_A}/card.webp`,
			`https://media.angelsrest.online/sites/angelsrest.online/web/${WORKER_ID_A}/display-1280.webp`,
			`https://media.angelsrest.online/sites/angelsrest.online/web/${WORKER_ID_A}/display-2048.webp`,
			`https://media.angelsrest.online/sites/angelsrest.online/web/${WORKER_ID_A}/display-2560.webp`,
		]);
		expect(
			fetcher.mock.calls.every(([, init]) => init?.method === "HEAD" && init.redirect === "error"),
		).toBe(true);
		expect(probed.status).toBe("registry-verified-complete");
		expect(JSON.stringify(probed)).not.toContain("https://media.angelsrest.online");

		fetcher.mockImplementationOnce(async () => new Response(null, { status: 404 }));
		const blocked = await probeSanityBlogMediaDerivatives(report, {
			fetcher,
			mediaBaseUrl: "https://media.angelsrest.online",
		});
		expect(blocked.status).toBe("blocked");
		expect(blocked.issues[0]?.code).toBe("derivative-probe-failed");
	});

	test("does not probe any URL when target verification is already blocked", async () => {
		const report = verifySanityBlogMediaTargets({
			sourceAssetRefs: [ASSET_A],
			journal: { [ASSET_A]: MEDIA_ID_A },
			receiptFile: receiptFile(),
			convexTargets: [],
		});
		const fetcher = vi.fn<typeof fetch>();
		const result = await probeSanityBlogMediaDerivatives(report, {
			fetcher,
			mediaBaseUrl: "https://media.angelsrest.online",
		});

		expect(result.status).toBe("blocked");
		expect(fetcher).not.toHaveBeenCalled();
	});

	test("does not conflate Worker UUIDs with Convex media IDs", () => {
		const receipts = receiptFile({
			[ASSET_A]: {
				mediaAssetId: MEDIA_ID_A,
				workerAssetId: WORKER_ID_A,
				source: sourceA(),
			},
			[ASSET_B]: {
				mediaAssetId: MEDIA_ID_B,
				workerAssetId: WORKER_ID_B,
				source: {
					contentType: "image/png",
					sizeBytes: 123,
					width: 400,
					height: 600,
				},
			},
		});
		expect(receipts.receipts[ASSET_B]?.mediaAssetId).not.toBe(
			receipts.receipts[ASSET_B]?.workerAssetId,
		);
	});
});
