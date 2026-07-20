import type {
	CatalogPrivateAssetTargetMapping,
	CatalogPrivateInspectionReceiptSet,
} from "../../packages/crm-api/convex/helpers/catalogPrivateAssetReceiptContract";
import {
	validatePaidDigitalFileAsset,
	validatePrivatePrintSourceAsset,
} from "../../packages/crm-api/convex/helpers/catalogPrivateAssetValidators";
import {
	ANGELS_REST_CATALOG_SITE_URL,
	type CatalogPrivateAssetReceipt,
} from "./sanityCatalogPrivateAssetReceipts";

export const CATALOG_PRIVATE_WORKER_ORIGIN =
	"https://cms-media-worker.thinkingofview.workers.dev" as const;
export const CATALOG_PRIVATE_INSPECTION_PATH =
	"/cms-media/catalog-private-assets/inspection-receipt" as const;

const CAPABILITY_PATH = "/v1/catalog-assets/uploads/capabilities";
const UPLOAD_PATH = "/v1/catalog-assets/uploads/source";
const FINALIZE_PATH = "/v1/catalog-assets/uploads/finalize";
const STORAGE_RECEIPT_PATH = "/v1/catalog-assets/receipts/storage";
const UPLOAD_TOKEN_HEADER = "X-CMS-Media-Upload-Token";
const MAX_RESPONSE_BYTES = 64 * 1024;
const RECEIPT_SET_ID_PATTERN = /^catalog-private-assets-v1:[a-f0-9]{64}$/;

type Fetcher = typeof fetch;
type JsonObject = Record<string, unknown>;

export type CatalogPrivateStorageResult = {
	status: "pending_inspection" | "verified";
	replayed: boolean;
	assetCount: number;
	receiptSetId: string;
};

export type CatalogPrivateInspectionResult =
	| {
			status: "pending_storage";
			replayed: boolean;
			assetCount: number;
	  }
	| {
			status: "verified";
			replayed: boolean;
			targets: CatalogPrivateAssetTargetMapping[];
	  };

function isObject(value: unknown): value is JsonObject {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: JsonObject, keys: readonly string[]) {
	const actual = Object.keys(value);
	return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function requiredSecret(value: string, name: string) {
	if (!value || value !== value.trim() || /[\r\n]/.test(value)) {
		throw new Error(`${name} must be non-empty trimmed text`);
	}
	return value;
}

async function readBoundedJson(response: Response, boundary: string): Promise<unknown> {
	const contentType = response.headers.get("Content-Type")?.split(";", 1)[0]?.trim();
	if (contentType !== "application/json" || !response.body) {
		throw new Error(`${boundary} returned a malformed response`);
	}
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	while (true) {
		const chunk = await reader.read();
		if (chunk.done) break;
		size += chunk.value.byteLength;
		if (size > MAX_RESPONSE_BYTES) {
			await reader.cancel().catch(() => undefined);
			throw new Error(`${boundary} returned an oversized response`);
		}
		chunks.push(chunk.value);
	}
	const bytes = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	try {
		return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
	} catch {
		throw new Error(`${boundary} returned a malformed response`);
	}
}

async function fetchJson(fetcher: Fetcher, url: string, init: RequestInit, boundary: string) {
	const response = await fetcher(url, { ...init, redirect: "error" });
	if (!response.ok) throw new Error(`${boundary} failed with HTTP ${response.status}`);
	return await readBoundedJson(response, boundary);
}

function bearerJson(secret: string) {
	return {
		Authorization: `Bearer ${secret}`,
		"Content-Type": "application/json",
	};
}

function privateObjectKey(value: unknown, boundary: string) {
	if (!isObject(value) || typeof value.privateObjectKey !== "string") {
		throw new Error(`${boundary} returned a malformed response`);
	}
	return value.privateObjectKey;
}

function capabilityUploadUrl(value: unknown, expectedKey: string) {
	if (!isObject(value) || typeof value.uploadUrl !== "string") {
		throw new Error("Catalog upload capability returned a malformed response");
	}
	let url: URL;
	try {
		url = new URL(value.uploadUrl, CATALOG_PRIVATE_WORKER_ORIGIN);
	} catch {
		throw new Error("Catalog upload capability returned an invalid upload URL");
	}
	const query = [...url.searchParams.entries()];
	if (
		url.origin !== CATALOG_PRIVATE_WORKER_ORIGIN ||
		url.pathname !== UPLOAD_PATH ||
		url.username ||
		url.password ||
		url.hash ||
		query.length !== 1 ||
		query[0]?.[0] !== "key" ||
		query[0]?.[1] !== expectedKey
	) {
		throw new Error("Catalog upload capability crossed the Worker upload boundary");
	}
	return url.toString();
}

function uploadDescriptor(receipt: CatalogPrivateAssetReceipt) {
	if (receipt.kind === "print_source") {
		validatePrivatePrintSourceAsset(receipt.target);
		return {
			siteUrl: receipt.target.siteUrl,
			kind: receipt.kind,
			assetKey: receipt.target.assetKey,
			originalFilename: receipt.target.originalFilename,
			contentType: receipt.target.mimeType,
			sizeBytes: receipt.target.sizeBytes,
			sha256: receipt.target.sha256,
			provenance: receipt.target.provenance,
			widthPixels: receipt.target.widthPixels,
			heightPixels: receipt.target.heightPixels,
		};
	}
	validatePaidDigitalFileAsset(receipt.target);
	return {
		siteUrl: receipt.target.siteUrl,
		kind: receipt.kind,
		assetKey: receipt.target.assetKey,
		originalFilename: receipt.target.originalFilename,
		contentType: receipt.target.mimeType,
		sizeBytes: receipt.target.sizeBytes,
		sha256: receipt.target.sha256,
		provenance: receipt.target.provenance,
		...(receipt.target.version === undefined ? {} : { version: receipt.target.version }),
	};
}

/** Transfers one already-hashed candidate target without retaining either credential. */
export async function transferCatalogPrivateAsset({
	receipt,
	bytes,
	workerTenantSecret,
	fetcher = fetch,
}: {
	receipt: CatalogPrivateAssetReceipt;
	bytes: Uint8Array;
	workerTenantSecret: string;
	fetcher?: Fetcher;
}): Promise<string> {
	const secret = requiredSecret(workerTenantSecret, "Worker tenant secret");
	if (!(bytes instanceof Uint8Array) || bytes.byteLength !== receipt.target.sizeBytes) {
		throw new Error("Catalog upload bytes do not match the candidate byte count");
	}
	if (
		receipt.sourceAssetRef !== receipt.target.assetKey ||
		receipt.target.siteUrl !== ANGELS_REST_CATALOG_SITE_URL
	) {
		throw new Error(`Catalog transfer is fixed to ${ANGELS_REST_CATALOG_SITE_URL}`);
	}

	const expectedKey = receipt.target.privateObjectKey;
	const capability = await fetchJson(
		fetcher,
		`${CATALOG_PRIVATE_WORKER_ORIGIN}${CAPABILITY_PATH}`,
		{
			method: "POST",
			headers: bearerJson(secret),
			body: JSON.stringify(uploadDescriptor(receipt)),
		},
		"Catalog upload capability",
	);
	if (!isObject(capability)) {
		throw new Error("Catalog upload capability returned a malformed response");
	}

	if (capability.status === "upload_required") {
		if (
			privateObjectKey(capability, "Catalog upload capability") !== expectedKey ||
			typeof capability.uploadToken !== "string" ||
			!capability.uploadToken ||
			/[\r\n]/.test(capability.uploadToken)
		) {
			throw new Error("Catalog upload capability returned a malformed response");
		}
		const uploadUrl = capabilityUploadUrl(capability, expectedKey);
		const upload = await fetchJson(
			fetcher,
			uploadUrl,
			{
				method: "PUT",
				headers: {
					"Content-Type": receipt.target.mimeType,
					"Content-Length": String(bytes.byteLength),
					[UPLOAD_TOKEN_HEADER]: capability.uploadToken,
				},
				body: bytes as BodyInit,
			},
			"Catalog source upload",
		);
		if (
			!isObject(upload) ||
			upload.status !== "stored_unverified" ||
			privateObjectKey(upload, "Catalog source upload") !== expectedKey
		) {
			throw new Error("Catalog source upload returned a malformed response");
		}
	} else if (
		capability.status !== "stored_unverified" ||
		capability.replayed !== true ||
		privateObjectKey(capability.asset, "Catalog upload capability") !== expectedKey
	) {
		throw new Error("Catalog upload capability returned a malformed response");
	}

	const finalized = await fetchJson(
		fetcher,
		`${CATALOG_PRIVATE_WORKER_ORIGIN}${FINALIZE_PATH}`,
		{
			method: "POST",
			headers: bearerJson(secret),
			body: JSON.stringify({ privateObjectKey: expectedKey }),
		},
		"Catalog upload finalization",
	);
	if (
		!isObject(finalized) ||
		finalized.status !== "stored_unverified" ||
		privateObjectKey(finalized.asset, "Catalog upload finalization") !== expectedKey
	) {
		throw new Error("Catalog upload finalization returned a malformed response");
	}
	return expectedKey;
}

export async function submitCatalogPrivateStorageReceipt({
	privateObjectKeys,
	workerTenantSecret,
	fetcher = fetch,
}: {
	privateObjectKeys: readonly string[];
	workerTenantSecret: string;
	fetcher?: Fetcher;
}): Promise<CatalogPrivateStorageResult> {
	const secret = requiredSecret(workerTenantSecret, "Worker tenant secret");
	if (
		privateObjectKeys.length === 0 ||
		new Set(privateObjectKeys).size !== privateObjectKeys.length ||
		privateObjectKeys.some(
			(key) =>
				typeof key !== "string" ||
				!key.startsWith(`sites/${ANGELS_REST_CATALOG_SITE_URL}/catalog/`),
		)
	) {
		throw new Error("Catalog storage receipt keys must be a unique Angels Rest asset set");
	}
	const value = await fetchJson(
		fetcher,
		`${CATALOG_PRIVATE_WORKER_ORIGIN}${STORAGE_RECEIPT_PATH}`,
		{
			method: "POST",
			headers: bearerJson(secret),
			body: JSON.stringify({
				schemaVersion: 1,
				siteUrl: ANGELS_REST_CATALOG_SITE_URL,
				privateObjectKeys,
			}),
		},
		"Catalog storage receipt",
	);
	if (
		!isObject(value) ||
		!exactKeys(value, ["status", "replayed", "assetCount", "receiptSetId"]) ||
		(value.status !== "pending_inspection" && value.status !== "verified") ||
		typeof value.replayed !== "boolean" ||
		value.assetCount !== privateObjectKeys.length ||
		typeof value.receiptSetId !== "string" ||
		!RECEIPT_SET_ID_PATTERN.test(value.receiptSetId)
	) {
		throw new Error("Catalog storage receipt returned a malformed response");
	}
	return value as CatalogPrivateStorageResult;
}

function inspectionEndpoint(origin: string) {
	let url: URL;
	try {
		url = new URL(origin);
	} catch {
		throw new Error("Convex inspection origin is invalid");
	}
	if (
		url.protocol !== "https:" ||
		!url.hostname.endsWith(".convex.site") ||
		url.username ||
		url.password ||
		url.port ||
		url.pathname !== "/" ||
		url.search ||
		url.hash
	) {
		throw new Error("Convex inspection origin must be an exact .convex.site origin");
	}
	return `${url.origin}${CATALOG_PRIVATE_INSPECTION_PATH}`;
}

export async function submitCatalogPrivateInspectionReceipt({
	convexOrigin,
	receiptSet,
	inspectionSecret,
	fetcher = fetch,
}: {
	convexOrigin: string;
	receiptSet: CatalogPrivateInspectionReceiptSet;
	inspectionSecret: string;
	fetcher?: Fetcher;
}): Promise<CatalogPrivateInspectionResult> {
	const endpoint = inspectionEndpoint(convexOrigin);
	const secret = requiredSecret(inspectionSecret, "Inspection secret");
	if (
		receiptSet.schemaVersion !== 1 ||
		receiptSet.siteUrl !== ANGELS_REST_CATALOG_SITE_URL ||
		!RECEIPT_SET_ID_PATTERN.test(receiptSet.receiptSetId) ||
		receiptSet.receipts.length === 0
	) {
		throw new Error("Catalog inspection receipt set is invalid");
	}

	const expected = new Set(
		receiptSet.receipts.map(({ facts }) => `${facts.kind}:${facts.assetKey}`),
	);
	if (expected.size !== receiptSet.receipts.length) {
		throw new Error("Catalog inspection receipt set contains duplicate asset identities");
	}
	const value = await fetchJson(
		fetcher,
		endpoint,
		{
			method: "POST",
			headers: bearerJson(secret),
			body: JSON.stringify(receiptSet),
		},
		"Catalog inspection receipt",
	);
	if (!isObject(value) || typeof value.replayed !== "boolean") {
		throw new Error("Catalog inspection receipt returned a malformed response");
	}
	if (
		value.status === "pending_storage" &&
		exactKeys(value, ["status", "replayed", "assetCount"]) &&
		value.assetCount === receiptSet.receipts.length
	) {
		return value as CatalogPrivateInspectionResult;
	}
	if (
		value.status !== "verified" ||
		!exactKeys(value, ["status", "replayed", "targets"]) ||
		!Array.isArray(value.targets) ||
		value.targets.length !== expected.size
	) {
		throw new Error("Catalog inspection receipt returned a malformed response");
	}
	const remaining = new Set(expected);
	const assetIds = new Set<string>();
	for (const target of value.targets) {
		if (
			!isObject(target) ||
			!exactKeys(target, ["kind", "assetKey", "assetId"]) ||
			(target.kind !== "print_source" && target.kind !== "paid_digital_file") ||
			typeof target.assetKey !== "string" ||
			typeof target.assetId !== "string" ||
			!target.assetId ||
			target.assetId !== target.assetId.trim() ||
			assetIds.has(target.assetId) ||
			!remaining.delete(`${target.kind}:${target.assetKey}`)
		) {
			throw new Error("Catalog inspection receipt returned malformed target mappings");
		}
		assetIds.add(target.assetId);
	}
	if (remaining.size !== 0) {
		throw new Error("Catalog inspection receipt returned malformed target mappings");
	}
	return value as CatalogPrivateInspectionResult;
}
