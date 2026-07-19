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
const COMPLETED_PREVIOUS_BATCH = [
	[
		"image-5f1512614d2c4c605f19729a67b7ed8c583bc615-970x982-jpg",
		{
			mediaAssetId: "nh70v6s6hartjy3xb5jka70y2s8avra1",
			workerAssetId: "6e5e98d0-bc00-4be3-9057-cd6f8b4a8fac",
			sourceSha256: "cb558b4708faefae7f13efbe17af96313e92beb39f176b7f2e2a595b475440a2",
			source: { contentType: "image/jpeg", sizeBytes: 136_330, width: 970, height: 982 },
		},
	],
	[
		"image-dcdf529f090e6c38354c9f10584cd1ea897c3927-961x982-jpg",
		{
			mediaAssetId: "nh78fezrb2zjwb3h08ya198yz98avbnj",
			workerAssetId: "13fc59df-c975-4608-a699-9ff6f318ec0e",
			sourceSha256: "aebaf4e6b1f9ac0274b64e28c56e15df1e3e3d87559fe07222a730f110b17955",
			source: { contentType: "image/jpeg", sizeBytes: 63_591, width: 961, height: 982 },
		},
	],
	[
		"image-d74c6ebb3e7cc5b295e63d2677a5b705dd6c279e-1265x982-jpg",
		{
			mediaAssetId: "nh7bpp5bew309kcz9es89enn698avh1q",
			workerAssetId: "e107d2f2-c07d-473a-9949-41227553b75b",
			sourceSha256: "a28679ddaeeb7c24c72feeef6fb09c13adb0e29149fad2b625bef96bc23e5ab9",
			source: { contentType: "image/jpeg", sizeBytes: 75_743, width: 1265, height: 982 },
		},
	],
	[
		"image-e2cffdeac93f452e8a6e60b6fe1d7e55255ef1eb-772x1024-jpg",
		{
			mediaAssetId: "nh77g6997wnn50gsqttqm5acnn8at0ys",
			workerAssetId: "e30a5de9-22c8-4d50-8315-c5a88e527d33",
			sourceSha256: "544faddc4a05c2204d133ee0b932092cc43f8d35d48db6d9913edec80ec84c47",
			source: { contentType: "image/jpeg", sizeBytes: 76_010, width: 772, height: 1024 },
		},
	],
	[
		"image-fac235d6f5243c7889bbb8523956829c86a36d0e-992x1024-jpg",
		{
			mediaAssetId: "nh79xc8y5009z52y7fc5a6zgs18atp66",
			workerAssetId: "d156a07a-65a5-4bfa-a301-5497b0794426",
			sourceSha256: "3d60289fcda3278ae916918f98c1b6f709d6b928414b8423348ccd72c7917b3b",
			source: { contentType: "image/jpeg", sizeBytes: 50_854, width: 992, height: 1024 },
		},
	],
	[
		"image-4e8305a2f2b2f0eee7a2ddd04beeb2a37b5a633f-550x553-png",
		{
			mediaAssetId: "nh77e94f3ec4a65r93wpkxg2fn8at251",
			workerAssetId: "c2c0f532-47df-4bff-947a-c319cec4ad73",
			sourceSha256: "e6166bc510feebd1f66e4603d79690b7ce2f71c458d51c0f381e0c60f153aa08",
			source: { contentType: "image/png", sizeBytes: 398_447, width: 550, height: 553 },
		},
	],
	[
		"image-2a260c1e56c70829d3ef9312fd4852786db586b9-964x982-jpg",
		{
			mediaAssetId: "nh74fk5p68d4cdakeda0setam98atn4d",
			workerAssetId: "fa542fab-3c72-40be-96a6-951527374f5a",
			sourceSha256: "a3ea3eb9f298023ffd140376aba28275e9fb380828e389e8c6909c9e57e493f4",
			source: { contentType: "image/jpeg", sizeBytes: 52_740, width: 964, height: 982 },
		},
	],
	[
		"image-fbfb0b1031d0c9976c2fcb17212ca2dd5cd7adbc-947x982-jpg",
		{
			mediaAssetId: "nh7agznqrhxe1mqtpg8zkkqj3n8atpek",
			workerAssetId: "cda81cd8-cd8b-4bc9-a724-7789e7368fa1",
			sourceSha256: "d56fe1b5be42ff76ef0f388ccc8ecba740ac677cf22172ea2fd9b997cf57602b",
			source: { contentType: "image/jpeg", sizeBytes: 49_571, width: 947, height: 982 },
		},
	],
	[
		"image-21cb525348f10f8a627a4b347ef4ba9a2a9b668b-964x982-jpg",
		{
			mediaAssetId: "nh707zgfgrvkyz5kht5qj5txrh8avz7q",
			workerAssetId: "22e157d8-38a9-4917-905f-8c8fbbadbdde",
			sourceSha256: "58267ed7041e929a54d67e38d0d38aec788c91de0367c023445101e56bf0a215",
			source: { contentType: "image/jpeg", sizeBytes: 37_466, width: 964, height: 982 },
		},
	],
	[
		"image-5e63b0248178528caaa470ff31d3aec5a21d7f5e-640x640-jpg",
		{
			mediaAssetId: "nh70z9fqs9g4avbnea1c1qh5vx8av2fd",
			workerAssetId: "9e71e608-1c8b-4ae0-8619-fe79181833f1",
			sourceSha256: "2065037a78e2462c342e4fd6c1f759d131a30b19845df7f80c714892a5d9256b",
			source: { contentType: "image/jpeg", sizeBytes: 32_075, width: 640, height: 640 },
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
		expect(CMS_BLOG_MEDIA_SOURCE_ASSET_REFS).toHaveLength(1);
		expect(new Set(CMS_BLOG_MEDIA_SOURCE_ASSET_REFS).size).toBe(1);
		expect(initialCheckpoint().migration).toBe(CMS_BLOG_MEDIA_BATCH_ID);
		expect(() =>
			parseSanityBlogMediaTransferCheckpoint({
				...initialCheckpoint(),
				migration: "CMS-4.4m",
			}),
		).toThrow(/identity/);
		expect(() =>
			parseSanityBlogMediaTransferCheckpoint({
				...initialCheckpoint(),
				sourceAssetRefs: [],
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
		expect(() => parseSanityBlogMediaTransferOptions(executeArgs({ sourceAssetRefs: [] }))).toThrow(
			/exactly 1/,
		);
		expect(parseSanityBlogMediaTransferOptions(executeArgs())).toEqual({
			mode: "execute",
			cookieFile: "/tmp/cookie",
			sourceAssetRefs: CMS_BLOG_MEDIA_SOURCE_ASSET_REFS,
		});
	});

	test("selects only the active author portrait when the preceding batch is mapped and receipted", () => {
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

	test("builds only the reviewed one-asset plan and rejects mapped execution", () => {
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
