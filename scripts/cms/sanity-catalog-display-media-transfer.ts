import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createClient } from "@sanity/client";
import sharp from "sharp";
import {
	createSanityCatalogImportDryRunReport,
	createSanityCatalogImportManifest,
} from "../../packages/crm-api/convex/helpers/sanityCatalogImport";
import { checkAngelsRestCatalogBaseline } from "./migrations/angelsrest-catalog/catalogBaseline";
import { sanityImageSourceUrl } from "./sanityBlogImportPrep";
import {
	createCmsMediaProcessRequest,
	createCmsMediaUploadRequest,
	deterministicSanitySourceFilename,
	parseCmsMediaProcessResult,
	validateSanityImageSourceAgainstExpectation,
} from "./sanityBlogMediaTransfer";
import {
	ANGELS_REST_BLOG_MEDIA_EXPECTATIONS,
	assertSafeConvexProductionEnvFile,
	type BlogMediaSource,
	parseConvexImportTargetProjections,
	parseSanityBlogImageAssetJournal,
	probeSanityBlogMediaDerivatives,
	type SanityBlogMediaTransferReceipts,
	sanitizedConvexCliEnvironment,
	verifySanityBlogMediaTargets,
} from "./sanityBlogMediaVerification";
import { fetchPublishedSanityCatalogSource } from "./sanityCatalogSource";
import { readSanitySourceConfig } from "./sanitySourceConfig";

const execFileAsync = promisify(execFile);
const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const MIGRATION_DIRECTORY = resolve(REPOSITORY_ROOT, "scripts/cms/migrations/angelsrest-catalog");
const IMAGE_ASSET_MAP_PATH = resolve(MIGRATION_DIRECTORY, "sanity-catalog-image-asset-map.json");
const TRANSFER_RECEIPTS_PATH = resolve(
	MIGRATION_DIRECTORY,
	"sanity-catalog-display-media-transfer-receipts.json",
);
const CONVEX_ENV_FILE_PATH = resolve(REPOSITORY_ROOT, ".env.local");
const REPORT_PATH = "/tmp/angelsrest-sanity-catalog-display-media-transfer.json";
const PRODUCTION_ORIGIN = "https://www.angelsrest.online";
const CMS_MEDIA_WORKER_ORIGIN = "https://cms-media-worker.thinkingofview.workers.dev";
const CMS_MEDIA_CAPABILITY_PATH = "/api/admin/media/capability";
const CMS_MEDIA_UPLOAD_PATH = "/v1/uploads/source";
const SOURCE_TIMEOUT_MS = 30_000;
const CMS_WEB_UPLOAD_MAX_BYTES = 20_000_000;
const CATALOG_DISPLAY_SOURCE_MAX_WIDTH = 4096;
const VERIFY_BATCH_SIZE = 21;
const CONFIRMATION = "transfer CMS-5.3c 33 catalog display images to www.angelsrest.online";
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

type Options =
	| { mode: "plan" }
	| { mode: "execute"; cookieFile: string; sourceRefs?: readonly string[] };

function sha256(value: string | Uint8Array) {
	return createHash("sha256").update(value).digest("hex");
}

function serializeJson(value: unknown) {
	return `${JSON.stringify(value, null, "\t")}\n`;
}

function sorted(values: readonly string[]) {
	return [...values].sort((left, right) => left.localeCompare(right));
}

function sortedRecord<T>(entries: Iterable<readonly [string, T]>) {
	return Object.fromEntries(
		[...entries].sort(([left], [right]) => left.localeCompare(right)),
	) as Record<string, T>;
}

async function writePrivateJson(path: string, value: unknown) {
	await rm(path, { force: true });
	await writeFile(path, serializeJson(value), { flag: "wx", mode: 0o600 });
}

async function readOptionalJson(path: string) {
	try {
		return JSON.parse(await readFile(path, "utf8")) as unknown;
	} catch (error) {
		if (error && typeof error === "object" && "code" in error && error.code === "ENOENT")
			return null;
		throw error;
	}
}

async function assertRegularFile(path: string, label: string) {
	const stats = await lstat(path);
	if (!stats.isFile() || stats.isSymbolicLink()) throw new Error(`${label} must be a regular file`);
	if ((stats.mode & 0o077) !== 0) throw new Error(`${label} must be readable only by the owner`);
}

function parseOptions(args: readonly string[]): Options {
	let execute = false;
	let confirmation: string | undefined;
	let cookieFile: string | undefined;
	const sourceRefs: string[] = [];
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === "--") continue;
		if (arg === "--execute") {
			if (execute) throw new Error("--execute may only be supplied once");
			execute = true;
			continue;
		}
		if (arg === "--confirm" || arg === "--cookie-file" || arg === "--source-ref") {
			const value = args[index + 1];
			if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value`);
			if (arg === "--confirm") confirmation = value;
			if (arg === "--cookie-file") cookieFile = value;
			if (arg === "--source-ref") sourceRefs.push(value);
			index += 1;
			continue;
		}
		throw new Error(`Unsupported argument: ${arg}`);
	}
	if (!execute) {
		if (confirmation || cookieFile || sourceRefs.length > 0) {
			throw new Error("Execution options require --execute");
		}
		return { mode: "plan" };
	}
	if (confirmation !== CONFIRMATION)
		throw new Error(`--confirm must exactly equal "${CONFIRMATION}"`);
	if (!cookieFile || cookieFile !== cookieFile.trim())
		throw new Error("--cookie-file requires one path");
	if (new Set(sourceRefs).size !== sourceRefs.length)
		throw new Error("--source-ref values must be unique");
	return { mode: "execute", cookieFile, sourceRefs: sourceRefs.length ? sourceRefs : undefined };
}

async function publishedCatalogRefs() {
	const { projectId, dataset } = await readSanitySourceConfig(REPOSITORY_ROOT);
	if (
		projectId !== ANGELS_REST_BLOG_MEDIA_EXPECTATIONS.projectId ||
		dataset !== ANGELS_REST_BLOG_MEDIA_EXPECTATIONS.dataset
	)
		throw new Error("Configured Sanity source does not match Angels Rest production");
	const client = createClient({ projectId, dataset, apiVersion: "2024-01-01", useCdn: false });
	const source = await fetchPublishedSanityCatalogSource(client);
	const manifest = createSanityCatalogImportManifest(source);
	const report = createSanityCatalogImportDryRunReport(manifest);
	const baseline = checkAngelsRestCatalogBaseline(report);
	if (baseline.status !== "matched" || report.draftImport.status === "blocked") {
		throw new Error("Published Sanity catalog is not ready for display-media transfer");
	}
	if (report.requiredSourceImageRefs.length !== 33) {
		throw new Error("Published Sanity catalog display-image count changed from 33");
	}
	return { sourceRefs: sorted(report.requiredSourceImageRefs), report, baseline };
}

function initialJournal(sourceRefs: readonly string[]) {
	return parseSanityBlogImageAssetJournal(
		Object.fromEntries(sourceRefs.map((sourceRef) => [sourceRef, ""])),
	);
}

function initialReceipts(): SanityBlogMediaTransferReceipts {
	return {
		schemaVersion: 2,
		siteUrl: ANGELS_REST_BLOG_MEDIA_EXPECTATIONS.siteUrl,
		sanity: {
			projectId: ANGELS_REST_BLOG_MEDIA_EXPECTATIONS.projectId,
			dataset: ANGELS_REST_BLOG_MEDIA_EXPECTATIONS.dataset,
		},
		receipts: {},
	};
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error(`${label} must be an object`);
	}
	return value as Record<string, unknown>;
}

function stringValue(value: unknown, label: string) {
	if (typeof value !== "string" || !value || value !== value.trim()) {
		throw new Error(`${label} must be a non-empty trimmed string`);
	}
	return value;
}

function positiveInteger(value: unknown, label: string) {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
		throw new Error(`${label} must be a positive integer`);
	}
	return value;
}

function parseCatalogDisplaySource(value: unknown, sourceAssetRef: string): BlogMediaSource {
	const source = objectValue(value, `receipt ${sourceAssetRef}.source`);
	const contentType = source.contentType;
	if (contentType !== "image/jpeg" && contentType !== "image/png" && contentType !== "image/webp")
		throw new Error(`receipt ${sourceAssetRef}.source.contentType is invalid`);
	const parsedRef = sourceRefParts(sourceAssetRef);
	const parsed = {
		contentType,
		sizeBytes: positiveInteger(source.sizeBytes, `receipt ${sourceAssetRef}.source.sizeBytes`),
		width: positiveInteger(source.width, `receipt ${sourceAssetRef}.source.width`),
		height: positiveInteger(source.height, `receipt ${sourceAssetRef}.source.height`),
	};
	if (parsed.width > parsedRef.width || parsed.height > parsedRef.height) {
		throw new Error(`Receipt source dimensions exceed ${sourceAssetRef}`);
	}
	if (
		parsed.contentType !== parsedRef.contentType &&
		(parsed.contentType !== "image/jpeg" || parsed.width > CATALOG_DISPLAY_SOURCE_MAX_WIDTH)
	) {
		throw new Error(`Receipt source metadata does not match ${sourceAssetRef}`);
	}
	return parsed;
}

function parseCatalogDisplayMediaTransferReceipts(value: unknown): SanityBlogMediaTransferReceipts {
	const root = objectValue(value, "Catalog display-media transfer receipts");
	if (root.schemaVersion !== 2) throw new Error("Unsupported transfer receipt schemaVersion");
	const sanity = objectValue(root.sanity, "receipts.sanity");
	const receiptValues = objectValue(root.receipts, "receipts.receipts");
	const receipts: SanityBlogMediaTransferReceipts["receipts"] = {};
	const mediaAssetIds = new Set<string>();
	const workerAssetIds = new Set<string>();
	for (const [sourceAssetRef, rawReceipt] of Object.entries(receiptValues).sort(([a], [b]) =>
		a.localeCompare(b),
	)) {
		sourceRefParts(sourceAssetRef);
		const receipt = objectValue(rawReceipt, `receipt ${sourceAssetRef}`);
		const mediaAssetId = stringValue(receipt.mediaAssetId, "receipt.mediaAssetId");
		if (!/^[a-z0-9]{20,64}$/.test(mediaAssetId)) throw new Error("Receipt has invalid Convex ID");
		const workerAssetId = stringValue(receipt.workerAssetId, "receipt.workerAssetId");
		if (!UUID_V4_PATTERN.test(workerAssetId)) throw new Error("Receipt has invalid Worker UUID v4");
		const sourceSha256 = stringValue(receipt.sourceSha256, "receipt.sourceSha256");
		if (!/^[0-9a-f]{64}$/.test(sourceSha256)) throw new Error("Receipt has invalid source SHA-256");
		if (mediaAssetIds.has(mediaAssetId)) throw new Error("Transfer receipts duplicate a Convex ID");
		if (workerAssetIds.has(workerAssetId))
			throw new Error("Transfer receipts duplicate a Worker UUID");
		mediaAssetIds.add(mediaAssetId);
		workerAssetIds.add(workerAssetId);
		receipts[sourceAssetRef] = {
			mediaAssetId,
			workerAssetId,
			sourceSha256,
			source: parseCatalogDisplaySource(receipt.source, sourceAssetRef),
		};
	}
	return {
		schemaVersion: 2,
		siteUrl: stringValue(root.siteUrl, "receipts.siteUrl"),
		sanity: {
			projectId: stringValue(sanity.projectId, "receipts.sanity.projectId"),
			dataset: stringValue(sanity.dataset, "receipts.sanity.dataset"),
		},
		receipts,
	};
}

async function readJournals(sourceRefs: readonly string[]) {
	const [rawJournal, rawReceipts] = await Promise.all([
		readOptionalJson(IMAGE_ASSET_MAP_PATH),
		readOptionalJson(TRANSFER_RECEIPTS_PATH),
	]);
	const journal =
		rawJournal === null ? initialJournal(sourceRefs) : parseSanityBlogImageAssetJournal(rawJournal);
	const receiptFile =
		rawReceipts === null
			? initialReceipts()
			: parseCatalogDisplayMediaTransferReceipts(rawReceipts);
	if (JSON.stringify(Object.keys(journal).sort()) !== JSON.stringify(sorted(sourceRefs))) {
		throw new Error("Catalog display-media journal does not match the published source set");
	}
	return { journal, receiptFile };
}

async function loadAdminCookie(cookieFile: string) {
	await assertRegularFile(cookieFile, "Admin cookie file");
	const cookie = (await readFile(cookieFile, "utf8")).trim();
	if (!cookie || /[\r\n]/.test(cookie)) throw new Error("Admin cookie file must contain one line");
	return cookie;
}

function sourceRefParts(sourceAssetRef: string) {
	const match = /^image-[0-9a-f]{40}-([1-9]\d*)x([1-9]\d*)-(jpg|png|webp)$/.exec(sourceAssetRef);
	if (!match) throw new Error(`Invalid Sanity image reference: ${sourceAssetRef}`);
	return {
		width: Number(match[1]),
		height: Number(match[2]),
		extension: match[3],
		contentType: (match[3] === "jpg" ? "image/jpeg" : `image/${match[3]}`) as
			| "image/jpeg"
			| "image/png"
			| "image/webp",
	};
}

async function readBoundedBody(response: Response, maxBytes: number) {
	const declaredLength = response.headers.get("content-length");
	if (declaredLength && /^\d+$/.test(declaredLength) && Number(declaredLength) > maxBytes) {
		throw new Error("Sanity source exceeds the CMS upload limit");
	}
	const body = await response.bytes();
	if (body.byteLength > maxBytes) throw new Error("Sanity source exceeds the CMS upload limit");
	return new Uint8Array(body);
}

function catalogDisplayDerivativeUrl(sourceUrl: string) {
	const url = new URL(sourceUrl);
	url.searchParams.set("w", String(CATALOG_DISPLAY_SOURCE_MAX_WIDTH));
	url.searchParams.set("fit", "max");
	url.searchParams.set("fm", "jpg");
	url.searchParams.set("q", "92");
	return url.toString();
}

async function fetchSanitySource(sourceAssetRef: string, sourceUrl: string, contentType: string) {
	const response = await fetch(sourceUrl, {
		redirect: "error",
		signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS),
	});
	if (!response.ok || response.url !== sourceUrl) {
		throw new Error(`Sanity source download boundary is invalid for ${sourceAssetRef}`);
	}
	const responseContentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim();
	if (responseContentType !== contentType) {
		throw new Error(`Sanity source content type is invalid for ${sourceAssetRef}`);
	}
	return response;
}

async function downloadAndValidateSource(sourceAssetRef: string) {
	const sourceUrl = sanityImageSourceUrl(
		ANGELS_REST_BLOG_MEDIA_EXPECTATIONS.projectId,
		ANGELS_REST_BLOG_MEDIA_EXPECTATIONS.dataset,
		sourceAssetRef,
	);
	if (!sourceUrl) throw new Error("Sanity source URL could not be constructed");
	const { contentType, width, height } = sourceRefParts(sourceAssetRef);
	const original = await fetchSanitySource(sourceAssetRef, sourceUrl, contentType);
	const declaredLength = original.headers.get("content-length");
	const useDisplayDerivative =
		width > CATALOG_DISPLAY_SOURCE_MAX_WIDTH ||
		(declaredLength &&
			/^\d+$/.test(declaredLength) &&
			Number(declaredLength) > CMS_WEB_UPLOAD_MAX_BYTES);
	const response = useDisplayDerivative
		? await fetchSanitySource(sourceAssetRef, catalogDisplayDerivativeUrl(sourceUrl), "image/jpeg")
		: original;
	const bytes = await readBoundedBody(response, CMS_WEB_UPLOAD_MAX_BYTES);
	const metadata = await sharp(bytes, { failOn: "error" }).metadata();
	const sourceContentType = useDisplayDerivative ? "image/jpeg" : contentType;
	const expectedFormat =
		sourceContentType === "image/jpeg" ? "jpeg" : sourceContentType.slice("image/".length);
	if (
		metadata.format !== expectedFormat ||
		(metadata.width ?? 0) <= 0 ||
		(metadata.height ?? 0) <= 0 ||
		(useDisplayDerivative &&
			((metadata.width ?? 0) > Math.min(width, CATALOG_DISPLAY_SOURCE_MAX_WIDTH) ||
				(metadata.height ?? 0) > height))
	) {
		throw new Error(
			`Sanity display source decoded image metadata is invalid for ${sourceAssetRef}`,
		);
	}
	const expected = {
		contentType: sourceContentType,
		sizeBytes: bytes.byteLength,
		width: metadata.width ?? 0,
		height: metadata.height ?? 0,
		sourceSha256: sha256(bytes),
	};
	if (useDisplayDerivative) {
		return {
			bytes,
			validated: {
				sourceAssetRef,
				sourceSha256: expected.sourceSha256,
				source: expected,
			},
		};
	}
	return {
		bytes,
		validated: validateSanityImageSourceAgainstExpectation({
			sourceAssetRef,
			bytes,
			decoded: metadata,
			expected,
		}),
	};
}

function capabilityRequest(adminCookie: string, sourceAssetRef: string, source: BlogMediaSource) {
	return {
		url: `${PRODUCTION_ORIGIN}${CMS_MEDIA_CAPABILITY_PATH}`,
		init: {
			method: "POST",
			redirect: "error" as const,
			headers: { "Content-Type": "application/json", Cookie: adminCookie },
			body: JSON.stringify({
				filename: deterministicSanitySourceFilename(sourceAssetRef),
				contentType: source.contentType,
				sizeBytes: source.sizeBytes,
			}),
		},
	};
}

function sourceExtensionForContentType(contentType: BlogMediaSource["contentType"]) {
	if (contentType === "image/jpeg") return "jpg";
	if (contentType === "image/png") return "png";
	return "webp";
}

function parseCmsMediaCapabilityForCatalogDisplay(
	value: unknown,
	input: { sourceAssetRef: string; source: BlogMediaSource },
) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error("CMS media capability must be an object");
	}
	const capability = value as Record<string, unknown>;
	const assetId = typeof capability.assetId === "string" ? capability.assetId : "";
	const privateObjectKey =
		typeof capability.privateObjectKey === "string" ? capability.privateObjectKey : "";
	const uploadUrlString = typeof capability.uploadUrl === "string" ? capability.uploadUrl : "";
	const uploadToken = typeof capability.uploadToken === "string" ? capability.uploadToken : "";
	const expiresAt = typeof capability.expiresAt === "string" ? capability.expiresAt : "";
	if (!UUID_V4_PATTERN.test(assetId) || !uploadToken || /[\r\n]/.test(uploadToken) || !expiresAt) {
		throw new Error(`CMS media capability identity is invalid for ${input.sourceAssetRef}`);
	}
	const expectedKey = `sites/${ANGELS_REST_BLOG_MEDIA_EXPECTATIONS.siteUrl}/web/${assetId}/source.${sourceExtensionForContentType(
		input.source.contentType,
	)}`;
	if (privateObjectKey !== expectedKey) {
		throw new Error(
			`CMS media capability private object identity is invalid for ${input.sourceAssetRef}`,
		);
	}
	let uploadUrl: URL;
	try {
		uploadUrl = new URL(uploadUrlString);
	} catch {
		throw new Error(`CMS media capability upload URL is invalid for ${input.sourceAssetRef}`);
	}
	const queryEntries = [...uploadUrl.searchParams.entries()];
	if (
		uploadUrl.origin !== CMS_MEDIA_WORKER_ORIGIN ||
		uploadUrl.pathname !== CMS_MEDIA_UPLOAD_PATH ||
		uploadUrl.username ||
		uploadUrl.password ||
		uploadUrl.hash ||
		queryEntries.length !== 1 ||
		queryEntries[0]?.[0] !== "key" ||
		queryEntries[0]?.[1] !== privateObjectKey
	) {
		throw new Error(`CMS media capability upload boundary is invalid for ${input.sourceAssetRef}`);
	}
	return { assetId, privateObjectKey, uploadUrl: uploadUrl.toString(), uploadToken, expiresAt };
}

async function readJson(response: Response) {
	try {
		return (await response.json()) as unknown;
	} catch {
		throw new Error("CMS media boundary returned invalid JSON");
	}
}

async function transferOne(sourceAssetRef: string, adminCookie: string) {
	const { bytes, validated } = await downloadAndValidateSource(sourceAssetRef);
	const capRequest = capabilityRequest(adminCookie, sourceAssetRef, validated.source);
	const capResponse = await fetch(capRequest.url, capRequest.init);
	if (!capResponse.ok) {
		throw new Error(
			`CMS media capability request rejected ${sourceAssetRef} with ${capResponse.status}: ${(
				await capResponse.text()
			).trim()}`,
		);
	}
	const capability = parseCmsMediaCapabilityForCatalogDisplay(await readJson(capResponse), {
		sourceAssetRef,
		source: validated.source,
	});
	const uploadRequest = createCmsMediaUploadRequest(
		capability,
		bytes,
		validated.source.contentType,
	);
	const uploadResponse = await fetch(uploadRequest.url, uploadRequest.init);
	if (!uploadResponse.ok && uploadResponse.status !== 409) {
		throw new Error(`CMS media upload rejected ${sourceAssetRef} with ${uploadResponse.status}`);
	}
	const processRequest = createCmsMediaProcessRequest(adminCookie, capability.privateObjectKey);
	let processed: unknown;
	const processStatuses: Array<{ attempt: number; status: number; body: string }> = [];
	for (let attempt = 1; attempt <= 3; attempt += 1) {
		const processResponse = await fetch(processRequest.url, processRequest.init);
		if (processResponse.ok) {
			processed = await readJson(processResponse);
			break;
		}
		const body = (await processResponse.text()).trim();
		processStatuses.push({ attempt, status: processResponse.status, body });
		if (processResponse.status !== 409 && processResponse.status < 500) {
			throw new Error(
				`CMS media processing rejected ${sourceAssetRef} with ${processResponse.status}: ${body}`,
			);
		}
		await new Promise((resolve) => setTimeout(resolve, attempt * 750));
	}
	if (!processed) {
		throw new Error(
			`CMS media processing did not settle for ${sourceAssetRef}: ${JSON.stringify(
				processStatuses,
			)}`,
		);
	}
	const registered = parseCmsMediaProcessResult(processed, {
		sourceAssetRef: sourceAssetRef as never,
		workerAssetId: capability.assetId,
		source: validated.source,
	});
	return { registered, sourceSha256: validated.sourceSha256 };
}

function createCandidateCatalogDisplayMediaJournals({
	journal,
	receiptFile,
	sourceAssetRef,
	registered,
	sourceSha256,
}: {
	journal: Readonly<Record<string, string>>;
	receiptFile: SanityBlogMediaTransferReceipts;
	sourceAssetRef: string;
	registered: { mediaAssetId: string; workerAssetId: string; source: BlogMediaSource };
	sourceSha256: string;
}) {
	if (journal[sourceAssetRef] || receiptFile.receipts[sourceAssetRef]) {
		throw new Error("Candidate source is already mapped");
	}
	if (!/^[0-9a-f]{64}$/.test(sourceSha256)) throw new Error("Candidate source SHA-256 is invalid");
	const nextJournal = parseSanityBlogImageAssetJournal(
		sortedRecord([...Object.entries(journal), [sourceAssetRef, registered.mediaAssetId]]),
	);
	const nextReceiptFile = parseCatalogDisplayMediaTransferReceipts({
		...receiptFile,
		receipts: sortedRecord([
			...Object.entries(receiptFile.receipts),
			[
				sourceAssetRef,
				{
					mediaAssetId: registered.mediaAssetId,
					workerAssetId: registered.workerAssetId,
					sourceSha256,
					source: registered.source,
				},
			] as const,
		]),
	});
	return { journal: nextJournal, receiptFile: nextReceiptFile };
}

async function verifyTargets(
	sourceRefs: readonly string[],
	journal: Record<string, string>,
	receiptFile: SanityBlogMediaTransferReceipts,
) {
	const ids = Object.values(journal).filter(Boolean);
	const convexTargets = [];
	if (ids.length > 0) {
		assertSafeConvexProductionEnvFile(await readFile(CONVEX_ENV_FILE_PATH, "utf8"));
		const convexCli = resolve(REPOSITORY_ROOT, "node_modules/convex/bin/main.js");
		for (let index = 0; index < ids.length; index += VERIFY_BATCH_SIZE) {
			const { stdout, stderr } = await execFileAsync(
				process.execPath,
				[
					convexCli,
					"run",
					"mediaAssets:verifyImportTargets",
					JSON.stringify({
						expectedSiteUrl: ANGELS_REST_BLOG_MEDIA_EXPECTATIONS.siteUrl,
						ids: ids.slice(index, index + VERIFY_BATCH_SIZE),
					}),
					"--prod",
					"--env-file",
					CONVEX_ENV_FILE_PATH,
					"--codegen",
					"disable",
					"--typecheck",
					"disable",
				],
				{
					cwd: REPOSITORY_ROOT,
					env: sanitizedConvexCliEnvironment(process.env),
					maxBuffer: 4 * 1024 * 1024,
					windowsHide: true,
				},
			);
			if (stderr.trim()) throw new Error("Convex CLI reported an unexpected warning");
			convexTargets.push(...parseConvexImportTargetProjections(JSON.parse(stdout) as unknown));
		}
	}
	const registry = verifySanityBlogMediaTargets({
		sourceAssetRefs: sourceRefs,
		journal,
		receiptFile,
		convexTargets,
	});
	return await probeSanityBlogMediaDerivatives(registry, {
		fetcher: fetch,
		mediaBaseUrl: ANGELS_REST_BLOG_MEDIA_EXPECTATIONS.mediaBaseUrl,
	});
}

async function main() {
	const options = parseOptions(process.argv.slice(2));
	const { sourceRefs, report, baseline } = await publishedCatalogRefs();
	const selectedRefs =
		options.mode === "execute" && options.sourceRefs ? sorted(options.sourceRefs) : sourceRefs;
	if (selectedRefs.some((sourceRef) => !sourceRefs.includes(sourceRef))) {
		throw new Error("Execution source references must belong to the published catalog set");
	}
	let { journal, receiptFile } = await readJournals(sourceRefs);
	if (options.mode === "plan") {
		const verification = await verifyTargets(sourceRefs, journal, receiptFile);
		await writePrivateJson(REPORT_PATH, {
			status: verification.status === "blocked" ? "blocked" : "ready",
			mode: "plan",
			counts: {
				products: report.counts.products,
				mediaPlacements: report.counts.mediaPlacements,
				sourceAssets: sourceRefs.length,
				mappedAssets: verification.counts.mappedAssets,
				unmappedAssets: verification.counts.unmappedAssets,
				issues: verification.counts.issues,
			},
			baseline,
			verification,
		});
		console.log(
			`Catalog display-media plan: ${verification.counts.mappedAssets}/${sourceRefs.length} mapped; report ${REPORT_PATH}`,
		);
		return;
	}

	const adminCookie = await loadAdminCookie(options.cookieFile);
	for (const sourceAssetRef of selectedRefs) {
		if (journal[sourceAssetRef]) {
			console.log(`${sourceAssetRef}: already mapped`);
			continue;
		}
		const { registered, sourceSha256 } = await transferOne(sourceAssetRef, adminCookie);
		const next = createCandidateCatalogDisplayMediaJournals({
			journal,
			receiptFile,
			sourceAssetRef,
			registered,
			sourceSha256,
		});
		journal = next.journal;
		receiptFile = next.receiptFile;
		await writePrivateJson(TRANSFER_RECEIPTS_PATH, receiptFile);
		await writePrivateJson(IMAGE_ASSET_MAP_PATH, journal);
		console.log(`${sourceAssetRef}: mapped ${registered.mediaAssetId}`);
	}
	const verification = await verifyTargets(sourceRefs, journal, receiptFile);
	await writePrivateJson(REPORT_PATH, {
		status: verification.status,
		mode: "execute",
		counts: verification.counts,
		verification,
	});
	if (verification.status !== "registry-verified-complete") {
		throw new Error("Catalog display-media transfer did not reach complete verified state");
	}
	console.log(`Catalog display-media transfer verified: ${sourceRefs.length}/${sourceRefs.length}`);
}

void main().catch(async (error) => {
	try {
		await writePrivateJson(REPORT_PATH, {
			status: "blocked",
			issues: [
				{
					code: "catalog-display-media-transfer-failed",
					message: error instanceof Error ? error.message : String(error),
				},
			],
		});
	} catch {
		// Preserve the primary failure.
	}
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
});
