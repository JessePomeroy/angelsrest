import { randomUUID } from "node:crypto";
import { lstat, open, readFile, realpath, rename, rm } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import {
	ABOUT_CONTACT_PORTRAIT_CONFIRMATION,
	ABOUT_CONTACT_PORTRAIT_OPERATION,
	ABOUT_CONTACT_PORTRAIT_SOURCE,
	type AboutContactPortraitCheckpoint,
	checkpointAboutContactPortraitConfirmedMissing,
	checkpointAboutContactPortraitPutAttempted,
	checkpointAboutContactPortraitRegistered,
	createAboutContactPortraitCapabilityRequest,
	createAboutContactPortraitReceipt,
	createInitialAboutContactPortraitCheckpoint,
	isConfirmedAboutContactPortraitSourceMissing,
	parseAboutContactPortraitCapability,
	parseAboutContactPortraitCheckpoint,
	parseAboutContactPortraitProcessResult,
	parseAboutContactPortraitReceipt,
	validateAboutContactPortraitSource,
} from "./aboutContactPortraitTransfer";
import {
	createCmsMediaProcessRequest,
	createCmsMediaUploadRequest,
	privateObjectKeyForAsset,
} from "./sanityBlogMediaTransfer";

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SOURCE_PATH = resolve(REPOSITORY_ROOT, ABOUT_CONTACT_PORTRAIT_SOURCE.path);
const RECEIPT_FILENAME = "about-contact-portrait-transfer-receipt.json";
const CHECKPOINT_FILENAME = ".about-contact-portrait-transfer-checkpoint.json";
const LOCK_FILENAME = ".about-contact-portrait-transfer.lock";
const ACTIVE_OPERATION_MESSAGE = "CMS media asset operation is already in progress";
const HOST_TIMEOUT_MS = 120_000;
const MAX_PROCESS_ATTEMPTS = 3;

type Options = { mode: "plan" } | { mode: "execute"; cookieFile: string; stateDirectory: string };

function serializeJson(value: unknown) {
	return `${JSON.stringify(value, null, "\t")}\n`;
}

function parseOptions(args: readonly string[]): Options {
	let execute = false;
	let confirmation: string | undefined;
	let cookieFile: string | undefined;
	let stateDirectory: string | undefined;
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === "--") continue;
		if (arg === "--execute") {
			if (execute) throw new Error("--execute may only be supplied once");
			execute = true;
			continue;
		}
		if (arg === "--confirm" || arg === "--cookie-file" || arg === "--state-dir") {
			const value = args[index + 1];
			if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value`);
			if (arg === "--confirm") {
				if (confirmation !== undefined) throw new Error("--confirm may only be supplied once");
				confirmation = value;
			}
			if (arg === "--cookie-file") {
				if (cookieFile !== undefined) throw new Error("--cookie-file may only be supplied once");
				cookieFile = value;
			}
			if (arg === "--state-dir") {
				if (stateDirectory !== undefined) throw new Error("--state-dir may only be supplied once");
				stateDirectory = value;
			}
			index += 1;
			continue;
		}
		throw new Error(`Unsupported argument: ${arg}`);
	}
	if (!execute) {
		if (confirmation !== undefined || cookieFile !== undefined || stateDirectory !== undefined) {
			throw new Error("Execution options require --execute");
		}
		return { mode: "plan" };
	}
	if (confirmation !== ABOUT_CONTACT_PORTRAIT_CONFIRMATION) {
		throw new Error(`--confirm must exactly equal "${ABOUT_CONTACT_PORTRAIT_CONFIRMATION}"`);
	}
	if (!cookieFile || cookieFile !== cookieFile.trim()) {
		throw new Error("--cookie-file requires one trimmed path");
	}
	if (!stateDirectory || stateDirectory !== stateDirectory.trim() || !isAbsolute(stateDirectory)) {
		throw new Error("--state-dir requires one absolute path");
	}
	return { mode: "execute", cookieFile, stateDirectory };
}

async function assertRegularFile(path: string, label: string, ownerOnly: boolean) {
	const stats = await lstat(path);
	if (!stats.isFile() || stats.isSymbolicLink()) throw new Error(`${label} must be a regular file`);
	if (ownerOnly && (stats.mode & 0o077) !== 0) {
		throw new Error(`${label} must be readable only by its owner`);
	}
	if (typeof process.getuid === "function" && stats.uid !== process.getuid()) {
		throw new Error(`${label} must be owned by the current operator`);
	}
	return stats;
}

async function assertFixedSource() {
	if ((await realpath(SOURCE_PATH)) !== SOURCE_PATH) {
		throw new Error("About portrait source path boundary is invalid");
	}
	const stats = await assertRegularFile(SOURCE_PATH, "About portrait source", false);
	if (stats.size !== ABOUT_CONTACT_PORTRAIT_SOURCE.sizeBytes) {
		throw new Error("About portrait source byte count changed");
	}
	const bytes = await readFile(SOURCE_PATH);
	let metadata: Awaited<ReturnType<ReturnType<typeof sharp>["metadata"]>>;
	try {
		metadata = await sharp(bytes, { failOn: "error" }).metadata();
	} catch {
		throw new Error("About portrait source is not a valid image");
	}
	validateAboutContactPortraitSource(bytes, metadata);
	return bytes;
}

async function assertPrivateStateDirectory(path: string) {
	const resolvedPath = resolve(path);
	const [actualPath, stats] = await Promise.all([realpath(resolvedPath), lstat(resolvedPath)]);
	if (actualPath !== resolvedPath || !stats.isDirectory() || stats.isSymbolicLink()) {
		throw new Error("State directory boundary is invalid");
	}
	if ((stats.mode & 0o077) !== 0) throw new Error("State directory must be owner-only");
	if (typeof process.getuid === "function" && stats.uid !== process.getuid()) {
		throw new Error("State directory must be owned by the current operator");
	}
	return resolvedPath;
}

async function loadAdminCookie(path: string) {
	try {
		await assertRegularFile(path, "Admin Cookie file", true);
		const cookie = await readFile(path, "utf8");
		if (
			!cookie ||
			cookie !== cookie.trim() ||
			cookie.length > 8_192 ||
			/[\r\n]/.test(cookie) ||
			!cookie.includes("=") ||
			/^cookie\s*:/i.test(cookie)
		) {
			throw new Error("invalid contents");
		}
		return cookie;
	} catch {
		throw new Error("Admin Cookie file must be owner-only with one raw Cookie value");
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

async function writeExclusivePrivateFile(path: string, contents: string) {
	const handle = await open(path, "wx", 0o600);
	try {
		await handle.writeFile(contents, "utf8");
		await handle.sync();
	} finally {
		await handle.close();
	}
}

async function atomicWritePrivateJson(path: string, value: unknown) {
	const temporaryPath = resolve(
		dirname(path),
		`.${path.split("/").at(-1)}.tmp-${process.pid}-${randomUUID()}`,
	);
	try {
		await writeExclusivePrivateFile(temporaryPath, serializeJson(value));
		await rename(temporaryPath, path);
		await syncDirectory(dirname(path));
	} finally {
		await rm(temporaryPath, { force: true });
	}
}

async function readOptionalPrivateJson(path: string, label: string) {
	try {
		await assertRegularFile(path, label, true);
		return JSON.parse(await readFile(path, "utf8")) as unknown;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
}

async function acquireLock(stateDirectory: string) {
	const lockPath = resolve(stateDirectory, LOCK_FILENAME);
	let handle: Awaited<ReturnType<typeof open>>;
	try {
		handle = await open(lockPath, "wx", 0o600);
	} catch {
		throw new Error("About portrait transfer lock exists; review it before resuming");
	}
	try {
		await handle.writeFile(
			serializeJson({ operation: ABOUT_CONTACT_PORTRAIT_OPERATION, pid: process.pid }),
			"utf8",
		);
		await handle.sync();
		const acquired = await handle.stat();
		return async () => {
			const current = await lstat(lockPath);
			if (
				!current.isFile() ||
				current.isSymbolicLink() ||
				current.dev !== acquired.dev ||
				current.ino !== acquired.ino
			) {
				throw new Error("About portrait transfer lock changed during execution");
			}
			await rm(lockPath);
			await syncDirectory(stateDirectory);
		};
	} finally {
		await handle.close();
	}
}

async function boundaryFetch(input: string | URL | Request, init?: RequestInit) {
	return await fetch(input, { ...init, signal: AbortSignal.timeout(HOST_TIMEOUT_MS) });
}

async function readJson(response: Response) {
	try {
		return (await response.json()) as unknown;
	} catch {
		throw new Error("CMS media boundary returned invalid JSON");
	}
}

async function issueCapability(adminCookie: string) {
	const request = createAboutContactPortraitCapabilityRequest(adminCookie);
	let response: Response;
	try {
		response = await boundaryFetch(request.url, request.init);
	} catch {
		throw new Error("CMS media capability request failed before upload");
	}
	if (!response.ok) {
		throw new Error(`CMS media capability request was rejected with status ${response.status}`);
	}
	return parseAboutContactPortraitCapability(await readJson(response), Date.now());
}

async function attemptUpload(
	capability: Awaited<ReturnType<typeof issueCapability>>,
	sourceBytes: Uint8Array,
) {
	try {
		const request = createCmsMediaUploadRequest(
			capability,
			sourceBytes,
			ABOUT_CONTACT_PORTRAIT_SOURCE.contentType,
		);
		const response = await boundaryFetch(request.url, request.init);
		if (!response.ok && response.status !== 409 && response.status < 500) {
			throw new Error(`CMS media upload was rejected with status ${response.status}`);
		}
	} catch (error) {
		if (error instanceof Error && error.message.startsWith("CMS media upload was rejected")) {
			throw error;
		}
		// Once put-attempted is durable, network and server failures are reconciled
		// by processing the same Worker identity.
	}
}

async function processAsset(adminCookie: string, workerAssetId: string) {
	const privateObjectKey = privateObjectKeyForAsset(workerAssetId, "jpg");
	for (let attempt = 1; attempt <= MAX_PROCESS_ATTEMPTS; attempt += 1) {
		let response: Response;
		try {
			const request = createCmsMediaProcessRequest(adminCookie, privateObjectKey);
			response = await boundaryFetch(request.url, request.init);
		} catch {
			if (attempt < MAX_PROCESS_ATTEMPTS) {
				await new Promise((resolveDelay) => setTimeout(resolveDelay, 500 * attempt));
				continue;
			}
			throw new Error("CMS media processing outcome is ambiguous; resume this checkpoint");
		}
		if (response.ok) {
			return parseAboutContactPortraitProcessResult(await readJson(response), workerAssetId);
		}
		if (response.status === 401 || response.status === 403) {
			throw new Error("Admin session is no longer authorized; checkpoint preserved");
		}
		if (response.status === 404) {
			const message = await response.text();
			if (isConfirmedAboutContactPortraitSourceMissing(response.status, message)) {
				return "source-missing" as const;
			}
			throw new Error("CMS media processing returned an unexpected missing-source response");
		}
		if (response.status === 409) {
			const message = (await response.text()).trim();
			if (message !== ACTIVE_OPERATION_MESSAGE) {
				throw new Error("CMS media processing returned an unexpected conflict");
			}
			if (attempt < MAX_PROCESS_ATTEMPTS) {
				await new Promise((resolveDelay) => setTimeout(resolveDelay, 500 * attempt));
				continue;
			}
			throw new Error("CMS media processing is still active; resume this checkpoint");
		}
		if (response.status >= 500 && attempt < MAX_PROCESS_ATTEMPTS) {
			await new Promise((resolveDelay) => setTimeout(resolveDelay, 500 * attempt));
			continue;
		}
		throw new Error(`CMS media processing was rejected with status ${response.status}`);
	}
	throw new Error("CMS media processing did not settle; resume this checkpoint");
}

async function runPlan() {
	await assertFixedSource();
	console.log(
		`${ABOUT_CONTACT_PORTRAIT_OPERATION} plan-only: fixed ${ABOUT_CONTACT_PORTRAIT_SOURCE.width}x${ABOUT_CONTACT_PORTRAIT_SOURCE.height} source, SHA-256 ${ABOUT_CONTACT_PORTRAIT_SOURCE.sha256}; no provider or file state changed.`,
	);
	console.log(
		`Execution requires --execute, --cookie-file, --state-dir, and --confirm "${ABOUT_CONTACT_PORTRAIT_CONFIRMATION}".`,
	);
}

async function runExecution(options: Extract<Options, { mode: "execute" }>) {
	const sourceBytes = await assertFixedSource();
	const stateDirectory = await assertPrivateStateDirectory(options.stateDirectory);
	const checkpointPath = resolve(stateDirectory, CHECKPOINT_FILENAME);
	const receiptPath = resolve(stateDirectory, RECEIPT_FILENAME);
	const releaseLock = await acquireLock(stateDirectory);
	try {
		const [receiptValue, checkpointValue] = await Promise.all([
			readOptionalPrivateJson(receiptPath, "About portrait receipt"),
			readOptionalPrivateJson(checkpointPath, "About portrait checkpoint"),
		]);
		if (receiptValue !== null) {
			const receipt = parseAboutContactPortraitReceipt(receiptValue);
			if (checkpointValue !== null) {
				const checkpoint = parseAboutContactPortraitCheckpoint(checkpointValue);
				if (
					checkpoint.phase !== "registered" ||
					checkpoint.mediaAssetId !== receipt.mediaAssetId ||
					checkpoint.workerAssetId !== receipt.workerAssetId
				) {
					throw new Error("Receipt and checkpoint disagree; operator review is required");
				}
				await rm(checkpointPath);
				await syncDirectory(stateDirectory);
			}
			console.log(`About portrait transfer already complete: ${receiptPath}`);
			console.log(`Receipt digest: ${receipt.receiptDigest}`);
			return;
		}

		let checkpoint: AboutContactPortraitCheckpoint;
		if (checkpointValue === null) {
			checkpoint = createInitialAboutContactPortraitCheckpoint();
			await atomicWritePrivateJson(checkpointPath, checkpoint);
		} else {
			checkpoint = parseAboutContactPortraitCheckpoint(checkpointValue);
		}

		let adminCookie: string | undefined;
		while (checkpoint.phase !== "registered") {
			if (checkpoint.phase === "source-validated") {
				adminCookie ??= await loadAdminCookie(resolve(options.cookieFile));
				const capabilityAttempt = checkpoint.capabilityAttempt === 0 ? 1 : 2;
				const capability = await issueCapability(adminCookie);
				checkpoint = checkpointAboutContactPortraitPutAttempted(
					capability.assetId,
					capabilityAttempt,
				);
				await atomicWritePrivateJson(checkpointPath, checkpoint);
				await attemptUpload(capability, sourceBytes);
				console.log("About portrait upload attempted; processing fixed Worker identity.");
			}

			adminCookie ??= await loadAdminCookie(resolve(options.cookieFile));
			const processed = await processAsset(adminCookie, checkpoint.workerAssetId as string);
			if (processed === "source-missing") {
				checkpoint = checkpointAboutContactPortraitConfirmedMissing(checkpoint);
				await atomicWritePrivateJson(checkpointPath, checkpoint);
				console.log("Confirmed missing upload; reissuing one fresh capability.");
				continue;
			}
			if (checkpoint.capabilityAttempt !== 1 && checkpoint.capabilityAttempt !== 2) {
				throw new Error("About portrait checkpoint capability attempt is invalid");
			}
			checkpoint = checkpointAboutContactPortraitRegistered(
				processed,
				checkpoint.capabilityAttempt,
			);
			await atomicWritePrivateJson(checkpointPath, checkpoint);
		}

		if (!checkpoint.mediaAssetId || !checkpoint.workerAssetId) {
			throw new Error("Registered About portrait checkpoint is incomplete");
		}
		const receipt = createAboutContactPortraitReceipt({
			mediaAssetId: checkpoint.mediaAssetId,
			workerAssetId: checkpoint.workerAssetId,
		});
		await writeExclusivePrivateFile(receiptPath, serializeJson(receipt));
		await syncDirectory(stateDirectory);
		await rm(checkpointPath);
		await syncDirectory(stateDirectory);
		console.log(`About portrait transfer complete: ${receiptPath}`);
		console.log(`Receipt digest: ${receipt.receiptDigest}`);
	} finally {
		await releaseLock();
	}
}

async function main() {
	const options = parseOptions(process.argv.slice(2));
	if (options.mode === "plan") {
		await runPlan();
		return;
	}
	await runExecution(options);
}

void main().catch((error) => {
	console.error(
		error instanceof Error ? error.message : `${ABOUT_CONTACT_PORTRAIT_OPERATION} failed`,
	);
	process.exitCode = 1;
});
