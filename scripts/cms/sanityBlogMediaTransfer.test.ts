import { createHash } from "node:crypto";
import { describe, expect, test, vi } from "vitest";
import {
	CMS_BLOG_MEDIA_BATCH_ID,
	CMS_BLOG_MEDIA_PRODUCTION_CONFIRMATION,
	CMS_BLOG_MEDIA_PRODUCTION_ORIGIN,
	CMS_BLOG_MEDIA_SOURCE_ASSET_REFS,
	CMS_BLOG_MEDIA_SOURCE_EXPECTATIONS,
	createCandidateSanityBlogMediaJournals,
	createCmsMediaCapabilityRequest,
	createCmsMediaProcessRequest,
	createCmsMediaUploadRequest,
	createInitialSanityBlogMediaTransferCheckpoint,
	createSanityBlogMediaTransferPlan,
	deterministicSanitySourceFilename,
	parseCmsMediaCapability,
	parseSanityBlogMediaTransferCheckpoint,
	parseSanityBlogMediaTransferOptions,
	privateObjectKeyForAsset,
	reconcileSanityBlogMediaJournalState,
	replaceCheckpointAsset,
	transferSanityBlogMediaAsset,
	validateCompletedSanityBlogMediaAsset,
	validateSanityImageSourceAgainstExpectation,
} from "./sanityBlogMediaTransfer";
import type {
	BlogMediaSource,
	SanityBlogMediaTransferReceipts,
} from "./sanityBlogMediaVerification";

const SOURCE_REF = CMS_BLOG_MEDIA_SOURCE_ASSET_REFS[0];
const SECOND_SOURCE_REF = CMS_BLOG_MEDIA_SOURCE_ASSET_REFS[1];
const COMPLETED_PREVIOUS_BATCH = [
	[
		"image-db60afd87e022cd5d4fa54f5c4a3fe97ceb57cd6-2624x1876-png",
		{
			mediaAssetId: "nh7465v8hrr69zxcmesn2vv7198at3ar",
			workerAssetId: "035ff965-e981-4e5a-9c18-77063973260d",
			sourceSha256: "d8387375df9a40cf7cf144e46175f9f928f40767b06d4ecda29426ff0e14b08f",
			source: { contentType: "image/png", sizeBytes: 516_659, width: 2624, height: 1876 },
		},
	],
	[
		"image-4cc2102493e41f18ed7f2727a88b80b5007741a2-2624x1876-png",
		{
			mediaAssetId: "nh78t9bnxkmjyg2qane1r2sxtd8av8f8",
			workerAssetId: "3c131d4c-a8da-4f57-88ac-0d9fe0f90f28",
			sourceSha256: "7b35198251e392b180b2e3e2a88fd92381eb1affc016b562a2c7c6756fff7879",
			source: { contentType: "image/png", sizeBytes: 619_435, width: 2624, height: 1876 },
		},
	],
	[
		"image-09a2b170c772750958a7f5b224a19be7f748e12c-2624x1876-png",
		{
			mediaAssetId: "nh764kjk6wvwcv18tkc47gbsnh8av5rq",
			workerAssetId: "cf6e8162-a988-476d-b23f-50cb678272f9",
			sourceSha256: "36627a3e7af7aec59a2e26e58ae9ca41cb31b8449c235566ce11d84797262d07",
			source: { contentType: "image/png", sizeBytes: 1_408_551, width: 2624, height: 1876 },
		},
	],
	[
		"image-bfe45aa66ae0403bb2ff0940c1f7b7421cc27628-2624x1876-png",
		{
			mediaAssetId: "nh753qjrs276k00r2adcjkjgps8av7g4",
			workerAssetId: "672e2192-5ac3-4614-b58e-88535623b0e1",
			sourceSha256: "212ebaf2c307dc079018aa1ab348e35556f8e01b9be50f29187a41261a43d876",
			source: { contentType: "image/png", sizeBytes: 1_446_326, width: 2624, height: 1876 },
		},
	],
	[
		"image-efdb9b1e4b4f95723596ace8d0f2b4f6be06fe62-2400x1654-png",
		{
			mediaAssetId: "nh7fqyqh8azkdzcmwzerw495eh8av8d9",
			workerAssetId: "18208e39-0cd3-45f4-b89c-d3c7dee014e8",
			sourceSha256: "96b938e7440b7a684289466abaea39b1c6c63b07ba2b315ee483e8d7705497a7",
			source: { contentType: "image/png", sizeBytes: 1_004_790, width: 2400, height: 1654 },
		},
	],
] as const satisfies ReadonlyArray<
	readonly [string, SanityBlogMediaTransferReceipts["receipts"][string]]
>;
const WORKER_ID = "7e11be6a-7e30-4317-aad5-08f4c00333b4";
const MEDIA_ID = "nh744cpb0en9t6nx89xpjdn8ts8arc2m";
const COOKIE = "better-auth.session_token=test-cookie";
const UPLOAD_TOKEN = "test-upload-capability";
const NOW = Date.UTC(2026, 6, 18, 12, 0, 0);
const SOURCE_BYTES = new Uint8Array([1, 2, 3, 4]);
const SOURCE_SHA256 = createHash("sha256").update(SOURCE_BYTES).digest("hex");
const SOURCE: BlogMediaSource = {
	contentType: "image/jpeg",
	sizeBytes: SOURCE_BYTES.byteLength,
	width: 2,
	height: 2,
};
const JOURNAL_SOURCE: BlogMediaSource = {
	contentType: CMS_BLOG_MEDIA_SOURCE_EXPECTATIONS[SOURCE_REF].contentType,
	sizeBytes: CMS_BLOG_MEDIA_SOURCE_EXPECTATIONS[SOURCE_REF].sizeBytes,
	width: CMS_BLOG_MEDIA_SOURCE_EXPECTATIONS[SOURCE_REF].width,
	height: CMS_BLOG_MEDIA_SOURCE_EXPECTATIONS[SOURCE_REF].height,
};

function blankReceipts(): SanityBlogMediaTransferReceipts {
	return {
		schemaVersion: 2,
		siteUrl: "angelsrest.online",
		sanity: { projectId: "n7rvza4g", dataset: "production" },
		receipts: {},
	};
}

function blankJournal() {
	return Object.fromEntries(
		CMS_BLOG_MEDIA_SOURCE_ASSET_REFS.map((sourceAssetRef) => [sourceAssetRef, ""]),
	);
}

function executeArgs({
	confirmation = CMS_BLOG_MEDIA_PRODUCTION_CONFIRMATION,
	sourceAssetRefs = [...CMS_BLOG_MEDIA_SOURCE_ASSET_REFS].reverse(),
}: {
	confirmation?: string;
	sourceAssetRefs?: readonly string[];
} = {}) {
	return [
		"--execute",
		"--confirm",
		confirmation,
		"--cookie-file",
		"/tmp/cookie",
		...sourceAssetRefs.flatMap((sourceAssetRef) => ["--source-ref", sourceAssetRef]),
	];
}

function initialCheckpoint() {
	return createInitialSanityBlogMediaTransferCheckpoint({
		imageAssetMap: "a".repeat(64),
		transferReceipts: "b".repeat(64),
	});
}

function capabilityValue() {
	const privateObjectKey = privateObjectKeyForAsset(WORKER_ID, "jpg");
	return {
		assetId: WORKER_ID,
		privateObjectKey,
		uploadUrl: `https://cms-media-worker.thinkingofview.workers.dev/v1/uploads/source?key=${encodeURIComponent(privateObjectKey)}`,
		uploadToken: UPLOAD_TOKEN,
		expiresAt: new Date(NOW + 15 * 60 * 1000).toISOString(),
	};
}

function parsedCapability() {
	return parseCmsMediaCapability(capabilityValue(), { sourceAssetRef: SOURCE_REF, nowMs: NOW });
}

function processValue() {
	const prefix = `sites/angelsrest.online/web/${WORKER_ID}`;
	return {
		asset: {
			_id: MEDIA_ID,
			assetId: WORKER_ID,
			originalFilename: deterministicSanitySourceFilename(SOURCE_REF),
			status: "ready",
			source: SOURCE,
			derivatives: {
				thumb: {
					key: `${prefix}/thumb.webp`,
					contentType: "image/webp",
					width: 2,
					height: 2,
				},
				card: {
					key: `${prefix}/card.webp`,
					contentType: "image/webp",
					width: 2,
					height: 2,
				},
			},
			createdAt: NOW,
		},
	};
}

function successFetcher({
	upload,
	process,
}: {
	upload?: () => Promise<Response>;
	process?: () => Promise<Response>;
} = {}) {
	return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
		void init;
		const url = String(input);
		if (url.endsWith("/api/admin/media/capability")) {
			return Response.json(capabilityValue());
		}
		if (url.startsWith("https://cms-media-worker.thinkingofview.workers.dev/")) {
			return upload
				? await upload()
				: Response.json({ success: true, assetId: WORKER_ID, status: "uploaded" });
		}
		if (url.endsWith("/api/admin/media/process")) {
			return process ? await process() : Response.json(processValue());
		}
		throw new Error("unexpected request");
	}) as unknown as typeof fetch;
}

describe("active Blog media transfer batch policy", () => {
	test("defaults to plan-only and requires the exact bounded production confirmation", () => {
		expect(CMS_BLOG_MEDIA_SOURCE_ASSET_REFS).toHaveLength(10);
		expect(new Set(CMS_BLOG_MEDIA_SOURCE_ASSET_REFS).size).toBe(10);
		expect(initialCheckpoint().migration).toBe(CMS_BLOG_MEDIA_BATCH_ID);
		expect(() =>
			parseSanityBlogMediaTransferCheckpoint({
				...initialCheckpoint(),
				migration: "CMS-4.4l",
			}),
		).toThrow(/identity/);
		expect(() =>
			parseSanityBlogMediaTransferCheckpoint({
				...initialCheckpoint(),
				sourceAssetRefs: [...CMS_BLOG_MEDIA_SOURCE_ASSET_REFS].reverse(),
			}),
		).toThrow(/source batch/);
		expect(parseSanityBlogMediaTransferOptions([])).toEqual({ mode: "plan" });
		expect(() => parseSanityBlogMediaTransferOptions(["--host", "https://example.com"])).toThrow(
			/Unsupported argument/,
		);
		expect(() => parseSanityBlogMediaTransferOptions(["--cookie-file", "/tmp/cookie"])).toThrow(
			/require --execute/,
		);
		expect(() =>
			parseSanityBlogMediaTransferOptions(executeArgs({ confirmation: "wrong" })),
		).toThrow(/must exactly equal/);
		expect(() =>
			parseSanityBlogMediaTransferOptions(
				executeArgs({ sourceAssetRefs: [SOURCE_REF, SECOND_SOURCE_REF] }),
			),
		).toThrow(/exactly 10/);
		expect(parseSanityBlogMediaTransferOptions(executeArgs())).toEqual({
			mode: "execute",
			cookieFile: "/tmp/cookie",
			sourceAssetRefs: CMS_BLOG_MEDIA_SOURCE_ASSET_REFS,
		});
	});

	test("selects only the active ten-image document batch when the preceding batch is mapped and receipted", () => {
		const journal = {
			...blankJournal(),
			...Object.fromEntries(
				COMPLETED_PREVIOUS_BATCH.map(([sourceAssetRef, receipt]) => [
					sourceAssetRef,
					receipt.mediaAssetId,
				]),
			),
		};
		const receiptFile: SanityBlogMediaTransferReceipts = {
			...blankReceipts(),
			receipts: Object.fromEntries(COMPLETED_PREVIOUS_BATCH),
		};

		expect(
			createSanityBlogMediaTransferPlan({
				journal,
				receiptFile,
				publishedSourceAssetRefs: Object.keys(journal),
				allowExistingMappings: false,
			}).map(({ sourceAssetRef, status }) => ({ sourceAssetRef, status })),
		).toEqual(
			CMS_BLOG_MEDIA_SOURCE_ASSET_REFS.map((sourceAssetRef) => ({
				sourceAssetRef,
				status: "pending",
			})),
		);
	});

	test("builds only the reviewed ten-asset plan and rejects mapped execution", () => {
		expect(
			createSanityBlogMediaTransferPlan({
				journal: blankJournal(),
				receiptFile: blankReceipts(),
				publishedSourceAssetRefs: CMS_BLOG_MEDIA_SOURCE_ASSET_REFS,
				allowExistingMappings: false,
			}).map(({ sourceAssetRef, status }) => ({ sourceAssetRef, status })),
		).toEqual(
			CMS_BLOG_MEDIA_SOURCE_ASSET_REFS.map((sourceAssetRef) => ({
				sourceAssetRef,
				status: "pending",
			})),
		);
		expect(() =>
			createSanityBlogMediaTransferPlan({
				journal: { ...blankJournal(), [SOURCE_REF]: MEDIA_ID },
				receiptFile: {
					...blankReceipts(),
					receipts: {
						[SOURCE_REF]: {
							mediaAssetId: MEDIA_ID,
							workerAssetId: WORKER_ID,
							sourceSha256: SOURCE_SHA256,
							source: SOURCE,
						},
					},
				},
				publishedSourceAssetRefs: CMS_BLOG_MEDIA_SOURCE_ASSET_REFS,
				allowExistingMappings: false,
			}),
		).toThrow(/already mapped/);
	});

	test("validates canonical CDN bytes independently from the Sanity asset ID", () => {
		const bytes = new Uint8Array([9, 8, 7]);
		const sourceSha256 = createHash("sha256").update(bytes).digest("hex");
		const sourceAssetId = "a".repeat(40);
		const sourceAssetRef = `image-${sourceAssetId}-1x1-png`;
		expect(createHash("sha1").update(bytes).digest("hex")).not.toBe(sourceAssetId);
		expect(
			validateSanityImageSourceAgainstExpectation({
				sourceAssetRef,
				bytes,
				decoded: { format: "png", width: 1, height: 1 },
				expected: {
					contentType: "image/png",
					sizeBytes: bytes.byteLength,
					width: 1,
					height: 1,
					sourceSha256,
				},
			}),
		).toMatchObject({ sourceAssetRef, sourceSha256 });
		expect(() =>
			validateSanityImageSourceAgainstExpectation({
				sourceAssetRef,
				bytes,
				decoded: { format: "png", width: 1, height: 1 },
				expected: {
					contentType: "image/png",
					sizeBytes: bytes.byteLength,
					width: 1,
					height: 1,
					sourceSha256: "b".repeat(64),
				},
			}),
		).toThrow(/SHA-256/);
		expect(() =>
			validateSanityImageSourceAgainstExpectation({
				sourceAssetRef,
				bytes,
				decoded: { format: "jpeg", width: 1, height: 1 },
				expected: {
					contentType: "image/png",
					sizeBytes: bytes.byteLength,
					width: 1,
					height: 1,
					sourceSha256,
				},
			}),
		).toThrow(/decoded image metadata/);
	});

	test("strictly validates capability identity, origin, key, query, and expiry", () => {
		const value = capabilityValue();
		expect(
			parseCmsMediaCapability(value, { sourceAssetRef: SOURCE_REF, nowMs: NOW }),
		).toMatchObject({ assetId: WORKER_ID });
		expect(() =>
			parseCmsMediaCapability(
				{ ...value, uploadUrl: `https://attacker.example/v1/uploads/source?key=x` },
				{ sourceAssetRef: SOURCE_REF, nowMs: NOW },
			),
		).toThrow(/upload boundary/);
		expect(() =>
			parseCmsMediaCapability(
				{ ...value, uploadUrl: `${value.uploadUrl}&key=duplicate` },
				{ sourceAssetRef: SOURCE_REF, nowMs: NOW },
			),
		).toThrow(/upload boundary/);
		expect(() =>
			parseCmsMediaCapability(
				{ ...value, uploadUrl: `${value.uploadUrl}&extra=1` },
				{ sourceAssetRef: SOURCE_REF, nowMs: NOW },
			),
		).toThrow(/upload boundary/);
		expect(() =>
			parseCmsMediaCapability(
				{ ...value, expiresAt: new Date(NOW + 30_000).toISOString() },
				{ sourceAssetRef: SOURCE_REF, nowMs: NOW },
			),
		).toThrow(/expiry/);
	});

	test("keeps the admin Cookie and Worker upload token on separate boundaries", () => {
		const capability = parsedCapability();
		const authorize = createCmsMediaCapabilityRequest(COOKIE, SOURCE_REF, SOURCE);
		const upload = createCmsMediaUploadRequest(capability, SOURCE_BYTES, SOURCE.contentType);
		const process = createCmsMediaProcessRequest(COOKIE, capability.privateObjectKey);
		const authorizeHeaders = new Headers(authorize.init.headers);
		const uploadHeaders = new Headers(upload.init.headers);
		const processHeaders = new Headers(process.init.headers);
		expect(authorize.url).toBe(`${CMS_BLOG_MEDIA_PRODUCTION_ORIGIN}/api/admin/media/capability`);
		expect(authorizeHeaders.get("Cookie")).toBe(COOKIE);
		expect(authorizeHeaders.has("X-CMS-Media-Upload-Token")).toBe(false);
		expect(uploadHeaders.get("X-CMS-Media-Upload-Token")).toBe(UPLOAD_TOKEN);
		expect(uploadHeaders.has("Cookie")).toBe(false);
		expect(uploadHeaders.get("Content-Length")).toBe(String(SOURCE_BYTES.byteLength));
		expect(processHeaders.get("Cookie")).toBe(COOKIE);
		expect(processHeaders.has("X-CMS-Media-Upload-Token")).toBe(false);
		expect(authorize.init.redirect).toBe("error");
		expect(upload.init.redirect).toBe("error");
		expect(process.init.redirect).toBe("error");
	});

	test("checkpoints capability identity and put-attempted before upload without persisting secrets", async () => {
		const writes: unknown[] = [];
		const fetcher = successFetcher();
		const result = await transferSanityBlogMediaAsset({
			checkpoint: initialCheckpoint(),
			sourceAssetRef: SOURCE_REF,
			validatedSource: { sourceSha256: SOURCE_SHA256, source: SOURCE },
			sourceBytes: SOURCE_BYTES,
			adminCookie: COOKIE,
			fetcher,
			now: () => NOW,
			writeCheckpoint: async (checkpoint) => writes.push(structuredClone(checkpoint)),
		});
		expect(
			writes.map(
				(value) => (value as ReturnType<typeof initialCheckpoint>).assets[SOURCE_REF]?.phase,
			),
		).toEqual(["source-validated", "capability-issued", "put-attempted", "registered"]);
		expect(result.registered).toMatchObject({ mediaAssetId: MEDIA_ID, workerAssetId: WORKER_ID });
		const serialized = JSON.stringify(writes);
		expect(serialized).not.toContain(COOKIE);
		expect(serialized).not.toContain(UPLOAD_TOKEN);
		expect(serialized).not.toContain("uploadUrl");
		expect(serialized).not.toContain("privateObjectKey");
		expect(serialized).not.toContain("sites/angelsrest.online");
	});

	test.each([
		["network loss", async () => Promise.reject(new Error("lost"))],
		["immutable conflict", async () => new Response("Upload key already exists", { status: 409 })],
	])("reconciles %s after PUT through the same process identity", async (_label, upload) => {
		const fetcher = successFetcher({ upload });
		const result = await transferSanityBlogMediaAsset({
			checkpoint: initialCheckpoint(),
			sourceAssetRef: SOURCE_REF,
			validatedSource: { sourceSha256: SOURCE_SHA256, source: SOURCE },
			sourceBytes: SOURCE_BYTES,
			adminCookie: COOKIE,
			fetcher,
			now: () => NOW,
			writeCheckpoint: async () => undefined,
		});
		expect(result.registered.mediaAssetId).toBe(MEDIA_ID);
		expect(fetcher).toHaveBeenCalledTimes(3);
	});

	test("retries an ambiguous process response against the same key without another capability", async () => {
		let processAttempts = 0;
		const fetcher = successFetcher({
			process: async () => {
				processAttempts += 1;
				if (processAttempts === 1) throw new Error("response lost");
				return Response.json(processValue());
			},
		});
		const result = await transferSanityBlogMediaAsset({
			checkpoint: initialCheckpoint(),
			sourceAssetRef: SOURCE_REF,
			validatedSource: { sourceSha256: SOURCE_SHA256, source: SOURCE },
			sourceBytes: SOURCE_BYTES,
			adminCookie: COOKIE,
			fetcher,
			now: () => NOW,
			sleep: async () => undefined,
			writeCheckpoint: async () => undefined,
		});
		expect(result.registered.mediaAssetId).toBe(MEDIA_ID);
		expect(processAttempts).toBe(2);
		expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith("/capability"))).toHaveLength(
			1,
		);
		const processBodies = fetcher.mock.calls
			.filter(([url]) => String(url).endsWith("/process"))
			.map(([, init]) => (init as RequestInit).body);
		expect(new Set(processBodies).size).toBe(1);
	});

	test("resumes a put-attempted checkpoint by processing only the same derived key", async () => {
		const checkpoint = replaceCheckpointAsset(initialCheckpoint(), SOURCE_REF, {
			phase: "put-attempted",
			sourceSha256: SOURCE_SHA256,
			source: SOURCE,
			workerAssetId: WORKER_ID,
			sourceExtension: "jpg",
		});
		const fetcher = successFetcher();
		await transferSanityBlogMediaAsset({
			checkpoint,
			sourceAssetRef: SOURCE_REF,
			validatedSource: { sourceSha256: SOURCE_SHA256, source: SOURCE },
			sourceBytes: SOURCE_BYTES,
			adminCookie: COOKIE,
			fetcher,
			now: () => NOW,
			writeCheckpoint: async () => undefined,
		});
		expect(fetcher).toHaveBeenCalledTimes(1);
		expect(String(fetcher.mock.calls[0]?.[0])).toBe(
			`${CMS_BLOG_MEDIA_PRODUCTION_ORIGIN}/api/admin/media/process`,
		);
		expect((fetcher.mock.calls[0]?.[1] as RequestInit).body).toBe(
			JSON.stringify({ privateObjectKey: privateObjectKeyForAsset(WORKER_ID, "jpg") }),
		);
	});

	test("preserves a resumable checkpoint when the exact operation lease remains active", async () => {
		const fetcher = successFetcher({
			process: async () =>
				new Response("CMS media asset operation is already in progress", { status: 409 }),
		});
		await expect(
			transferSanityBlogMediaAsset({
				checkpoint: initialCheckpoint(),
				sourceAssetRef: SOURCE_REF,
				validatedSource: { sourceSha256: SOURCE_SHA256, source: SOURCE },
				sourceBytes: SOURCE_BYTES,
				adminCookie: COOKIE,
				fetcher,
				now: () => NOW,
				sleep: async () => undefined,
				writeCheckpoint: async () => undefined,
			}),
		).rejects.toMatchObject({ code: "operation-in-progress", resumable: true });
		expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith("/capability"))).toHaveLength(
			1,
		);
	});

	test("preserves the same put-attempted identity when the admin session expires", async () => {
		const checkpoint = replaceCheckpointAsset(initialCheckpoint(), SOURCE_REF, {
			phase: "put-attempted",
			sourceSha256: SOURCE_SHA256,
			source: SOURCE,
			workerAssetId: WORKER_ID,
			sourceExtension: "jpg",
		});
		const fetcher = successFetcher({
			process: async () => new Response("Unauthorized", { status: 401 }),
		});
		await expect(
			transferSanityBlogMediaAsset({
				checkpoint,
				sourceAssetRef: SOURCE_REF,
				validatedSource: { sourceSha256: SOURCE_SHA256, source: SOURCE },
				sourceBytes: SOURCE_BYTES,
				adminCookie: COOKIE,
				fetcher,
				now: () => NOW,
				writeCheckpoint: async () => undefined,
			}),
		).rejects.toMatchObject({ code: "admin-session-expired", resumable: true });
		expect(fetcher).toHaveBeenCalledTimes(1);
	});

	test("treats a missing same-key upload as a terminal operator-review state", async () => {
		const checkpoint = replaceCheckpointAsset(initialCheckpoint(), SOURCE_REF, {
			phase: "put-attempted",
			sourceSha256: SOURCE_SHA256,
			source: SOURCE,
			workerAssetId: WORKER_ID,
			sourceExtension: "jpg",
		});
		const fetcher = successFetcher({
			process: async () => new Response("Uploaded object not found", { status: 404 }),
		});
		await expect(
			transferSanityBlogMediaAsset({
				checkpoint,
				sourceAssetRef: SOURCE_REF,
				validatedSource: { sourceSha256: SOURCE_SHA256, source: SOURCE },
				sourceBytes: SOURCE_BYTES,
				adminCookie: COOKIE,
				fetcher,
				now: () => NOW,
				writeCheckpoint: async () => undefined,
			}),
		).rejects.toMatchObject({ code: "process-rejected", resumable: false });
		expect(fetcher).toHaveBeenCalledTimes(1);
	});

	test("reconciles only the forward receipt-first journal crash states", () => {
		const baseline = { imageAssetMap: "a".repeat(64), transferReceipts: "b".repeat(64) };
		const candidate = { imageAssetMap: "c".repeat(64), transferReceipts: "d".repeat(64) };
		expect(
			reconcileSanityBlogMediaJournalState({
				phase: "registered",
				checkpointDigests: baseline,
				actualDigests: baseline,
				baselineDigests: baseline,
				candidateDigests: candidate,
			}),
		).toBe("baseline");
		expect(
			reconcileSanityBlogMediaJournalState({
				phase: "registry-verified",
				checkpointDigests: baseline,
				actualDigests: {
					imageAssetMap: baseline.imageAssetMap,
					transferReceipts: candidate.transferReceipts,
				},
				baselineDigests: baseline,
				candidateDigests: candidate,
			}),
		).toBe("receipt-committed");
		expect(
			reconcileSanityBlogMediaJournalState({
				phase: "receipt-committed",
				checkpointDigests: baseline,
				actualDigests: candidate,
				baselineDigests: baseline,
				candidateDigests: candidate,
			}),
		).toBe("journals-committed");
		expect(
			reconcileSanityBlogMediaJournalState({
				phase: "journals-committed",
				checkpointDigests: candidate,
				actualDigests: candidate,
				baselineDigests: baseline,
				candidateDigests: candidate,
			}),
		).toBe("journals-committed");
		expect(() =>
			reconcileSanityBlogMediaJournalState({
				phase: "registry-verified",
				checkpointDigests: baseline,
				actualDigests: candidate,
				baselineDigests: baseline,
				candidateDigests: candidate,
			}),
		).toThrow(/durable commit phase/);
		expect(() =>
			reconcileSanityBlogMediaJournalState({
				phase: "receipt-committed",
				checkpointDigests: baseline,
				actualDigests: {
					imageAssetMap: candidate.imageAssetMap,
					transferReceipts: baseline.transferReceipts,
				},
				baselineDigests: baseline,
				candidateDigests: candidate,
			}),
		).toThrow(/unrecognized partial state/);
	});

	test("lets an earlier complete asset yield to a later asset's partial journal recovery", () => {
		const checkpoint = replaceCheckpointAsset(
			initialCheckpoint(),
			SOURCE_REF,
			{
				phase: "complete",
				sourceSha256: CMS_BLOG_MEDIA_SOURCE_EXPECTATIONS[SOURCE_REF].sourceSha256,
				source: JOURNAL_SOURCE,
				workerAssetId: WORKER_ID,
				sourceExtension: "jpg",
				mediaAssetId: MEDIA_ID,
			},
			{ nextAssetIndex: 1 },
		);
		const receipt = {
			mediaAssetId: MEDIA_ID,
			workerAssetId: WORKER_ID,
			sourceSha256: CMS_BLOG_MEDIA_SOURCE_EXPECTATIONS[SOURCE_REF].sourceSha256,
			source: JOURNAL_SOURCE,
		};
		const laterAssetPartialDigests = {
			imageAssetMap: checkpoint.journalDigests.imageAssetMap,
			transferReceipts: "c".repeat(64),
		};
		expect(() =>
			validateCompletedSanityBlogMediaAsset({
				checkpoint,
				sourceAssetRef: SOURCE_REF,
				journalMediaAssetId: MEDIA_ID,
				receipt,
				actualJournalDigests: laterAssetPartialDigests,
				requireGlobalDigestMatch: false,
			}),
		).not.toThrow();
		expect(() =>
			validateCompletedSanityBlogMediaAsset({
				checkpoint,
				sourceAssetRef: SOURCE_REF,
				journalMediaAssetId: MEDIA_ID,
				receipt,
				actualJournalDigests: laterAssetPartialDigests,
				requireGlobalDigestMatch: true,
			}),
		).toThrow(/journal digests/);
	});

	test("creates a sorted v2 receipt and mapping without transport authority", () => {
		const candidate = createCandidateSanityBlogMediaJournals({
			journal: blankJournal(),
			receiptFile: blankReceipts(),
			sourceAssetRef: SOURCE_REF,
			registered: { mediaAssetId: MEDIA_ID, workerAssetId: WORKER_ID, source: JOURNAL_SOURCE },
			sourceSha256: CMS_BLOG_MEDIA_SOURCE_EXPECTATIONS[SOURCE_REF].sourceSha256,
		});
		expect(candidate.journal[SOURCE_REF]).toBe(MEDIA_ID);
		expect(candidate.receiptFile).toMatchObject({
			schemaVersion: 2,
			receipts: {
				[SOURCE_REF]: {
					mediaAssetId: MEDIA_ID,
					workerAssetId: WORKER_ID,
					sourceSha256: CMS_BLOG_MEDIA_SOURCE_EXPECTATIONS[SOURCE_REF].sourceSha256,
				},
			},
		});
		const serialized = JSON.stringify(candidate);
		expect(serialized).not.toContain("Cookie");
		expect(serialized).not.toContain("uploadToken");
		expect(serialized).not.toContain("privateObjectKey");
	});

	test("rejects secret-bearing or foreign checkpoint fields", () => {
		const checkpoint = initialCheckpoint();
		expect(() =>
			parseSanityBlogMediaTransferCheckpoint({ ...checkpoint, uploadToken: "secret" }),
		).toThrow(/unexpected or missing fields/);
		expect(() =>
			parseSanityBlogMediaTransferCheckpoint({
				...checkpoint,
				assets: { "image-foreign": {} },
			}),
		).toThrow(/foreign source/);
	});
});
