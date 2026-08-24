import { execFile as execFileCallback } from "node:child_process";
import { randomUUID } from "node:crypto";
import { lstat, open, readFile, realpath, rename, rm } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import sharp from "sharp";
import {
	createCmsMediaProcessRequest,
	createCmsMediaUploadRequest,
	privateObjectKeyForAsset,
} from "./sanityBlogMediaTransfer";
import {
	checkpointSiteSettingsOgConfirmedMissing,
	checkpointSiteSettingsOgPutAttempted,
	checkpointSiteSettingsOgRegistered,
	createInitialSiteSettingsOgCheckpoint,
	createSiteSettingsOgCapabilityRequest,
	createSiteSettingsOgReceipt,
	isConfirmedSiteSettingsOgSourceMissing,
	parseSiteSettingsOgCapability,
	parseSiteSettingsOgCheckpoint,
	parseSiteSettingsOgProcessResult,
	parseSiteSettingsOgReceipt,
	SITE_SETTINGS_OG_CONFIRMATION,
	SITE_SETTINGS_OG_OPERATION,
	SITE_SETTINGS_OG_SOURCE,
	type SiteSettingsOgCheckpoint,
	validateSiteSettingsOgSource,
} from "./site-settings-og-transfer-helper";

const OWNER_BROWSER_PROFILE = "/home/strayblackdog/.config/zen/mnhjnzu5.Default (release)";
const OWNER_COOKIE_DB = resolve(OWNER_BROWSER_PROFILE, "cookies.sqlite");
const SQLITE = "/usr/bin/sqlite3";
const PRODUCTION_ORIGIN = "https://www.angelsrest.online";
const SESSION_PATH = "/api/auth/get-session";
const TOKEN_PATH = "/api/admin/token";
const RECEIPT_FILENAME = "site-settings-og-transfer-receipt.json";
const CHECKPOINT_FILENAME = ".site-settings-og-transfer-checkpoint.json";
const SOURCE_FILENAME = ".site-settings-og-transfer-source.png";
const LOCK_FILENAME = ".site-settings-og-transfer.lock";
const ACTIVE_OPERATION_MESSAGE = "CMS media asset operation is already in progress";
const TIMEOUT_MS = 120_000;
const MAX_PROCESS_ATTEMPTS = 3;
const execFile = promisify(execFileCallback);

type Options = { mode: "plan" } | { mode: "execute"; stateDirectory: string };

function serializeJson(value: unknown) {
	return `${JSON.stringify(value, null, "\t")}\n`;
}

function parseOptions(args: readonly string[]): Options {
	let execute = false;
	let confirmation: string | undefined;
	let stateDirectory: string | undefined;
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === "--") continue;
		if (arg === "--execute") {
			if (execute) throw new Error("--execute may only be supplied once");
			execute = true;
			continue;
		}
		if (arg === "--confirm" || arg === "--state-dir") {
			const value = args[index + 1];
			if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value`);
			if (arg === "--confirm") {
				if (confirmation !== undefined) throw new Error("--confirm may only be supplied once");
				confirmation = value;
			} else {
				if (stateDirectory !== undefined) throw new Error("--state-dir may only be supplied once");
				stateDirectory = value;
			}
			index += 1;
			continue;
		}
		throw new Error(`Unsupported argument: ${arg}`);
	}
	if (!execute) {
		if (confirmation !== undefined || stateDirectory !== undefined) {
			throw new Error("Execution options require --execute");
		}
		return { mode: "plan" };
	}
	if (confirmation !== SITE_SETTINGS_OG_CONFIRMATION) {
		throw new Error(`--confirm must exactly equal "${SITE_SETTINGS_OG_CONFIRMATION}"`);
	}
	if (!stateDirectory || stateDirectory !== stateDirectory.trim() || !isAbsolute(stateDirectory)) {
		throw new Error("--state-dir requires one absolute path");
	}
	return { mode: "execute", stateDirectory };
}

async function assertOwned(path: string, label: string, kind: "file" | "directory") {
	const [actual, stats] = await Promise.all([realpath(path), lstat(path)]);
	if (
		actual !== resolve(path) ||
		stats.isSymbolicLink() ||
		(kind === "file" ? !stats.isFile() : !stats.isDirectory()) ||
		(typeof process.getuid === "function" && stats.uid !== process.getuid())
	) {
		throw new Error(`${label} boundary is invalid`);
	}
	return stats;
}

async function assertPrivateStateDirectory(path: string) {
	const resolvedPath = resolve(path);
	const stats = await assertOwned(resolvedPath, "State directory", "directory");
	if ((stats.mode & 0o077) !== 0) throw new Error("State directory must be owner-only");
	return resolvedPath;
}

async function assertOwnerBrowserBoundary() {
	const profile = await assertOwned(OWNER_BROWSER_PROFILE, "Owner browser profile", "directory");
	await assertOwned(OWNER_COOKIE_DB, "Owner browser Cookie database", "file");
	if ((profile.mode & 0o077) !== 0) throw new Error("Owner browser profile must be owner-only");
}

type CookieRow = {
	host: string;
	name: string;
	valueHex: string;
	path: string;
	isSecure: number;
	isHttpOnly: number;
	creationTime: number;
};

function parseCookieRows(value: unknown) {
	if (!Array.isArray(value) || value.length !== 2) {
		throw new Error("Fresh owner Better Auth session is unavailable");
	}
	const rows = value as CookieRow[];
	const expectedNames = ["__Secure-better-auth.convex_jwt", "__Secure-better-auth.session_token"];
	return rows.map((row, index) => {
		if (
			!row ||
			Object.keys(row).sort().join(",") !==
				"creationTime,host,isHttpOnly,isSecure,name,path,valueHex" ||
			row.host !== "www.angelsrest.online" ||
			row.name !== expectedNames[index] ||
			row.path !== "/" ||
			row.isSecure !== 1 ||
			row.isHttpOnly !== 1 ||
			typeof row.creationTime !== "number" ||
			Date.now() * 1_000 - row.creationTime > 6 * 60 * 60 * 1_000_000 ||
			Date.now() * 1_000 < row.creationTime - 60_000_000 ||
			typeof row.valueHex !== "string" ||
			!/^(?:[0-9A-F]{2})+$/.test(row.valueHex)
		) {
			throw new Error("Fresh owner Better Auth session metadata is invalid");
		}
		const cookieValue = Buffer.from(row.valueHex, "hex").toString("utf8");
		if (!cookieValue || /[\s;]/.test(cookieValue) || cookieValue.length > 4_096) {
			throw new Error("Fresh owner Better Auth session value is invalid");
		}
		return `${row.name}=${cookieValue}`;
	});
}

async function loadFreshOwnerCookie() {
	await assertOwnerBrowserBoundary();
	const databaseUrl = pathToFileURL(OWNER_COOKIE_DB);
	databaseUrl.searchParams.set("immutable", "1");
	const query = `SELECT host, name, hex(value) AS valueHex, path, isSecure, isHttpOnly, creationTime
		FROM moz_cookies
		WHERE host = 'www.angelsrest.online'
		AND name IN ('__Secure-better-auth.convex_jwt', '__Secure-better-auth.session_token')
		ORDER BY name`;
	let stdout: string;
	try {
		({ stdout } = await execFile(SQLITE, ["-json", databaseUrl.href, query], {
			encoding: "utf8",
			maxBuffer: 65_536,
		}));
	} catch {
		throw new Error("Fresh owner Better Auth session could not be read safely");
	}
	let rows: unknown;
	try {
		rows = JSON.parse(stdout);
	} catch {
		throw new Error("Fresh owner Better Auth session metadata is invalid");
	}
	return parseCookieRows(rows).join("; ");
}

function assertFreshJwt(value: unknown) {
	if (typeof value !== "string" || value.length > 8_192) {
		throw new Error("Owner browser did not return a valid Better Auth JWT");
	}
	const parts = value.split(".");
	if (parts.length !== 3 || parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))) {
		throw new Error("Owner browser did not return a valid Better Auth JWT");
	}
	let payload: { exp?: unknown };
	try {
		payload = JSON.parse(Buffer.from(parts[1] as string, "base64url").toString("utf8"));
	} catch {
		throw new Error("Owner browser did not return a valid Better Auth JWT");
	}
	if (typeof payload.exp !== "number" || payload.exp * 1_000 < Date.now() + 60_000) {
		throw new Error("Owner browser Better Auth JWT is expired");
	}
}

async function boundaryFetch(input: string | URL | Request, init?: RequestInit) {
	return await fetch(input, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
}

async function readJson(response: Response) {
	try {
		return (await response.json()) as unknown;
	} catch {
		throw new Error("CMS media boundary returned invalid JSON");
	}
}

async function verifyFreshOwnerJwt(adminCookie: string) {
	let response: Response;
	try {
		response = await boundaryFetch(`${PRODUCTION_ORIGIN}${TOKEN_PATH}`, {
			method: "GET",
			redirect: "error",
			headers: { Accept: "application/json", Cookie: adminCookie },
		});
	} catch {
		throw new Error("Owner browser Better Auth JWT verification failed");
	}
	if (!response.ok) throw new Error("Owner browser is no longer signed in and authorized");
	const value = await readJson(response);
	if (
		!value ||
		typeof value !== "object" ||
		Array.isArray(value) ||
		Object.keys(value).join(",") !== "token"
	) {
		throw new Error("Owner browser Better Auth JWT response is invalid");
	}
	assertFreshJwt((value as { token?: unknown }).token);
}

async function refreshFreshOwnerJwt(adminCookie: string) {
	let response: Response;
	try {
		response = await boundaryFetch(`${PRODUCTION_ORIGIN}${SESSION_PATH}`, {
			method: "GET",
			redirect: "error",
			headers: { Accept: "application/json", Cookie: adminCookie },
		});
	} catch {
		throw new Error("Owner browser Better Auth session refresh failed");
	}
	if (!response.ok) throw new Error("Owner browser is no longer signed in");
	const session = await readJson(response);
	if (!session || typeof session !== "object" || Array.isArray(session)) {
		throw new Error("Owner browser Better Auth session refresh was rejected");
	}
	const cookiePairs = new Map(
		adminCookie.split("; ").map((pair) => [pair.slice(0, pair.indexOf("=")), pair]),
	);
	for (const setCookie of response.headers.getSetCookie()) {
		const pair = setCookie.split(";", 1)[0];
		if (!pair) continue;
		const separator = pair.indexOf("=");
		const name = pair.slice(0, separator);
		if (
			separator > 0 &&
			(name === "__Secure-better-auth.convex_jwt" || name === "__Secure-better-auth.session_token")
		) {
			cookiePairs.set(name, pair);
		}
	}
	const refreshedJwt = cookiePairs.get("__Secure-better-auth.convex_jwt")?.split("=", 2)[1];
	assertFreshJwt(refreshedJwt);
	const refreshedCookie = [
		cookiePairs.get("__Secure-better-auth.convex_jwt"),
		cookiePairs.get("__Secure-better-auth.session_token"),
	].join("; ");
	await verifyFreshOwnerJwt(refreshedCookie);
	return refreshedCookie;
}

async function syncDirectory(path: string) {
	const handle = await open(path, "r");
	try {
		await handle.sync();
	} finally {
		await handle.close();
	}
}

async function writeExclusive(path: string, contents: string | Uint8Array) {
	const handle = await open(path, "wx", 0o600);
	try {
		await handle.writeFile(contents);
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
		await writeExclusive(temporaryPath, serializeJson(value));
		await rename(temporaryPath, path);
		await syncDirectory(dirname(path));
	} finally {
		await rm(temporaryPath, { force: true });
	}
}

async function readOptionalPrivateJson(path: string, label: string) {
	try {
		const stats = await assertOwned(path, label, "file");
		if ((stats.mode & 0o077) !== 0) throw new Error(`${label} must be owner-only`);
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
		throw new Error("Site Settings OG transfer lock exists; review it before resuming");
	}
	try {
		await handle.writeFile(
			serializeJson({ operation: SITE_SETTINGS_OG_OPERATION, pid: process.pid }),
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
				throw new Error("Site Settings OG transfer lock changed during execution");
			}
			await rm(lockPath);
			await syncDirectory(stateDirectory);
		};
	} finally {
		await handle.close();
	}
}

async function validateSourceBytes(bytes: Uint8Array) {
	let metadata: Awaited<ReturnType<ReturnType<typeof sharp>["metadata"]>>;
	try {
		metadata = await sharp(bytes, { failOn: "error" }).metadata();
	} catch {
		throw new Error("Site Settings OG source is not a valid image");
	}
	return validateSiteSettingsOgSource(bytes, metadata);
}

async function fetchSourceOnce(sourcePath: string) {
	let response: Response;
	try {
		response = await boundaryFetch(SITE_SETTINGS_OG_SOURCE.url, {
			method: "GET",
			redirect: "error",
		});
	} catch {
		throw new Error("Sealed Site Settings OG source fetch failed");
	}
	if (!response.ok || response.url !== SITE_SETTINGS_OG_SOURCE.url) {
		throw new Error("Sealed Site Settings OG source boundary drifted");
	}
	const contentType = response.headers.get("content-type")?.split(";")[0]?.trim();
	const contentLength = response.headers.get("content-length");
	if (
		contentType !== SITE_SETTINGS_OG_SOURCE.contentType ||
		(contentLength !== null && Number(contentLength) !== SITE_SETTINGS_OG_SOURCE.sizeBytes)
	) {
		throw new Error("Sealed Site Settings OG source headers drifted");
	}
	const bytes = new Uint8Array(await response.arrayBuffer());
	const identity = await validateSourceBytes(bytes);
	await writeExclusive(sourcePath, bytes);
	await syncDirectory(dirname(sourcePath));
	return { bytes, identity };
}

async function readStoredSource(sourcePath: string, expectedSha256: string) {
	const stats = await assertOwned(sourcePath, "Site Settings OG temporary source", "file");
	if ((stats.mode & 0o077) !== 0) throw new Error("Temporary source must be owner-only");
	const bytes = new Uint8Array(await readFile(sourcePath));
	const identity = await validateSourceBytes(bytes);
	if (identity.sourceSha256 !== expectedSha256) {
		throw new Error("Temporary source differs from the durable checkpoint");
	}
	return bytes;
}

async function issueCapability(adminCookie: string) {
	const request = createSiteSettingsOgCapabilityRequest(adminCookie);
	let response: Response;
	try {
		response = await boundaryFetch(request.url, request.init);
	} catch {
		throw new Error("CMS media capability request failed before upload");
	}
	if (!response.ok) {
		throw new Error(`CMS media capability request was rejected with status ${response.status}`);
	}
	return parseSiteSettingsOgCapability(await readJson(response), Date.now());
}

async function attemptUpload(
	capability: Awaited<ReturnType<typeof issueCapability>>,
	sourceBytes: Uint8Array,
) {
	try {
		const request = createCmsMediaUploadRequest(
			capability,
			sourceBytes,
			SITE_SETTINGS_OG_SOURCE.contentType,
		);
		const response = await boundaryFetch(request.url, request.init);
		if (!response.ok && response.status !== 409 && response.status < 500) {
			throw new Error(`CMS media upload was rejected with status ${response.status}`);
		}
	} catch (error) {
		if (error instanceof Error && error.message.startsWith("CMS media upload was rejected")) {
			throw error;
		}
		// The durable put-attempted checkpoint makes ambiguous outcomes recoverable.
	}
}

async function processAsset(adminCookie: string, workerAssetId: string) {
	const privateObjectKey = privateObjectKeyForAsset(workerAssetId, "png");
	for (let attempt = 1; attempt <= MAX_PROCESS_ATTEMPTS; attempt += 1) {
		let response: Response;
		try {
			const request = createCmsMediaProcessRequest(adminCookie, privateObjectKey);
			response = await boundaryFetch(request.url, request.init);
		} catch {
			if (attempt < MAX_PROCESS_ATTEMPTS) continue;
			throw new Error("CMS media processing outcome is ambiguous; resume this checkpoint");
		}
		if (response.ok) {
			return parseSiteSettingsOgProcessResult(await readJson(response), workerAssetId);
		}
		if (response.status === 401 || response.status === 403) {
			throw new Error("Owner browser session is no longer authorized; checkpoint preserved");
		}
		if (response.status === 404) {
			const message = await response.text();
			if (isConfirmedSiteSettingsOgSourceMissing(response.status, message)) {
				return "source-missing" as const;
			}
			throw new Error("CMS media processing returned an unexpected missing-source response");
		}
		if (response.status === 409) {
			if ((await response.text()).trim() !== ACTIVE_OPERATION_MESSAGE) {
				throw new Error("CMS media processing returned an unexpected conflict");
			}
			if (attempt < MAX_PROCESS_ATTEMPTS) continue;
			throw new Error("CMS media processing is still active; resume this checkpoint");
		}
		if (response.status >= 500 && attempt < MAX_PROCESS_ATTEMPTS) continue;
		throw new Error(`CMS media processing was rejected with status ${response.status}`);
	}
	throw new Error("CMS media processing did not settle; resume this checkpoint");
}

function registeredFromCheckpoint(checkpoint: SiteSettingsOgCheckpoint) {
	if (
		checkpoint.phase !== "registered" ||
		!checkpoint.mediaAssetId ||
		!checkpoint.workerAssetId ||
		!checkpoint.targetCreatedAt ||
		!checkpoint.derivatives
	) {
		throw new Error("Registered Site Settings OG checkpoint is incomplete");
	}
	return {
		mediaAssetId: checkpoint.mediaAssetId,
		workerAssetId: checkpoint.workerAssetId,
		createdAt: checkpoint.targetCreatedAt,
		derivatives: checkpoint.derivatives,
	};
}

async function runExecution(options: Extract<Options, { mode: "execute" }>) {
	const stateDirectory = await assertPrivateStateDirectory(options.stateDirectory);
	const checkpointPath = resolve(stateDirectory, CHECKPOINT_FILENAME);
	const receiptPath = resolve(stateDirectory, RECEIPT_FILENAME);
	const sourcePath = resolve(stateDirectory, SOURCE_FILENAME);
	const releaseLock = await acquireLock(stateDirectory);
	try {
		const [receiptValue, checkpointValue] = await Promise.all([
			readOptionalPrivateJson(receiptPath, "Site Settings OG receipt"),
			readOptionalPrivateJson(checkpointPath, "Site Settings OG checkpoint"),
		]);
		if (receiptValue !== null) {
			const receipt = parseSiteSettingsOgReceipt(receiptValue);
			if (checkpointValue !== null) {
				const checkpoint = parseSiteSettingsOgCheckpoint(checkpointValue);
				if (
					checkpoint.phase !== "registered" ||
					checkpoint.mediaAssetId !== receipt.mediaAssetId ||
					checkpoint.workerAssetId !== receipt.workerAssetId
				) {
					throw new Error("Receipt and checkpoint disagree; operator review is required");
				}
			}
			await Promise.all([rm(checkpointPath, { force: true }), rm(sourcePath, { force: true })]);
			await syncDirectory(stateDirectory);
			console.log(`Site Settings OG transfer already complete: ${receiptPath}`);
			console.log(`Receipt digest: ${receipt.receiptDigest}`);
			return;
		}

		const adminCookie = await refreshFreshOwnerJwt(await loadFreshOwnerCookie());
		let checkpoint: SiteSettingsOgCheckpoint;
		let sourceBytes: Uint8Array | undefined;
		if (checkpointValue === null) {
			const fetched = await fetchSourceOnce(sourcePath);
			sourceBytes = fetched.bytes;
			checkpoint = createInitialSiteSettingsOgCheckpoint(fetched.identity.sourceSha256);
			await atomicWritePrivateJson(checkpointPath, checkpoint);
		} else {
			checkpoint = parseSiteSettingsOgCheckpoint(checkpointValue);
		}

		while (checkpoint.phase !== "registered") {
			if (checkpoint.phase === "source-validated") {
				sourceBytes ??= await readStoredSource(sourcePath, checkpoint.sourceSha256);
				const capabilityAttempt = checkpoint.capabilityAttempt === 0 ? 1 : 2;
				const capability = await issueCapability(adminCookie);
				checkpoint = checkpointSiteSettingsOgPutAttempted(
					checkpoint.sourceSha256,
					capability.assetId,
					capabilityAttempt,
				);
				await atomicWritePrivateJson(checkpointPath, checkpoint);
				await attemptUpload(capability, sourceBytes);
			}

			const processed = await processAsset(adminCookie, checkpoint.workerAssetId as string);
			if (processed === "source-missing") {
				checkpoint = checkpointSiteSettingsOgConfirmedMissing(checkpoint);
				await atomicWritePrivateJson(checkpointPath, checkpoint);
				continue;
			}
			if (checkpoint.capabilityAttempt !== 1 && checkpoint.capabilityAttempt !== 2) {
				throw new Error("Site Settings OG checkpoint capability attempt is invalid");
			}
			checkpoint = checkpointSiteSettingsOgRegistered(
				checkpoint.sourceSha256,
				processed,
				checkpoint.capabilityAttempt,
			);
			await atomicWritePrivateJson(checkpointPath, checkpoint);
		}

		const registered = registeredFromCheckpoint(checkpoint);
		const receipt = createSiteSettingsOgReceipt(checkpoint.sourceSha256, registered);
		await rm(sourcePath, { force: true });
		await syncDirectory(stateDirectory);
		await writeExclusive(receiptPath, serializeJson(receipt));
		await syncDirectory(stateDirectory);
		await rm(checkpointPath);
		await syncDirectory(stateDirectory);
		console.log(`Site Settings OG transfer complete: ${receiptPath}`);
		console.log(`Receipt digest: ${receipt.receiptDigest}`);
	} finally {
		await releaseLock();
	}
}

async function main() {
	const options = parseOptions(process.argv.slice(2));
	if (options.mode === "plan") {
		console.log(
			`${SITE_SETTINGS_OG_OPERATION} plan-only: fixed ${SITE_SETTINGS_OG_SOURCE.width}x${SITE_SETTINGS_OG_SOURCE.height} Sanity PNG ${SITE_SETTINGS_OG_SOURCE.assetRef}; no provider or file state changed.`,
		);
		console.log(
			`Execution requires --execute, --state-dir, and --confirm "${SITE_SETTINGS_OG_CONFIRMATION}".`,
		);
		return;
	}
	await runExecution(options);
}

void main().catch((error) => {
	console.error(error instanceof Error ? error.message : `${SITE_SETTINGS_OG_OPERATION} failed`);
	process.exitCode = 1;
});
