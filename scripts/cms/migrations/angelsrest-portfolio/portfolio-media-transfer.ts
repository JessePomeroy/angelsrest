import { execFile as execFileCallback } from "node:child_process";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, realpath, rename, rm } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import sharp from "sharp";
import { atomicPublishPrivateExclusive } from "./portfolioAtomicState";
import {
	checkpointPortfolioMediaConfirmedMissing,
	checkpointPortfolioMediaPutAttempted,
	checkpointPortfolioMediaRegistered,
	checkpointPortfolioPublicDerivativesVerified,
	createPortfolioMediaCheckpoint,
	createPortfolioMediaReceipt,
	createPortfolioMediaReceiptSet,
	type PortfolioMediaCheckpoint,
	type PortfolioMediaReceipt,
	type PortfolioTransformedSource,
	parsePortfolioMediaCapability,
	parsePortfolioMediaCheckpoint,
	parsePortfolioMediaProcessResult,
	parsePortfolioMediaReceipt,
	parsePortfolioMediaReceiptSet,
	privatePortfolioObjectKey,
	transformedPortfolioFilename,
	validatePortfolioPublicDerivative,
	validatePortfolioTransformedSource,
} from "./portfolioMediaTransfer";
import {
	canonicalPortfolioMediaJson,
	createPortfolioMediaTransferPlan,
	PORTFOLIO_INVENTORY_FILE_SHA256,
	PORTFOLIO_MEDIA_CANARY_REF,
	PORTFOLIO_MEDIA_CONCURRENCY,
	PORTFOLIO_MEDIA_CONFIRMATION,
	PORTFOLIO_MEDIA_MAX_BYTES,
	PORTFOLIO_MEDIA_OPERATION,
	PORTFOLIO_PRESERVED_TARGET_READ_FILE_SHA256,
	type PortfolioInventoryFiles,
	type PortfolioMediaPlanAsset,
	type PortfolioMediaTransferPlan,
	type PortfolioPreservedTargetFiles,
	parsePortfolioMediaTransferPlan,
} from "./portfolioMediaTransferPlan";
import { createPortfolioMigrationPlanFromReceipts } from "./portfolioMigrationPlanOperator";

const OWNER_BROWSER_PROFILE = "/home/strayblackdog/.config/zen/mnhjnzu5.Default (release)";
const OWNER_COOKIE_DB = resolve(OWNER_BROWSER_PROFILE, "cookies.sqlite");
const SQLITE = "/usr/bin/sqlite3";
const PRODUCTION_ORIGIN = "https://www.angelsrest.online";
const MEDIA_ORIGIN = "https://media.angelsrest.online";
const CAPABILITY_PATH = "/api/admin/media/capability";
const PROCESS_PATH = "/api/admin/media/process";
const SESSION_PATH = "/api/auth/get-session";
const TOKEN_PATH = "/api/admin/token";
const PLAN_FILENAME = "portfolio-media-transfer-plan.json";
const RECEIPT_SET_FILENAME = "portfolio-media-transfer-receipts.json";
const MIGRATION_PLAN_FILENAME = "portfolio-migration-plan.json";
const ASSET_STATE_DIRECTORY = "portfolio-media-assets";
const LOCK_FILENAME = ".portfolio-media-transfer.lock";
const SOURCE_MISSING_RESPONSE = "Uploaded object not found";
const ACTIVE_OPERATION_MESSAGE = "CMS media asset operation is already in progress";
const REQUEST_TIMEOUT_MS = 120_000;
const MAX_PROCESS_ATTEMPTS = 12;
const MAX_PUBLIC_PROBE_ATTEMPTS = 5;
const execFile = promisify(execFileCallback);

type Options =
	| {
			mode: "plan";
			inventoryDirectory: string;
			preservedTargetDirectory: string;
			stateDirectory?: string;
	  }
	| {
			mode: "execute";
			inventoryDirectory: string;
			preservedTargetDirectory: string;
			stateDirectory: string;
			cookieFile?: string;
	  };

type CookieRow = {
	host: string;
	name: string;
	valueHex: string;
	path: string;
	isSecure: number;
	isHttpOnly: number;
	creationTime: number;
};

function serializeJson(value: unknown): string {
	return `${JSON.stringify(value, null, "\t")}\n`;
}

function parseOptions(args: readonly string[]): Options {
	let execute = false;
	let confirmation: string | undefined;
	let inventoryDirectory: string | undefined;
	let preservedTargetDirectory: string | undefined;
	let stateDirectory: string | undefined;
	let cookieFile: string | undefined;
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === "--") continue;
		if (arg === "--execute") {
			if (execute) throw new Error("--execute may only be supplied once");
			execute = true;
			continue;
		}
		if (
			arg === "--confirm" ||
			arg === "--inventory-dir" ||
			arg === "--preserved-target-dir" ||
			arg === "--state-dir" ||
			arg === "--cookie-file"
		) {
			const value = args[index + 1];
			if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value`);
			if (arg === "--confirm") {
				if (confirmation !== undefined) throw new Error("--confirm may only be supplied once");
				confirmation = value;
			} else if (arg === "--inventory-dir") {
				if (inventoryDirectory !== undefined) {
					throw new Error("--inventory-dir may only be supplied once");
				}
				inventoryDirectory = value;
			} else if (arg === "--preserved-target-dir") {
				if (preservedTargetDirectory !== undefined) {
					throw new Error("--preserved-target-dir may only be supplied once");
				}
				preservedTargetDirectory = value;
			} else if (arg === "--state-dir") {
				if (stateDirectory !== undefined) throw new Error("--state-dir may only be supplied once");
				stateDirectory = value;
			} else {
				if (cookieFile !== undefined) throw new Error("--cookie-file may only be supplied once");
				cookieFile = value;
			}
			index += 1;
			continue;
		}
		throw new Error(`Unsupported argument: ${arg}`);
	}
	if (
		!inventoryDirectory ||
		inventoryDirectory !== inventoryDirectory.trim() ||
		!isAbsolute(inventoryDirectory)
	) {
		throw new Error("--inventory-dir requires one absolute path");
	}
	if (
		!preservedTargetDirectory ||
		preservedTargetDirectory !== preservedTargetDirectory.trim() ||
		!isAbsolute(preservedTargetDirectory)
	) {
		throw new Error("--preserved-target-dir requires one absolute path");
	}
	if (!execute) {
		if (confirmation !== undefined || cookieFile !== undefined) {
			throw new Error("Execution-only options require --execute");
		}
		if (
			stateDirectory !== undefined &&
			(stateDirectory !== stateDirectory.trim() || !isAbsolute(stateDirectory))
		) {
			throw new Error("--state-dir requires one absolute path");
		}
		return { mode: "plan", inventoryDirectory, preservedTargetDirectory, stateDirectory };
	}
	if (confirmation !== PORTFOLIO_MEDIA_CONFIRMATION) {
		throw new Error(`--confirm must exactly equal "${PORTFOLIO_MEDIA_CONFIRMATION}"`);
	}
	if (!stateDirectory || stateDirectory !== stateDirectory.trim() || !isAbsolute(stateDirectory)) {
		throw new Error("--state-dir requires one absolute path");
	}
	if (cookieFile !== undefined && (cookieFile !== cookieFile.trim() || !isAbsolute(cookieFile))) {
		throw new Error("--cookie-file requires one absolute path");
	}
	return {
		mode: "execute",
		inventoryDirectory,
		preservedTargetDirectory,
		stateDirectory,
		cookieFile,
	};
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

async function assertPrivateDirectory(path: string, label: string) {
	const resolved = resolve(path);
	const stats = await assertOwned(resolved, label, "directory");
	if ((stats.mode & 0o077) !== 0) throw new Error(`${label} must be owner-only`);
	return resolved;
}

async function loadInventory(directory: string): Promise<PortfolioInventoryFiles> {
	const root = await assertPrivateDirectory(directory, "Portfolio inventory directory");
	const entries = await Promise.all(
		Object.keys(PORTFOLIO_INVENTORY_FILE_SHA256).map(async (filename) => {
			const path = resolve(root, filename);
			await assertOwned(path, `Portfolio inventory ${filename}`, "file");
			return [filename, await readFile(path, "utf8")] as const;
		}),
	);
	return Object.fromEntries(entries) as PortfolioInventoryFiles;
}

async function loadPreservedTargetEvidence(
	directory: string,
): Promise<PortfolioPreservedTargetFiles> {
	const root = await assertPrivateDirectory(
		directory,
		"Preserved Portfolio target evidence directory",
	);
	const entries = await Promise.all(
		Object.keys(PORTFOLIO_PRESERVED_TARGET_READ_FILE_SHA256).map(async (filename) => {
			const path = resolve(root, filename);
			await assertOwned(path, `Preserved Portfolio target ${filename}`, "file");
			return [filename, await readFile(path, "utf8")] as const;
		}),
	);
	return Object.fromEntries(entries) as PortfolioPreservedTargetFiles;
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
	const temporary = resolve(
		dirname(path),
		`.${path.split("/").at(-1)}.tmp-${process.pid}-${randomUUID()}`,
	);
	try {
		await writeExclusive(temporary, serializeJson(value));
		await rename(temporary, path);
		await syncDirectory(dirname(path));
	} finally {
		await rm(temporary, { force: true });
	}
}

async function readOptionalPrivate(path: string, label: string): Promise<unknown | null> {
	try {
		const stats = await assertOwned(path, label, "file");
		if ((stats.mode & 0o077) !== 0) throw new Error(`${label} must be owner-only`);
		return JSON.parse(await readFile(path, "utf8")) as unknown;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
}

async function publishOrVerifyPrivateJson<T>(
	path: string,
	value: T,
	label: string,
	parse: (existing: unknown) => T,
) {
	try {
		await atomicPublishPrivateExclusive(path, serializeJson(value));
		return;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
	}
	const existing = await readOptionalPrivate(path, label);
	if (
		existing === null ||
		canonicalPortfolioMediaJson(parse(existing)) !== canonicalPortfolioMediaJson(value)
	) {
		throw new Error(`${label} no-overwrite replay differs`);
	}
}

async function ensurePrivateChildDirectory(parent: string, name: string) {
	const path = resolve(parent, name);
	try {
		await mkdir(path, { mode: 0o700 });
		await syncDirectory(parent);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
	}
	return await assertPrivateDirectory(path, `Portfolio ${name} state directory`);
}

async function writeOrVerifyPlan(stateDirectory: string, plan: PortfolioMediaTransferPlan) {
	const path = resolve(stateDirectory, PLAN_FILENAME);
	const existing = await readOptionalPrivate(path, "Portfolio media plan");
	if (existing === null) {
		await publishOrVerifyPrivateJson(path, plan, "Portfolio media plan", (value) =>
			parsePortfolioMediaTransferPlan(value),
		);
		return path;
	}
	const parsed = parsePortfolioMediaTransferPlan(existing);
	if (canonicalPortfolioMediaJson(parsed) !== canonicalPortfolioMediaJson(plan)) {
		throw new Error("Prepared Portfolio media plan differs from the sealed inventory");
	}
	return path;
}

async function writeOrVerifyMigrationPlan(stateDirectory: string, value: unknown) {
	const path = resolve(stateDirectory, MIGRATION_PLAN_FILENAME);
	const existing = await readOptionalPrivate(path, "Portfolio migration plan");
	if (existing === null) {
		await publishOrVerifyPrivateJson(path, value, "Portfolio migration plan", (candidate) => {
			if (canonicalPortfolioMediaJson(candidate) !== canonicalPortfolioMediaJson(value)) {
				throw new Error("Portfolio migration plan replay differs from the sealed receipts");
			}
			return value;
		});
		return path;
	}
	if (canonicalPortfolioMediaJson(existing) !== canonicalPortfolioMediaJson(value)) {
		throw new Error("Portfolio migration plan replay differs from the sealed receipts");
	}
	return path;
}

async function materializeMigrationPlan({
	stateDirectory,
	files,
	preservedTargetFiles,
	transferPlan,
	receiptSet,
}: {
	stateDirectory: string;
	files: PortfolioInventoryFiles;
	preservedTargetFiles: PortfolioPreservedTargetFiles;
	transferPlan: PortfolioMediaTransferPlan;
	receiptSet: ReturnType<typeof parsePortfolioMediaReceiptSet>;
}) {
	const migration = await createPortfolioMigrationPlanFromReceipts({
		files,
		preservedTargetFiles,
		transferPlan,
		receiptSet,
	});
	const envelope = {
		schema: "angelsrest.r6.portfolio-migration-plan-envelope.v1",
		transferPlanDigest: transferPlan.planDigest,
		receiptSetDigest: receiptSet.receiptSetDigest,
		migrationPlanDigest: migration.digest,
		counts: migration.counts,
		plan: migration.plan,
	};
	return {
		...migration,
		path: await writeOrVerifyMigrationPlan(stateDirectory, envelope),
	};
}

async function acquireLock(stateDirectory: string) {
	const path = resolve(stateDirectory, LOCK_FILENAME);
	let handle: Awaited<ReturnType<typeof open>>;
	try {
		handle = await open(path, "wx", 0o600);
	} catch {
		throw new Error("Portfolio media transfer lock exists; review it before resuming");
	}
	try {
		await handle.writeFile(
			serializeJson({ operation: PORTFOLIO_MEDIA_OPERATION, pid: process.pid }),
		);
		await handle.sync();
		const acquired = await handle.stat();
		return async () => {
			const current = await lstat(path);
			if (
				!current.isFile() ||
				current.isSymbolicLink() ||
				current.dev !== acquired.dev ||
				current.ino !== acquired.ino
			) {
				throw new Error("Portfolio media transfer lock changed during execution");
			}
			await rm(path);
			await syncDirectory(stateDirectory);
		};
	} finally {
		await handle.close();
	}
}

function parseCookieRows(value: unknown) {
	if (!Array.isArray(value) || value.length !== 2) {
		throw new Error("Fresh owner Better Auth session is unavailable");
	}
	const expected = ["__Secure-better-auth.convex_jwt", "__Secure-better-auth.session_token"];
	return (value as CookieRow[]).map((row, index) => {
		if (
			!row ||
			Object.keys(row).sort().join(",") !==
				"creationTime,host,isHttpOnly,isSecure,name,path,valueHex" ||
			row.host !== "www.angelsrest.online" ||
			row.name !== expected[index] ||
			row.path !== "/" ||
			row.isSecure !== 1 ||
			row.isHttpOnly !== 1 ||
			typeof row.creationTime !== "number" ||
			Date.now() * 1_000 - row.creationTime > 8 * 60 * 60 * 1_000_000 ||
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

async function loadOwnerProfileCookie() {
	const profile = await assertOwned(OWNER_BROWSER_PROFILE, "Owner browser profile", "directory");
	await assertOwned(OWNER_COOKIE_DB, "Owner browser Cookie database", "file");
	if ((profile.mode & 0o077) !== 0) throw new Error("Owner browser profile must be owner-only");
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
	try {
		return parseCookieRows(JSON.parse(stdout) as unknown).join("; ");
	} catch (error) {
		if (error instanceof Error) throw error;
		throw new Error("Fresh owner Better Auth session metadata is invalid");
	}
}

async function loadOwnerCookieFile(path: string) {
	const stats = await assertOwned(path, "Admin Cookie file", "file");
	if ((stats.mode & 0o077) !== 0) throw new Error("Admin Cookie file must be owner-only");
	const cookie = await readFile(path, "utf8");
	if (
		!cookie ||
		cookie !== cookie.trim() ||
		cookie.length > 8_192 ||
		/[\r\n]/.test(cookie) ||
		!cookie.includes("=") ||
		/^cookie\s*:/i.test(cookie)
	) {
		throw new Error("Admin Cookie file must contain one raw Cookie value");
	}
	return cookie;
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
	return await fetch(input, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
}

async function readJson(response: Response, label: string) {
	try {
		return (await response.json()) as unknown;
	} catch {
		throw new Error(`${label} returned invalid JSON`);
	}
}

async function verifyOwnerJwt(cookie: string) {
	let response: Response;
	try {
		response = await boundaryFetch(`${PRODUCTION_ORIGIN}${TOKEN_PATH}`, {
			method: "GET",
			redirect: "error",
			headers: { Accept: "application/json", Cookie: cookie },
		});
	} catch {
		throw new Error("Owner Better Auth JWT verification failed");
	}
	if (!response.ok) throw new Error("Owner browser is no longer signed in and authorized");
	const root = await readJson(response, "Owner Better Auth JWT boundary");
	if (
		!root ||
		typeof root !== "object" ||
		Array.isArray(root) ||
		Object.keys(root).join(",") !== "token"
	) {
		throw new Error("Owner Better Auth JWT response is invalid");
	}
	assertFreshJwt((root as { token?: unknown }).token);
}

async function refreshOwnerCookie(cookie: string) {
	let response: Response;
	try {
		response = await boundaryFetch(`${PRODUCTION_ORIGIN}${SESSION_PATH}`, {
			method: "GET",
			redirect: "error",
			headers: { Accept: "application/json", Cookie: cookie },
		});
	} catch {
		throw new Error("Owner Better Auth session refresh failed");
	}
	if (!response.ok) throw new Error("Owner browser is no longer signed in");
	await readJson(response, "Owner Better Auth session boundary");
	const pairs = new Map(cookie.split("; ").map((pair) => [pair.slice(0, pair.indexOf("=")), pair]));
	for (const setCookie of response.headers.getSetCookie()) {
		const pair = setCookie.split(";", 1)[0];
		if (!pair) continue;
		const separator = pair.indexOf("=");
		const name = pair.slice(0, separator);
		if (
			separator > 0 &&
			(name === "__Secure-better-auth.convex_jwt" || name === "__Secure-better-auth.session_token")
		) {
			pairs.set(name, pair);
		}
	}
	const refreshed = [
		pairs.get("__Secure-better-auth.convex_jwt"),
		pairs.get("__Secure-better-auth.session_token"),
	].join("; ");
	assertFreshJwt(pairs.get("__Secure-better-auth.convex_jwt")?.split("=", 2)[1]);
	await verifyOwnerJwt(refreshed);
	return refreshed;
}

class OwnerAuthentication {
	private cookieValue: string | undefined;
	private refreshedAt = 0;
	private refreshPromise: Promise<string> | undefined;

	constructor(private readonly cookieFile?: string) {}

	async cookie() {
		if (this.cookieValue && Date.now() - this.refreshedAt < 10 * 60_000) return this.cookieValue;
		this.refreshPromise ??= this.refresh();
		try {
			return await this.refreshPromise;
		} finally {
			this.refreshPromise = undefined;
		}
	}

	private async refresh() {
		const initial =
			this.cookieValue ??
			(this.cookieFile
				? await loadOwnerCookieFile(this.cookieFile)
				: await loadOwnerProfileCookie());
		this.cookieValue = await refreshOwnerCookie(initial);
		this.refreshedAt = Date.now();
		return this.cookieValue;
	}
}

async function readBoundedBytes(response: Response, maximum: number) {
	const contentLength = response.headers.get("content-length");
	if (contentLength !== null) {
		const parsed = Number(contentLength);
		if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
			throw new Error("Portfolio media response exceeds the accepted byte boundary");
		}
	}
	if (!response.body) throw new Error("Portfolio media response has no body");
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			if (!value) continue;
			total += value.byteLength;
			if (total > maximum) {
				await reader.cancel();
				throw new Error("Portfolio media response exceeds the accepted byte boundary");
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}
	if (total < 1) throw new Error("Portfolio media response is empty");
	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return bytes;
}

async function decodeMetadata(bytes: Uint8Array) {
	try {
		return await sharp(bytes, { animated: true, failOn: "error" }).metadata();
	} catch {
		throw new Error("Portfolio media boundary returned an invalid image");
	}
}

async function fetchTransformedSource(asset: PortfolioMediaPlanAsset) {
	let response: Response;
	try {
		response = await boundaryFetch(asset.transferSource.url, {
			method: "GET",
			redirect: "error",
			headers: { Accept: "image/webp" },
		});
	} catch {
		throw new Error("Sealed Portfolio Sanity transform fetch failed");
	}
	if (
		!response.ok ||
		response.url !== asset.transferSource.url ||
		response.headers.get("content-type")?.split(";", 1)[0]?.trim() !== "image/webp"
	) {
		throw new Error("Sealed Portfolio Sanity transform boundary drifted");
	}
	const bytes = await readBoundedBytes(response, PORTFOLIO_MEDIA_MAX_BYTES);
	return {
		bytes,
		transfer: validatePortfolioTransformedSource(asset, bytes, await decodeMetadata(bytes)),
	};
}

async function readStoredSource(
	path: string,
	asset: PortfolioMediaPlanAsset,
	expected?: PortfolioTransformedSource,
) {
	const stats = await assertOwned(path, "Portfolio temporary transformed source", "file");
	if ((stats.mode & 0o077) !== 0) throw new Error("Portfolio temporary source must be owner-only");
	if (stats.size > PORTFOLIO_MEDIA_MAX_BYTES) {
		throw new Error("Portfolio temporary source exceeds the accepted byte boundary");
	}
	const bytes = new Uint8Array(await readFile(path));
	const transfer = validatePortfolioTransformedSource(asset, bytes, await decodeMetadata(bytes));
	if (expected && canonicalPortfolioMediaJson(transfer) !== canonicalPortfolioMediaJson(expected)) {
		throw new Error("Portfolio temporary source differs from its durable checkpoint");
	}
	return { bytes, transfer };
}

function statePrefix(asset: PortfolioMediaPlanAsset) {
	return `${String(asset.sourceOrder).padStart(3, "0")}-${asset.sourceAsset.sha1}`;
}

function assetStatePaths(directory: string, asset: PortfolioMediaPlanAsset) {
	const prefix = statePrefix(asset);
	return {
		checkpoint: resolve(directory, `${prefix}.checkpoint.json`),
		receipt: resolve(directory, `${prefix}.receipt.json`),
		source: resolve(directory, `${prefix}.source.webp`),
	};
}

async function sourceForCheckpoint(
	paths: ReturnType<typeof assetStatePaths>,
	asset: PortfolioMediaPlanAsset,
	checkpoint: PortfolioMediaCheckpoint | null,
) {
	if (checkpoint) return await readStoredSource(paths.source, asset, checkpoint.transfer);
	try {
		return await readStoredSource(paths.source, asset);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	const fetched = await fetchTransformedSource(asset);
	try {
		await atomicPublishPrivateExclusive(paths.source, fetched.bytes);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
		return await readStoredSource(paths.source, asset, fetched.transfer);
	}
	return fetched;
}

async function issueCapability(
	authentication: OwnerAuthentication,
	asset: PortfolioMediaPlanAsset,
	transfer: PortfolioTransformedSource,
) {
	let response: Response;
	try {
		response = await boundaryFetch(`${PRODUCTION_ORIGIN}${CAPABILITY_PATH}`, {
			method: "POST",
			redirect: "error",
			headers: {
				"Content-Type": "application/json",
				Cookie: await authentication.cookie(),
			},
			body: JSON.stringify({
				filename: transformedPortfolioFilename(asset),
				contentType: transfer.contentType,
				sizeBytes: transfer.sizeBytes,
			}),
		});
	} catch {
		throw new Error("Portfolio CMS media capability request failed before upload");
	}
	if (!response.ok) {
		throw new Error(`Portfolio CMS media capability was rejected with status ${response.status}`);
	}
	return parsePortfolioMediaCapability(
		await readJson(response, "Portfolio CMS media capability boundary"),
		Date.now(),
	);
}

async function attemptUpload(
	capability: Awaited<ReturnType<typeof issueCapability>>,
	bytes: Uint8Array,
) {
	try {
		const response = await boundaryFetch(capability.uploadUrl, {
			method: "PUT",
			redirect: "error",
			headers: {
				"Content-Type": "image/webp",
				"Content-Length": String(bytes.byteLength),
				"X-CMS-Media-Upload-Token": capability.uploadToken,
			},
			body: bytes as BodyInit,
		});
		if (!response.ok && response.status !== 409 && response.status < 500) {
			throw new Error(`Portfolio CMS media upload was rejected with status ${response.status}`);
		}
	} catch (error) {
		if (
			error instanceof Error &&
			error.message.startsWith("Portfolio CMS media upload was rejected")
		) {
			throw error;
		}
		// A durable put-attempted checkpoint makes network and server outcomes resumable.
	}
}

async function processAsset(
	authentication: OwnerAuthentication,
	asset: PortfolioMediaPlanAsset,
	checkpoint: PortfolioMediaCheckpoint,
) {
	if (!checkpoint.workerAssetId)
		throw new Error("Portfolio put checkpoint lacks a Worker identity");
	const privateObjectKey = privatePortfolioObjectKey(checkpoint.workerAssetId);
	for (let attempt = 1; attempt <= MAX_PROCESS_ATTEMPTS; attempt += 1) {
		let response: Response;
		try {
			response = await boundaryFetch(`${PRODUCTION_ORIGIN}${PROCESS_PATH}`, {
				method: "POST",
				redirect: "error",
				headers: {
					"Content-Type": "application/json",
					Cookie: await authentication.cookie(),
				},
				body: JSON.stringify({ privateObjectKey }),
			});
		} catch {
			if (attempt < MAX_PROCESS_ATTEMPTS) {
				await new Promise((resolveDelay) => setTimeout(resolveDelay, 400 * Math.min(attempt, 5)));
				continue;
			}
			throw new Error("Portfolio CMS media processing outcome is ambiguous; resume checkpoint");
		}
		if (response.ok) {
			return parsePortfolioMediaProcessResult(
				await readJson(response, "Portfolio CMS media process boundary"),
				asset,
				checkpoint.transfer,
				checkpoint.workerAssetId,
			);
		}
		if (response.status === 401 || response.status === 403) {
			throw new Error("Owner session is no longer authorized; Portfolio checkpoint preserved");
		}
		if (response.status === 404) {
			if ((await response.text()).trim() === SOURCE_MISSING_RESPONSE)
				return "source-missing" as const;
			throw new Error("Portfolio CMS media processing returned an unexpected missing source");
		}
		if (response.status === 409) {
			if ((await response.text()).trim() !== ACTIVE_OPERATION_MESSAGE) {
				throw new Error("Portfolio CMS media processing returned an unexpected conflict");
			}
			if (attempt < MAX_PROCESS_ATTEMPTS) {
				await new Promise((resolveDelay) => setTimeout(resolveDelay, 400 * Math.min(attempt, 5)));
				continue;
			}
			throw new Error("Portfolio CMS media processing remains active; resume checkpoint");
		}
		if (response.status >= 500 && attempt < MAX_PROCESS_ATTEMPTS) {
			await new Promise((resolveDelay) => setTimeout(resolveDelay, 400 * Math.min(attempt, 5)));
			continue;
		}
		throw new Error(`Portfolio CMS media processing was rejected with status ${response.status}`);
	}
	throw new Error("Portfolio CMS media processing did not settle; resume checkpoint");
}

async function inspectPublicDerivative(
	asset: PortfolioMediaPlanAsset,
	workerAssetId: string,
	derivative: "card" | "display2048",
) {
	const filename = derivative === "card" ? "card.webp" : "display-2048.webp";
	const url = `${MEDIA_ORIGIN}/sites/angelsrest.online/web/${workerAssetId}/${filename}`;
	for (let attempt = 1; attempt <= MAX_PUBLIC_PROBE_ATTEMPTS; attempt += 1) {
		let response: Response;
		try {
			response = await boundaryFetch(url, { method: "GET", redirect: "error" });
		} catch {
			if (attempt < MAX_PUBLIC_PROBE_ATTEMPTS) continue;
			throw new Error(`Portfolio ${derivative} public inspection failed`);
		}
		const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim();
		if (response.ok && response.url === url && contentType === "image/webp") {
			const bytes = await readBoundedBytes(response, PORTFOLIO_MEDIA_MAX_BYTES);
			return validatePortfolioPublicDerivative(
				asset,
				workerAssetId,
				derivative,
				contentType,
				bytes,
				await decodeMetadata(bytes),
			);
		}
		if (attempt < MAX_PUBLIC_PROBE_ATTEMPTS) {
			await new Promise((resolveDelay) => setTimeout(resolveDelay, 500 * attempt));
			continue;
		}
		throw new Error(`Portfolio ${derivative} public derivative is unavailable`);
	}
	throw new Error(`Portfolio ${derivative} public inspection did not settle`);
}

async function executeOneAsset({
	plan,
	asset,
	stateDirectory,
	authentication,
}: {
	plan: PortfolioMediaTransferPlan;
	asset: PortfolioMediaPlanAsset;
	stateDirectory: string;
	authentication: OwnerAuthentication;
}): Promise<PortfolioMediaReceipt> {
	const paths = assetStatePaths(stateDirectory, asset);
	const receiptValue = await readOptionalPrivate(paths.receipt, "Portfolio media asset receipt");
	if (receiptValue !== null) return parsePortfolioMediaReceipt(receiptValue, plan);

	const checkpointValue = await readOptionalPrivate(
		paths.checkpoint,
		"Portfolio media asset checkpoint",
	);
	let checkpoint = checkpointValue ? parsePortfolioMediaCheckpoint(checkpointValue, plan) : null;
	let sourceBytes: Uint8Array | undefined;
	if (!checkpoint) {
		const source = await sourceForCheckpoint(paths, asset, null);
		sourceBytes = source.bytes;
		checkpoint = createPortfolioMediaCheckpoint(plan, asset, source.transfer);
		await atomicWritePrivateJson(paths.checkpoint, checkpoint);
	}

	while (checkpoint.phase === "source-validated" || checkpoint.phase === "put-attempted") {
		if (checkpoint.phase === "source-validated") {
			const source = sourceBytes
				? { bytes: sourceBytes, transfer: checkpoint.transfer }
				: await sourceForCheckpoint(paths, asset, checkpoint);
			sourceBytes = source.bytes;
			const capability = await issueCapability(authentication, asset, checkpoint.transfer);
			checkpoint = checkpointPortfolioMediaPutAttempted(
				plan,
				asset,
				checkpoint,
				capability.assetId,
			);
			await atomicWritePrivateJson(paths.checkpoint, checkpoint);
			await attemptUpload(capability, sourceBytes);
		}
		const processed = await processAsset(authentication, asset, checkpoint);
		if (processed === "source-missing") {
			checkpoint = checkpointPortfolioMediaConfirmedMissing(plan, asset, checkpoint);
			await atomicWritePrivateJson(paths.checkpoint, checkpoint);
			continue;
		}
		checkpoint = checkpointPortfolioMediaRegistered(plan, asset, checkpoint, processed);
		await atomicWritePrivateJson(paths.checkpoint, checkpoint);
	}

	if (checkpoint.phase === "registered") {
		if (!checkpoint.workerAssetId || !checkpoint.target) {
			throw new Error("Portfolio registered media checkpoint is incomplete");
		}
		const [card, display2048] = await Promise.all([
			inspectPublicDerivative(asset, checkpoint.workerAssetId, "card"),
			inspectPublicDerivative(asset, checkpoint.workerAssetId, "display2048"),
		]);
		checkpoint = checkpointPortfolioPublicDerivativesVerified(plan, asset, checkpoint, {
			card,
			display2048,
		});
		await atomicWritePrivateJson(paths.checkpoint, checkpoint);
	}

	await readStoredSource(paths.source, asset, checkpoint.transfer);
	const receipt = createPortfolioMediaReceipt(plan, asset, checkpoint);
	await publishOrVerifyPrivateJson(
		paths.receipt,
		receipt,
		"Portfolio media asset receipt",
		(value) => parsePortfolioMediaReceipt(value, plan),
	);
	await Promise.all([rm(paths.source, { force: true }), rm(paths.checkpoint, { force: true })]);
	await syncDirectory(dirname(paths.receipt));
	return receipt;
}

async function boundedTransfer(
	assets: readonly PortfolioMediaPlanAsset[],
	execute: (asset: PortfolioMediaPlanAsset) => Promise<void>,
) {
	let next = 0;
	let firstError: unknown;
	await Promise.all(
		Array.from({ length: PORTFOLIO_MEDIA_CONCURRENCY }, async () => {
			while (firstError === undefined) {
				const index = next;
				next += 1;
				const asset = assets[index];
				if (!asset) return;
				try {
					await execute(asset);
				} catch (error) {
					firstError = error;
				}
			}
		}),
	);
	if (firstError !== undefined) throw firstError;
}

async function runPlan(options: Extract<Options, { mode: "plan" }>) {
	const plan = createPortfolioMediaTransferPlan(
		await loadInventory(options.inventoryDirectory),
		await loadPreservedTargetEvidence(options.preservedTargetDirectory),
	);
	let planPath: string | undefined;
	if (options.stateDirectory) {
		const stateDirectory = await assertPrivateDirectory(
			options.stateDirectory,
			"Portfolio media state directory",
		);
		planPath = await writeOrVerifyPlan(stateDirectory, plan);
	}
	console.log(
		`${PORTFOLIO_MEDIA_OPERATION} plan-only: ${plan.source.galleryCount} galleries, ${plan.source.assetCount} exact transformed sources, GIF canary first; no provider request or content mutation occurred.`,
	);
	console.log(`Plan digest: ${plan.planDigest}`);
	if (planPath) console.log(`Prepared owner-private plan: ${planPath}`);
	console.log(
		`Execution requires --execute, --inventory-dir, --preserved-target-dir, --state-dir, and --confirm "${PORTFOLIO_MEDIA_CONFIRMATION}".`,
	);
}

async function runExecution(options: Extract<Options, { mode: "execute" }>) {
	const [inventoryFiles, preservedTargetFiles] = await Promise.all([
		loadInventory(options.inventoryDirectory),
		loadPreservedTargetEvidence(options.preservedTargetDirectory),
	]);
	const plan = createPortfolioMediaTransferPlan(inventoryFiles, preservedTargetFiles);
	const stateDirectory = await assertPrivateDirectory(
		options.stateDirectory,
		"Portfolio media state directory",
	);
	await writeOrVerifyPlan(stateDirectory, plan);
	const assetStateDirectory = await ensurePrivateChildDirectory(
		stateDirectory,
		ASSET_STATE_DIRECTORY,
	);
	const receiptSetPath = resolve(stateDirectory, RECEIPT_SET_FILENAME);
	const releaseLock = await acquireLock(stateDirectory);
	try {
		const existing = await readOptionalPrivate(receiptSetPath, "Portfolio media receipt set");
		if (existing !== null) {
			const receiptSet = parsePortfolioMediaReceiptSet(existing, plan);
			const migration = await materializeMigrationPlan({
				stateDirectory,
				files: inventoryFiles,
				preservedTargetFiles,
				transferPlan: plan,
				receiptSet,
			});
			console.log(`Portfolio media transfer identical-replay: ${receiptSetPath}`);
			console.log(`Receipt-set digest: ${receiptSet.receiptSetDigest}`);
			console.log(`Migration plan digest: ${migration.digest}`);
			return;
		}

		const authentication = new OwnerAuthentication(options.cookieFile);
		const byRef = new Map(plan.assets.map((asset) => [asset.sourceAsset.id, asset]));
		const canary = byRef.get(PORTFOLIO_MEDIA_CANARY_REF);
		if (!canary) throw new Error("Portfolio GIF canary is absent from the sealed plan");
		await executeOneAsset({
			plan,
			asset: canary,
			stateDirectory: assetStateDirectory,
			authentication,
		});
		console.log("Portfolio GIF canary passed; starting the bounded remaining batch.");

		const remaining = plan.transferOrder
			.slice(1)
			.map((sourceAssetRef) => byRef.get(sourceAssetRef))
			.filter((asset): asset is PortfolioMediaPlanAsset => asset !== undefined);
		if (remaining.length !== 293)
			throw new Error("Portfolio remaining transfer order is incomplete");
		let completed = 1;
		await boundedTransfer(remaining, async (asset) => {
			await executeOneAsset({
				plan,
				asset,
				stateDirectory: assetStateDirectory,
				authentication,
			});
			completed += 1;
			if (completed % 25 === 0 || completed === 294) {
				console.log(`Portfolio media progress: ${completed}/294`);
			}
		});

		const receipts = await Promise.all(
			plan.assets.map(async (asset) => {
				const value = await readOptionalPrivate(
					assetStatePaths(assetStateDirectory, asset).receipt,
					"Portfolio media asset receipt",
				);
				if (value === null) throw new Error("Portfolio media receipt set is incomplete");
				return parsePortfolioMediaReceipt(value, plan);
			}),
		);
		const receiptSet = createPortfolioMediaReceiptSet(plan, receipts);
		await publishOrVerifyPrivateJson(
			receiptSetPath,
			receiptSet,
			"Portfolio media receipt set",
			(value) => parsePortfolioMediaReceiptSet(value, plan),
		);
		const migration = await materializeMigrationPlan({
			stateDirectory,
			files: inventoryFiles,
			preservedTargetFiles,
			transferPlan: plan,
			receiptSet,
		});
		console.log(`Portfolio media transfer complete: ${receiptSetPath}`);
		console.log(`Receipt-set digest: ${receiptSet.receiptSetDigest}`);
		console.log(`Portfolio migration plan: ${migration.path}`);
		console.log(`Migration plan digest: ${migration.digest}`);
	} finally {
		await releaseLock();
	}
}

async function main() {
	const options = parseOptions(process.argv.slice(2));
	if (options.mode === "plan") {
		await runPlan(options);
		return;
	}
	await runExecution(options);
}

void main().catch((error) => {
	console.error(error instanceof Error ? error.message : `${PORTFOLIO_MEDIA_OPERATION} failed`);
	process.exitCode = 1;
});
