import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { lstat, open, readFile, realpath, rename, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createClient } from "@sanity/client";
import sharp from "sharp";
import { sanityImageSourceUrl } from "./sanityBlogImportPrep";
import {
	CMS_BLOG_MEDIA_BATCH_ID,
	CMS_BLOG_MEDIA_PRODUCTION_CONFIRMATION,
	CMS_BLOG_MEDIA_SOURCE_ASSET_REFS,
	type CmsBlogMediaSourceAssetRef,
	createCandidateSanityBlogMediaJournals,
	createInitialSanityBlogMediaTransferCheckpoint,
	createSanityBlogMediaTransferPlan,
	parseSanityBlogMediaTransferCheckpoint,
	parseSanityBlogMediaTransferOptions,
	type RegisteredCmsMediaAsset,
	reconcileSanityBlogMediaJournalState,
	replaceCheckpointAsset,
	type SanityBlogMediaTransferAssetCheckpoint,
	type SanityBlogMediaTransferCheckpoint,
	SanityBlogMediaTransferError,
	transferSanityBlogMediaAsset,
	validateCompletedSanityBlogMediaAsset,
	validateSanityBlogMediaSource,
} from "./sanityBlogMediaTransfer";
import {
	ANGELS_REST_BLOG_MEDIA_EXPECTATIONS,
	collectPublishedSanityBlogImageAssetRefs,
	parseSanityBlogImageAssetJournal,
	parseSanityBlogMediaTransferReceipts,
	SANITY_BLOG_MEDIA_TRANSFER_RECEIPTS_FILENAME,
	SANITY_BLOG_MEDIA_VERIFICATION_REPORT_PATH,
	type SanityBlogMediaTransferReceipts,
} from "./sanityBlogMediaVerification";

const execFileAsync = promisify(execFile);
const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const MIGRATION_DIRECTORY = resolve(REPOSITORY_ROOT, "scripts/cms/migrations/angelsrest-blog");
const IMAGE_ASSET_MAP_PATH = resolve(MIGRATION_DIRECTORY, "sanity-blog-image-asset-map.json");
const TRANSFER_RECEIPTS_PATH = resolve(
	MIGRATION_DIRECTORY,
	SANITY_BLOG_MEDIA_TRANSFER_RECEIPTS_FILENAME,
);
const CHECKPOINT_PATH = resolve(MIGRATION_DIRECTORY, ".sanity-blog-media-transfer-checkpoint.json");
const LOCK_PATH = resolve(MIGRATION_DIRECTORY, ".sanity-blog-media-transfer.lock");
const VERIFIER_SCRIPT_PATH = resolve(REPOSITORY_ROOT, "scripts/cms/sanity-blog-media-verify.ts");
const TSX_CLI_PATH = resolve(REPOSITORY_ROOT, "node_modules/tsx/dist/cli.mjs");
const MAX_SOURCE_BYTES = 20_000_000;
const SOURCE_TIMEOUT_MS = 30_000;
const HOST_TIMEOUT_MS = 120_000;

type VersionedJournals = {
	journal: Record<string, string>;
	receiptFile: SanityBlogMediaTransferReceipts;
	rawJournal: string;
	rawReceipts: string;
	digests: { imageAssetMap: string; transferReceipts: string };
};

function sha256(value: string | Uint8Array) {
	return createHash("sha256").update(value).digest("hex");
}

function serializeJson(value: unknown) {
	return `${JSON.stringify(value, null, "\t")}\n`;
}

async function assertRegularFile(path: string, label: string) {
	const stats = await lstat(path);
	if (!stats.isFile() || stats.isSymbolicLink()) throw new Error(`${label} must be a regular file`);
	return stats;
}

async function assertFixedMigrationBoundary() {
	const actual = await realpath(MIGRATION_DIRECTORY);
	if (actual !== MIGRATION_DIRECTORY) throw new Error("Migration directory boundary is invalid");
	await Promise.all([
		assertRegularFile(IMAGE_ASSET_MAP_PATH, "Image asset journal"),
		assertRegularFile(TRANSFER_RECEIPTS_PATH, "Transfer receipt journal"),
	]);
}

async function readVersionedJournals(): Promise<VersionedJournals> {
	await Promise.all([
		assertRegularFile(IMAGE_ASSET_MAP_PATH, "Image asset journal"),
		assertRegularFile(TRANSFER_RECEIPTS_PATH, "Transfer receipt journal"),
	]);
	const [rawJournal, rawReceipts] = await Promise.all([
		readFile(IMAGE_ASSET_MAP_PATH, "utf8"),
		readFile(TRANSFER_RECEIPTS_PATH, "utf8"),
	]);
	return {
		journal: parseSanityBlogImageAssetJournal(JSON.parse(rawJournal) as unknown),
		receiptFile: parseSanityBlogMediaTransferReceipts(JSON.parse(rawReceipts) as unknown),
		rawJournal,
		rawReceipts,
		digests: {
			imageAssetMap: sha256(rawJournal),
			transferReceipts: sha256(rawReceipts),
		},
	};
}

function publishedSourceQuery() {
	return `{
		"authors": *[_type == "author"] | order(_id asc) {
			image { asset }
		},
		"posts": *[_type == "post"] | order(_id asc) {
			mainImage { asset },
			body[] { _type, asset }
		}
	}`;
}

async function fetchPublishedSourceAssetRefs() {
	const { projectId, dataset } = ANGELS_REST_BLOG_MEDIA_EXPECTATIONS;
	const client = createClient({
		projectId,
		dataset,
		apiVersion: "2024-01-01",
		useCdn: false,
	});
	try {
		const source = await client.fetch<unknown>(
			publishedSourceQuery(),
			{},
			{ perspective: "published" },
		);
		return collectPublishedSanityBlogImageAssetRefs(source);
	} catch {
		throw new Error("Published Sanity Blog source read failed");
	}
}

function sameStringSet(left: readonly string[], right: readonly string[]) {
	const sortedLeft = [...left].sort();
	const sortedRight = [...right].sort();
	return (
		sortedLeft.length === sortedRight.length &&
		sortedLeft.every((value, index) => value === sortedRight[index])
	);
}

async function readBoundedResponseBody(response: Response) {
	const declaredLength = response.headers.get("Content-Length");
	if (declaredLength && /^\d+$/.test(declaredLength) && Number(declaredLength) > MAX_SOURCE_BYTES) {
		throw new Error("Sanity source exceeds the CMS upload limit");
	}
	if (!response.body) throw new Error("Sanity source response has no body");
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		for (;;) {
			const chunk = await reader.read();
			if (chunk.done) break;
			total += chunk.value.byteLength;
			if (total > MAX_SOURCE_BYTES) {
				await reader.cancel();
				throw new Error("Sanity source exceeds the CMS upload limit");
			}
			chunks.push(chunk.value);
		}
	} finally {
		reader.releaseLock();
	}
	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return bytes;
}

async function downloadAndValidateSource(sourceAssetRef: CmsBlogMediaSourceAssetRef) {
	const { projectId, dataset } = ANGELS_REST_BLOG_MEDIA_EXPECTATIONS;
	const sourceUrl = sanityImageSourceUrl(projectId, dataset, sourceAssetRef);
	if (!sourceUrl) throw new Error("Sanity source URL could not be constructed");
	let response: Response;
	try {
		response = await fetch(sourceUrl, {
			redirect: "error",
			signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS),
		});
	} catch {
		throw new Error("Sanity source download failed");
	}
	if (!response.ok || response.url !== sourceUrl) {
		throw new Error("Sanity source download boundary is invalid");
	}
	const expectedContentType = sourceAssetRef.endsWith("-jpg")
		? "image/jpeg"
		: sourceAssetRef.endsWith("-png")
			? "image/png"
			: "image/webp";
	if (response.headers.get("Content-Type")?.split(";", 1)[0]?.trim() !== expectedContentType) {
		throw new Error("Sanity source response content type is invalid");
	}
	const bytes = await readBoundedResponseBody(response);
	let metadata: Awaited<ReturnType<ReturnType<typeof sharp>["metadata"]>>;
	try {
		metadata = await sharp(bytes, { failOn: "error" }).metadata();
	} catch {
		throw new Error("Sanity source is not a valid supported image");
	}
	return {
		bytes,
		validated: validateSanityBlogMediaSource(sourceAssetRef, bytes, metadata),
	};
}

async function loadAdminCookie(cookieFile: string) {
	try {
		const stats = await assertRegularFile(cookieFile, "Admin Cookie file");
		if ((stats.mode & 0o777) !== 0o600) throw new Error("mode");
		if (typeof process.getuid === "function" && stats.uid !== process.getuid()) {
			throw new Error("owner");
		}
		const cookie = await readFile(cookieFile, "utf8");
		if (
			!cookie ||
			cookie !== cookie.trim() ||
			cookie.length > 8192 ||
			/[\r\n]/.test(cookie) ||
			!cookie.includes("=") ||
			/^cookie\s*:/i.test(cookie)
		) {
			throw new Error("contents");
		}
		return cookie;
	} catch {
		throw new Error("Admin Cookie file must be owner-only mode 0600 with one raw Cookie value");
	}
}

async function writeExclusiveFile(path: string, contents: string) {
	const handle = await open(path, "wx", 0o600);
	try {
		await handle.writeFile(contents, "utf8");
		await handle.sync();
	} finally {
		await handle.close();
	}
}

async function syncDirectory(path: string) {
	const handle = await open(path, "r");
	try {
		await handle.sync();
	} finally {
		await handle.close();
	}
}

async function atomicReplaceFile(path: string, contents: string) {
	await assertRegularFile(path, "Versioned journal");
	const temporaryPath = resolve(
		dirname(path),
		`.${path.split("/").at(-1)}.tmp-${process.pid}-${randomUUID()}`,
	);
	try {
		await writeExclusiveFile(temporaryPath, contents);
		await rename(temporaryPath, path);
		await syncDirectory(dirname(path));
	} finally {
		await rm(temporaryPath, { force: true });
	}
}

async function writeCheckpoint(checkpoint: SanityBlogMediaTransferCheckpoint) {
	const canonical = parseSanityBlogMediaTransferCheckpoint(checkpoint);
	const temporaryPath = `${CHECKPOINT_PATH}.tmp-${process.pid}-${randomUUID()}`;
	try {
		await writeExclusiveFile(temporaryPath, serializeJson(canonical));
		await rename(temporaryPath, CHECKPOINT_PATH);
		await syncDirectory(MIGRATION_DIRECTORY);
	} finally {
		await rm(temporaryPath, { force: true });
	}
}

async function readCheckpoint() {
	try {
		const stats = await lstat(CHECKPOINT_PATH);
		if (!stats.isFile() || stats.isSymbolicLink() || (stats.mode & 0o777) !== 0o600) {
			throw new Error("unsafe checkpoint");
		}
		return parseSanityBlogMediaTransferCheckpoint(
			JSON.parse(await readFile(CHECKPOINT_PATH, "utf8")) as unknown,
		);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw new Error(
			"Existing Blog media checkpoint is invalid or belongs to another batch; operator review is required",
		);
	}
}

async function acquireLock() {
	let handle: Awaited<ReturnType<typeof open>>;
	try {
		handle = await open(LOCK_PATH, "wx", 0o600);
	} catch {
		throw new Error(
			`${CMS_BLOG_MEDIA_BATCH_ID} transfer lock already exists; do not remove it without review`,
		);
	}
	try {
		await handle.writeFile(
			serializeJson({
				migration: CMS_BLOG_MEDIA_BATCH_ID,
				siteUrl: ANGELS_REST_BLOG_MEDIA_EXPECTATIONS.siteUrl,
				pid: process.pid,
				startedAt: new Date().toISOString(),
				sourceAssetRefs: CMS_BLOG_MEDIA_SOURCE_ASSET_REFS,
			}),
			"utf8",
		);
		await handle.sync();
		const acquiredStats = await handle.stat();
		return async () => {
			const releaseStats = await lstat(LOCK_PATH);
			if (
				!releaseStats.isFile() ||
				releaseStats.isSymbolicLink() ||
				(releaseStats.mode & 0o777) !== 0o600 ||
				releaseStats.dev !== acquiredStats.dev ||
				releaseStats.ino !== acquiredStats.ino
			) {
				throw new Error(
					`${CMS_BLOG_MEDIA_BATCH_ID} transfer lock changed during execution; operator review is required`,
				);
			}
			await rm(LOCK_PATH);
			await syncDirectory(MIGRATION_DIRECTORY);
		};
	} finally {
		await handle.close();
	}
}

async function cmsBoundaryFetch(input: string | URL | Request, init?: RequestInit) {
	return await fetch(input, { ...init, signal: AbortSignal.timeout(HOST_TIMEOUT_MS) });
}

async function writeCandidateFiles(
	journal: Record<string, string>,
	receiptFile: SanityBlogMediaTransferReceipts,
) {
	const suffix = `${process.pid}-${randomUUID()}`;
	const mapPath = resolve(
		MIGRATION_DIRECTORY,
		`.sanity-blog-image-asset-map.candidate-${suffix}.json`,
	);
	const receiptPath = resolve(
		MIGRATION_DIRECTORY,
		`.sanity-blog-media-transfer-receipts.candidate-${suffix}.json`,
	);
	try {
		await Promise.all([
			writeExclusiveFile(mapPath, serializeJson(journal)),
			writeExclusiveFile(receiptPath, serializeJson(receiptFile)),
		]);
		return {
			mapPath,
			receiptPath,
			cleanup: async () => {
				await Promise.all([rm(mapPath, { force: true }), rm(receiptPath, { force: true })]);
			},
		};
	} catch (error) {
		await Promise.all([rm(mapPath, { force: true }), rm(receiptPath, { force: true })]);
		throw error;
	}
}

async function runVerifier(
	imageAssetMapPath: string,
	transferReceiptsPath: string,
	sourceAssetRef: CmsBlogMediaSourceAssetRef,
) {
	try {
		await execFileAsync(
			process.execPath,
			[
				TSX_CLI_PATH,
				VERIFIER_SCRIPT_PATH,
				"--image-asset-map",
				imageAssetMapPath,
				"--transfer-receipts",
				transferReceiptsPath,
			],
			{ cwd: REPOSITORY_ROOT, maxBuffer: 2 * 1024 * 1024, windowsHide: true },
		);
	} catch {
		throw new Error("Production registry verification blocked the transfer journal update");
	}
	let report: {
		status?: unknown;
		issues?: unknown;
		assets?: Array<{ sourceAssetRef?: unknown; status?: unknown }>;
	};
	try {
		report = JSON.parse(await readFile(SANITY_BLOG_MEDIA_VERIFICATION_REPORT_PATH, "utf8"));
	} catch {
		throw new Error("Production registry verification report is unavailable");
	}
	const current = Array.isArray(report.assets)
		? report.assets.find((asset) => asset.sourceAssetRef === sourceAssetRef)
		: undefined;
	if (
		report.status === "blocked" ||
		!Array.isArray(report.issues) ||
		report.issues.length !== 0 ||
		current?.status !== "registry-verified"
	) {
		throw new Error("Production registry verification did not accept the current asset");
	}
}

function registeredFromCheckpoint(
	asset: SanityBlogMediaTransferAssetCheckpoint,
): RegisteredCmsMediaAsset {
	if (!asset.workerAssetId || !asset.mediaAssetId) {
		throw new Error("Registered checkpoint identity is incomplete");
	}
	return {
		mediaAssetId: asset.mediaAssetId,
		workerAssetId: asset.workerAssetId,
		source: asset.source,
	};
}

function withoutCurrentReceipt(
	receiptFile: SanityBlogMediaTransferReceipts,
	sourceAssetRef: CmsBlogMediaSourceAssetRef,
) {
	return parseSanityBlogMediaTransferReceipts({
		...receiptFile,
		receipts: Object.fromEntries(
			Object.entries(receiptFile.receipts).filter(([ref]) => ref !== sourceAssetRef),
		),
	});
}

function baselineAndCandidate(
	journals: VersionedJournals,
	sourceAssetRef: CmsBlogMediaSourceAssetRef,
	asset: SanityBlogMediaTransferAssetCheckpoint,
) {
	const baselineJournal = parseSanityBlogImageAssetJournal({
		...journals.journal,
		[sourceAssetRef]: "",
	});
	const baselineReceiptFile = withoutCurrentReceipt(journals.receiptFile, sourceAssetRef);
	const baselineRawJournal = serializeJson(baselineJournal);
	const baselineRawReceipts = serializeJson(baselineReceiptFile);
	const candidate = createCandidateSanityBlogMediaJournals({
		journal: baselineJournal,
		receiptFile: baselineReceiptFile,
		sourceAssetRef,
		registered: registeredFromCheckpoint(asset),
		sourceSha256: asset.sourceSha256,
	});
	const candidateRawJournal = serializeJson(candidate.journal);
	const candidateRawReceipts = serializeJson(candidate.receiptFile);
	return {
		baseline: {
			journal: baselineJournal,
			receiptFile: baselineReceiptFile,
			rawJournal: baselineRawJournal,
			rawReceipts: baselineRawReceipts,
			digests: {
				imageAssetMap: sha256(baselineRawJournal),
				transferReceipts: sha256(baselineRawReceipts),
			},
		},
		candidate: {
			...candidate,
			rawJournal: candidateRawJournal,
			rawReceipts: candidateRawReceipts,
			digests: {
				imageAssetMap: sha256(candidateRawJournal),
				transferReceipts: sha256(candidateRawReceipts),
			},
		},
	};
}

async function reconcileAndCommitAsset({
	checkpoint,
	sourceAssetRef,
	publishedSourceAssetRefs,
}: {
	checkpoint: SanityBlogMediaTransferCheckpoint;
	sourceAssetRef: CmsBlogMediaSourceAssetRef;
	publishedSourceAssetRefs: readonly string[];
}) {
	let current = checkpoint;
	let asset = current.assets[sourceAssetRef];
	if (!asset?.mediaAssetId || !asset.workerAssetId) {
		throw new Error("Registered checkpoint state is missing");
	}
	let journals = await readVersionedJournals();
	let transaction = baselineAndCandidate(journals, sourceAssetRef, asset);
	if (
		asset.phase !== "registered" &&
		asset.phase !== "registry-verified" &&
		asset.phase !== "receipt-committed" &&
		asset.phase !== "journals-committed" &&
		asset.phase !== "complete"
	) {
		throw new Error("Registered checkpoint phase is invalid for journal reconciliation");
	}
	const actualState = reconcileSanityBlogMediaJournalState({
		phase: asset.phase,
		checkpointDigests: current.journalDigests,
		actualDigests: journals.digests,
		baselineDigests: transaction.baseline.digests,
		candidateDigests: transaction.candidate.digests,
	});
	if (
		actualState === "journals-committed" &&
		asset.phase !== "journals-committed" &&
		asset.phase !== "complete"
	) {
		asset = { ...asset, phase: "journals-committed" };
		current = replaceCheckpointAsset(current, sourceAssetRef, asset, {
			journalDigests: transaction.candidate.digests,
		});
		await writeCheckpoint(current);
	} else if (actualState === "receipt-committed" && asset.phase !== "receipt-committed") {
		asset = { ...asset, phase: "receipt-committed" };
		current = replaceCheckpointAsset(current, sourceAssetRef, asset);
		await writeCheckpoint(current);
	}

	if (asset.phase === "registered") {
		const candidateFiles = await writeCandidateFiles(
			transaction.candidate.journal,
			transaction.candidate.receiptFile,
		);
		try {
			await runVerifier(candidateFiles.mapPath, candidateFiles.receiptPath, sourceAssetRef);
		} finally {
			await candidateFiles.cleanup();
		}
		asset = { ...asset, phase: "registry-verified" };
		current = replaceCheckpointAsset(current, sourceAssetRef, asset);
		await writeCheckpoint(current);
	}

	if (asset.phase === "registry-verified") {
		const currentSourceRefs = await fetchPublishedSourceAssetRefs();
		if (!sameStringSet(currentSourceRefs, publishedSourceAssetRefs)) {
			throw new Error("Published Sanity source set changed before journal commit");
		}
		journals = await readVersionedJournals();
		transaction = baselineAndCandidate(journals, sourceAssetRef, asset);
		if (
			journals.digests.imageAssetMap !== transaction.baseline.digests.imageAssetMap ||
			journals.digests.transferReceipts !== transaction.baseline.digests.transferReceipts ||
			transaction.baseline.digests.imageAssetMap !== current.journalDigests.imageAssetMap ||
			transaction.baseline.digests.transferReceipts !== current.journalDigests.transferReceipts
		) {
			throw new Error("Versioned Blog media journal compare-and-swap failed");
		}
		await atomicReplaceFile(TRANSFER_RECEIPTS_PATH, transaction.candidate.rawReceipts);
		asset = { ...asset, phase: "receipt-committed" };
		current = replaceCheckpointAsset(current, sourceAssetRef, asset);
		await writeCheckpoint(current);
	}

	if (asset.phase === "receipt-committed") {
		const currentSourceRefs = await fetchPublishedSourceAssetRefs();
		if (!sameStringSet(currentSourceRefs, publishedSourceAssetRefs)) {
			throw new Error("Published Sanity source set changed before mapping commit");
		}
		journals = await readVersionedJournals();
		transaction = baselineAndCandidate(journals, sourceAssetRef, asset);
		if (
			journals.digests.imageAssetMap !== transaction.baseline.digests.imageAssetMap ||
			journals.digests.transferReceipts !== transaction.candidate.digests.transferReceipts
		) {
			throw new Error("Receipt-first Blog media journal recovery check failed");
		}
		await atomicReplaceFile(IMAGE_ASSET_MAP_PATH, transaction.candidate.rawJournal);
		asset = { ...asset, phase: "journals-committed" };
		current = replaceCheckpointAsset(current, sourceAssetRef, asset, {
			journalDigests: transaction.candidate.digests,
		});
		await writeCheckpoint(current);
	}

	if (asset.phase === "journals-committed") {
		await runVerifier(IMAGE_ASSET_MAP_PATH, TRANSFER_RECEIPTS_PATH, sourceAssetRef);
		asset = { ...asset, phase: "complete" };
		const nextAssetIndex = CMS_BLOG_MEDIA_SOURCE_ASSET_REFS.indexOf(sourceAssetRef) + 1;
		current = replaceCheckpointAsset(current, sourceAssetRef, asset, { nextAssetIndex });
		await writeCheckpoint(current);
	}
	return current;
}

async function runPlanOnly() {
	const [journals, publishedSourceAssetRefs] = await Promise.all([
		readVersionedJournals(),
		fetchPublishedSourceAssetRefs(),
	]);
	const plan = createSanityBlogMediaTransferPlan({
		journal: journals.journal,
		receiptFile: journals.receiptFile,
		publishedSourceAssetRefs,
		allowExistingMappings: true,
	});
	console.log(
		`${CMS_BLOG_MEDIA_BATCH_ID} plan-only: no Cookie read and no files or provider state changed.`,
	);
	for (const item of plan) {
		console.log(
			`${item.status}: ${item.sourceAssetRef} (${item.source.sizeBytes} bytes, SHA-256 ${item.source.sourceSha256})`,
		);
	}
	console.log(
		`Production execution requires --execute, ${CMS_BLOG_MEDIA_SOURCE_ASSET_REFS.length} --source-ref flags, --cookie-file, and --confirm "${CMS_BLOG_MEDIA_PRODUCTION_CONFIRMATION}".`,
	);
}

async function runExecution(
	options: Extract<ReturnType<typeof parseSanityBlogMediaTransferOptions>, { mode: "execute" }>,
) {
	await assertFixedMigrationBoundary();
	const releaseLock = await acquireLock();
	let completed = false;
	try {
		const [adminCookie, publishedSourceAssetRefs, initialJournals] = await Promise.all([
			loadAdminCookie(resolve(options.cookieFile)),
			fetchPublishedSourceAssetRefs(),
			readVersionedJournals(),
		]);
		let checkpoint = await readCheckpoint();
		if (!checkpoint) {
			createSanityBlogMediaTransferPlan({
				journal: initialJournals.journal,
				receiptFile: initialJournals.receiptFile,
				publishedSourceAssetRefs,
				allowExistingMappings: false,
			});
			checkpoint = createInitialSanityBlogMediaTransferCheckpoint(initialJournals.digests);
			await writeCheckpoint(checkpoint);
		} else if (!sameStringSet(Object.keys(initialJournals.journal), publishedSourceAssetRefs)) {
			throw new Error("Published Sanity source set and media journal have drifted");
		}

		for (let index = 0; index < options.sourceAssetRefs.length; index += 1) {
			const sourceAssetRef = options.sourceAssetRefs[index];
			let asset = checkpoint.assets[sourceAssetRef];
			if (asset?.phase === "complete") {
				const journals = await readVersionedJournals();
				validateCompletedSanityBlogMediaAsset({
					checkpoint,
					sourceAssetRef,
					journalMediaAssetId: journals.journal[sourceAssetRef],
					receipt: journals.receiptFile.receipts[sourceAssetRef],
					actualJournalDigests: journals.digests,
					requireGlobalDigestMatch: index === options.sourceAssetRefs.length - 1,
				});
				continue;
			}

			const { bytes, validated } = await downloadAndValidateSource(sourceAssetRef);
			const beforeTransfer = await readVersionedJournals();
			if (
				(asset?.phase === undefined ||
					asset.phase === "source-validated" ||
					asset.phase === "capability-issued" ||
					asset.phase === "put-attempted") &&
				(beforeTransfer.digests.imageAssetMap !== checkpoint.journalDigests.imageAssetMap ||
					beforeTransfer.digests.transferReceipts !== checkpoint.journalDigests.transferReceipts)
			) {
				throw new Error("Versioned Blog media journals changed before transfer");
			}

			const transferred = await transferSanityBlogMediaAsset({
				checkpoint,
				sourceAssetRef,
				validatedSource: validated,
				sourceBytes: bytes,
				adminCookie,
				fetcher: cmsBoundaryFetch,
				writeCheckpoint,
				onProgress: ({ sourceAssetRef: ref, stage }) => console.log(`${ref}: ${stage}`),
			});
			checkpoint = transferred.checkpoint;
			asset = checkpoint.assets[sourceAssetRef];
			if (!asset?.mediaAssetId || !asset.workerAssetId) {
				throw new Error("Transfer did not produce a registered checkpoint state");
			}
			checkpoint = await reconcileAndCommitAsset({
				checkpoint,
				sourceAssetRef,
				publishedSourceAssetRefs,
			});
			console.log(`${sourceAssetRef}: registry-verified and journaled`);
		}

		if (checkpoint.nextAssetIndex !== CMS_BLOG_MEDIA_SOURCE_ASSET_REFS.length) {
			throw new Error(`${CMS_BLOG_MEDIA_BATCH_ID} checkpoint did not complete the fixed batch`);
		}
		await rm(CHECKPOINT_PATH, { force: true });
		await syncDirectory(MIGRATION_DIRECTORY);
		completed = true;
		console.log(
			`${CMS_BLOG_MEDIA_BATCH_ID} fixed ${CMS_BLOG_MEDIA_SOURCE_ASSET_REFS.length}-asset batch completed and passed the production registry gate.`,
		);
	} finally {
		await releaseLock();
		if (!completed) {
			console.error(
				`${CMS_BLOG_MEDIA_BATCH_ID} stopped safely; any existing durable checkpoint was preserved.`,
			);
		}
	}
}

async function main() {
	const options = parseSanityBlogMediaTransferOptions(process.argv.slice(2));
	if (options.mode === "plan") {
		await runPlanOnly();
		return;
	}
	await runExecution(options);
}

void main().catch((error) => {
	const message =
		error instanceof SanityBlogMediaTransferError || error instanceof Error
			? error.message
			: `${CMS_BLOG_MEDIA_BATCH_ID} transfer failed`;
	console.error(message);
	process.exitCode = 1;
});
