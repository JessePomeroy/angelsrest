import { lstat, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createClient } from "@sanity/client";
import { parse as parseDotenv } from "dotenv";
import sharp from "sharp";
import type {
	CatalogPrivateAssetFacts,
	CatalogPrivateInspectionReceiptSet,
} from "../../packages/crm-api/convex/helpers/catalogPrivateAssetReceiptContract";
import {
	createCatalogPrivateAssetReceiptSetId,
	validateCatalogPrivateInspectionReceiptSet,
} from "../../packages/crm-api/convex/helpers/catalogPrivateAssetReceiptValidation";
import {
	createSanityCatalogImportDryRunReport,
	createSanityCatalogImportManifest,
} from "../../packages/crm-api/convex/helpers/sanityCatalogImport";
import { inspectCatalogPrivateZip } from "./catalogPrivateZipInspection";
import { checkAngelsRestCatalogBaseline } from "./migrations/angelsrest-catalog/catalogBaseline";
import { sanityImageSourceUrl } from "./sanityBlogImportPrep";
import {
	ANGELS_REST_CATALOG_SITE_URL,
	type CatalogPrivateAssetByteEvidence,
	createSanityCatalogPrivateAssetReceiptSet,
} from "./sanityCatalogPrivateAssetReceipts";
import {
	submitCatalogPrivateInspectionReceipt,
	submitCatalogPrivateStorageReceipt,
	transferCatalogPrivateAsset,
} from "./sanityCatalogPrivateAssetTransfer";
import { fetchPublishedSanityCatalogSource } from "./sanityCatalogSource";
import { readSanitySourceConfig } from "./sanitySourceConfig";

const CONFIRMATION = "transfer all 12 private catalog assets for angelsrest.online";
const REPORT_PATH = "/tmp/angelsrest-private-catalog-transfer-report.json";
const EXPECTED_PRINT_SOURCE_COUNT = 11;
const EXPECTED_PAID_FILE_COUNT = 1;
const DIRECT_UPLOAD_MAX_BYTES = 100_000_000;
const SOURCE_TIMEOUT_MS = 120_000;

type CliOptions = {
	execute: boolean;
	confirmation?: string;
	workerSecretFile?: string;
	inspectionSecretFile?: string;
};

type DownloadedAsset = {
	kind: "print_source" | "paid_digital_file";
	sourceAssetRef: string;
	bytes: Uint8Array;
	observedMimeType: "image/jpeg" | "image/png" | "application/zip";
	widthPixels?: number;
	heightPixels?: number;
	zipInspection?: ReturnType<typeof inspectCatalogPrivateZip>;
};

function parseOptions(args: string[]): CliOptions {
	const options: CliOptions = { execute: false };
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === "--") continue;
		if (arg === "--execute") {
			options.execute = true;
			continue;
		}
		if (
			arg === "--confirm" ||
			arg === "--worker-secret-file" ||
			arg === "--inspection-secret-file"
		) {
			const value = args[index + 1];
			if (!value) throw new Error(`${arg} requires a value`);
			if (arg === "--confirm") options.confirmation = value;
			if (arg === "--worker-secret-file") options.workerSecretFile = resolve(value);
			if (arg === "--inspection-secret-file") options.inspectionSecretFile = resolve(value);
			index += 1;
			continue;
		}
		throw new Error(`Unsupported argument: ${arg}`);
	}
	if (
		!options.execute &&
		(options.confirmation || options.workerSecretFile || options.inspectionSecretFile)
	) {
		throw new Error("Execution credentials and confirmation require --execute");
	}
	if (options.execute) {
		if (options.confirmation !== CONFIRMATION) {
			throw new Error(`Execution requires --confirm "${CONFIRMATION}"`);
		}
		if (!options.inspectionSecretFile) {
			throw new Error("Execution requires the inspection secret file");
		}
		if (options.workerSecretFile && options.workerSecretFile === options.inspectionSecretFile) {
			throw new Error("Worker and inspection credentials must use different files");
		}
	}
	return options;
}

async function readSecretFile(path: string, label: string) {
	const stats = await lstat(path);
	if (!stats.isFile() || stats.isSymbolicLink()) throw new Error(`${label} must be a regular file`);
	if ((stats.mode & 0o077) !== 0) throw new Error(`${label} must have mode 0600`);
	if (stats.size < 32 || stats.size > 4096) throw new Error(`${label} has an invalid size`);
	const raw = await readFile(path, "utf8");
	const secret = raw.endsWith("\n") ? raw.slice(0, -1) : raw;
	return requireSecretValue(secret, label);
}

function requireSecretValue(secret: string | undefined, label: string) {
	if (
		!secret ||
		secret.length < 32 ||
		secret.length > 512 ||
		secret !== secret.trim() ||
		secret.includes("\n") ||
		secret.includes("\r")
	)
		throw new Error(`${label} must contain one exact secret value`);
	return secret;
}

async function convexSiteUrl(repositoryRoot: string) {
	const local = parseDotenv(await readFile(resolve(repositoryRoot, ".env.local")));
	const value = process.env.PUBLIC_CONVEX_SITE_URL ?? local.PUBLIC_CONVEX_SITE_URL;
	if (!value) throw new Error("PUBLIC_CONVEX_SITE_URL is required");
	const url = new URL(value);
	if (
		url.protocol !== "https:" ||
		!url.hostname.endsWith(".convex.site") ||
		url.username ||
		url.password ||
		url.port ||
		url.pathname !== "/" ||
		url.search ||
		url.hash
	)
		throw new Error("PUBLIC_CONVEX_SITE_URL must be an exact Convex site origin");
	return url.origin;
}

function sanityFileSourceUrl(projectId: string, dataset: string, sourceAssetRef: string) {
	const match = /^file-([0-9a-f]{40})-([A-Za-z0-9.]+)$/.exec(sourceAssetRef);
	if (!match) throw new Error(`Invalid Sanity file reference: ${sourceAssetRef}`);
	return `https://cdn.sanity.io/files/${encodeURIComponent(projectId)}/${encodeURIComponent(dataset)}/${match[1]}.${match[2]}`;
}

async function boundedResponseBytes(response: Response) {
	const declaredLength = response.headers.get("Content-Length");
	if (declaredLength && /^\d+$/.test(declaredLength)) {
		const size = Number(declaredLength);
		if (!Number.isSafeInteger(size) || size <= 0 || size > DIRECT_UPLOAD_MAX_BYTES) {
			throw new Error("Source exceeds the direct private-catalog upload limit");
		}
	}
	if (!response.body) throw new Error("Source response has no body");
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		for (;;) {
			const chunk = await reader.read();
			if (chunk.done) break;
			size += chunk.value.byteLength;
			if (size > DIRECT_UPLOAD_MAX_BYTES) {
				await reader.cancel();
				throw new Error("Source exceeds the direct private-catalog upload limit");
			}
			chunks.push(chunk.value);
		}
	} finally {
		reader.releaseLock();
	}
	if (size === 0) throw new Error("Source response is empty");
	const bytes = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return bytes;
}

async function downloadSource(
	projectId: string,
	dataset: string,
	kind: DownloadedAsset["kind"],
	sourceAssetRef: string,
): Promise<DownloadedAsset> {
	const sourceUrl =
		kind === "print_source"
			? sanityImageSourceUrl(projectId, dataset, sourceAssetRef)
			: sanityFileSourceUrl(projectId, dataset, sourceAssetRef);
	if (!sourceUrl) throw new Error(`Invalid Sanity source reference: ${sourceAssetRef}`);
	let response: Response;
	try {
		response = await fetch(sourceUrl, {
			redirect: "error",
			signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS),
		});
	} catch {
		throw new Error(`Sanity source download failed: ${sourceAssetRef}`);
	}
	if (!response.ok || response.url !== sourceUrl) {
		throw new Error(`Sanity source response is invalid: ${sourceAssetRef}`);
	}
	const bytes = await boundedResponseBytes(response);
	if (kind === "paid_digital_file") {
		return {
			kind,
			sourceAssetRef,
			bytes,
			observedMimeType: "application/zip",
			zipInspection: inspectCatalogPrivateZip(bytes),
		};
	}
	let metadata: Awaited<ReturnType<ReturnType<typeof sharp>["metadata"]>>;
	try {
		metadata = await sharp(bytes, { failOn: "error" }).metadata();
	} catch {
		throw new Error(`Sanity print source does not decode: ${sourceAssetRef}`);
	}
	if (
		(metadata.format !== "jpeg" && metadata.format !== "png") ||
		!metadata.width ||
		!metadata.height
	)
		throw new Error(`Sanity print source metadata is invalid: ${sourceAssetRef}`);
	return {
		kind,
		sourceAssetRef,
		bytes,
		observedMimeType: metadata.format === "jpeg" ? "image/jpeg" : "image/png",
		widthPixels: metadata.width,
		heightPixels: metadata.height,
	};
}

async function* oneChunk(bytes: Uint8Array) {
	yield bytes;
}

function byteEvidence(downloaded: readonly DownloadedAsset[]): CatalogPrivateAssetByteEvidence[] {
	return downloaded.map((asset) =>
		asset.kind === "print_source"
			? {
					kind: asset.kind,
					sourceAssetRef: asset.sourceAssetRef,
					bytes: oneChunk(asset.bytes),
					observedMimeType: asset.observedMimeType as "image/jpeg" | "image/png",
					observedWidthPixels: asset.widthPixels ?? 0,
					observedHeightPixels: asset.heightPixels ?? 0,
				}
			: {
					kind: asset.kind,
					sourceAssetRef: asset.sourceAssetRef,
					bytes: oneChunk(asset.bytes),
					observedMimeType: "application/zip",
				},
	);
}

function receiptFacts(
	receipt: Awaited<
		ReturnType<typeof createSanityCatalogPrivateAssetReceiptSet>
	>["receipts"][number],
): CatalogPrivateAssetFacts {
	const target = receipt.target;
	const common = {
		kind: receipt.kind,
		assetKey: target.assetKey,
		privateObjectKey: target.privateObjectKey,
		originalFilename: target.originalFilename,
		mimeType: target.mimeType,
		sizeBytes: target.sizeBytes,
		sha256: target.sha256,
		provenance: target.provenance,
	};
	return receipt.kind === "print_source" && target.mimeType !== "application/zip"
		? {
				...common,
				kind: receipt.kind,
				mimeType: target.mimeType,
				widthPixels: target.widthPixels,
				heightPixels: target.heightPixels,
			}
		: {
				...common,
				kind: "paid_digital_file",
				mimeType: "application/zip",
				...(target.mimeType === "application/zip" && target.version !== undefined
					? { version: target.version }
					: {}),
			};
}

async function writeReport(value: unknown) {
	await rm(REPORT_PATH, { force: true });
	await writeFile(REPORT_PATH, `${JSON.stringify(value, null, 2)}\n`, {
		flag: "wx",
		mode: 0o600,
	});
}

async function main() {
	const options = parseOptions(process.argv.slice(2));
	const repositoryRoot = process.cwd();
	const { projectId, dataset } = await readSanitySourceConfig(repositoryRoot);
	const client = createClient({ projectId, dataset, apiVersion: "2024-01-01", useCdn: false });
	const source = await fetchPublishedSanityCatalogSource(client);
	const manifest = createSanityCatalogImportManifest(source);
	const dryRun = createSanityCatalogImportDryRunReport(manifest);
	const baseline = checkAngelsRestCatalogBaseline(dryRun);
	if (baseline.status !== "matched" || dryRun.draftImport.status === "blocked") {
		throw new Error("Published Sanity catalog no longer matches the reviewed import baseline");
	}
	const printSourceRefs = dryRun.requiredPrintSourceImageRefs;
	const paidFileRefs = dryRun.requiredSourceFileRefs;
	if (
		printSourceRefs.length !== EXPECTED_PRINT_SOURCE_COUNT ||
		paidFileRefs.length !== EXPECTED_PAID_FILE_COUNT
	)
		throw new Error("Published Sanity catalog no longer has the reviewed 11+1 private set");

	if (!options.execute) {
		console.log(
			`Plan ready: ${printSourceRefs.length} print masters and ${paidFileRefs.length} paid ZIP; no bytes downloaded, uploaded, registered, or published.`,
		);
		console.log(`Execute with --execute --confirm "${CONFIRMATION}" and both secret files.`);
		return;
	}

	const [workerSecret, inspectionSecret, targetConvexSiteUrl] = await Promise.all([
		options.workerSecretFile
			? readSecretFile(options.workerSecretFile, "Worker credential file")
			: Promise.resolve(
					requireSecretValue(process.env.CMS_MEDIA_WORKER_SECRET, "CMS_MEDIA_WORKER_SECRET"),
				),
		readSecretFile(options.inspectionSecretFile as string, "Inspection credential file"),
		convexSiteUrl(repositoryRoot),
	]);
	if (workerSecret === inspectionSecret)
		throw new Error("Worker and inspection credentials must differ");
	const downloaded = await Promise.all([
		...printSourceRefs.map((sourceAssetRef) =>
			downloadSource(projectId, dataset, "print_source", sourceAssetRef),
		),
		...paidFileRefs.map((sourceAssetRef) =>
			downloadSource(projectId, dataset, "paid_digital_file", sourceAssetRef),
		),
	]);
	const candidate = await createSanityCatalogPrivateAssetReceiptSet({
		manifest,
		evidence: byteEvidence(downloaded),
		siteUrl: ANGELS_REST_CATALOG_SITE_URL,
		recordedAt: Date.now(),
		actorIdentity: "catalog-private-transfer:v1",
	});
	const facts = candidate.receipts.map(receiptFacts);
	const receiptSetId = await createCatalogPrivateAssetReceiptSetId(candidate.siteUrl, facts);

	const privateObjectKeys: string[] = [];
	for (const receipt of candidate.receipts) {
		const asset = downloaded.find(
			(item) => item.kind === receipt.kind && item.sourceAssetRef === receipt.sourceAssetRef,
		);
		if (!asset) throw new Error(`Downloaded bytes are missing for ${receipt.sourceAssetRef}`);
		const transferred = await transferCatalogPrivateAsset({
			receipt,
			bytes: asset.bytes,
			workerTenantSecret: workerSecret,
		});
		if (transferred !== receipt.target.privateObjectKey) {
			throw new Error(`Worker returned the wrong private key for ${receipt.sourceAssetRef}`);
		}
		privateObjectKeys.push(transferred);
	}

	const storage = await submitCatalogPrivateStorageReceipt({
		privateObjectKeys,
		workerTenantSecret: workerSecret,
	});
	if (storage.receiptSetId !== receiptSetId) {
		throw new Error("Worker storage receipt identity differs from the inspected asset set");
	}
	const inspectionSet: CatalogPrivateInspectionReceiptSet = {
		schemaVersion: 1,
		receiptSetId,
		siteUrl: candidate.siteUrl,
		receipts: candidate.receipts.map((receipt, index) => {
			const factsForReceipt = facts[index];
			if (!factsForReceipt) throw new Error("Inspection receipt facts are incomplete");
			if (factsForReceipt.kind === "print_source") {
				return { facts: factsForReceipt, inspection: { method: "decoded_image_v1" as const } };
			}
			const asset = downloaded.find(
				(item) => item.kind === receipt.kind && item.sourceAssetRef === receipt.sourceAssetRef,
			);
			if (!asset?.zipInspection) throw new Error("Paid ZIP inspection is missing");
			return {
				facts: factsForReceipt,
				inspection: { method: "safe_zip_v1" as const, ...asset.zipInspection },
			};
		}),
	};
	await validateCatalogPrivateInspectionReceiptSet(inspectionSet);
	const inspection = await submitCatalogPrivateInspectionReceipt({
		convexOrigin: targetConvexSiteUrl,
		inspectionSecret,
		receiptSet: inspectionSet,
	});
	if (inspection.status !== "verified" || inspection.targets.length !== candidate.receipts.length) {
		throw new Error("Private catalog inspection did not verify the complete target set");
	}

	const storageReplay = await submitCatalogPrivateStorageReceipt({
		privateObjectKeys,
		workerTenantSecret: workerSecret,
	});
	const inspectionReplay = await submitCatalogPrivateInspectionReceipt({
		convexOrigin: targetConvexSiteUrl,
		inspectionSecret,
		receiptSet: inspectionSet,
	});
	if (
		storageReplay.status !== "verified" ||
		!storageReplay.replayed ||
		storageReplay.receiptSetId !== receiptSetId ||
		inspectionReplay.status !== "verified" ||
		!inspectionReplay.replayed ||
		JSON.stringify(inspectionReplay.targets) !== JSON.stringify(inspection.targets)
	)
		throw new Error("Private catalog receipt replay did not preserve the verified target set");

	await writeReport({
		schemaVersion: 1,
		siteUrl: candidate.siteUrl,
		receiptSetId,
		candidateChecksum: candidate.candidateChecksum,
		assetCount: candidate.receipts.length,
		storage: { status: storage.status, replayed: storage.replayed },
		inspection: { status: inspection.status, replayed: inspection.replayed },
		replay: { storage: storageReplay.replayed, inspection: inspectionReplay.replayed },
		targets: inspection.targets,
	});
	console.log(
		`Verified ${candidate.receipts.length} private catalog assets with stable replay. Sanitized report: ${REPORT_PATH}`,
	);
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
});
