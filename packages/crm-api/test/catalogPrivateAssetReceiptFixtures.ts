import type { convexTest } from "convex-test";
import type {
	CatalogPrivateAssetFacts,
	CatalogPrivateInspectionReceiptSet,
	CatalogPrivateStorageReceiptSet,
} from "../convex/helpers/catalogPrivateAssetReceiptContract";

export const SITE_A = "site-a.example";
const SITE_B = "site-b.example";
export const STORAGE_SECRET_A = "catalog-storage-secret-a-0123456789abcdef";
export const STORAGE_SECRET_B = "catalog-storage-secret-b-0123456789abcdef";
export const INSPECTION_SECRET_A = "catalog-inspection-secret-a-0123456789abcdef";
const INSPECTION_SECRET_B = "catalog-inspection-secret-b-0123456789abcdef";
export const STORAGE_PATH = "/cms-media/catalog-private-assets/storage-receipt";
export const INSPECTION_PATH = "/cms-media/catalog-private-assets/inspection-receipt";
export const DEFAULT_RECEIPT_SET_ID =
	"catalog-private-assets-v1:df78d059f07865559876bf34204bd8f59dcaf385bdf6735193f5549f32107b2c";

export function printFacts(
	assetKey = "image-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-6000x4000-jpg",
	sha256 = "a".repeat(64),
): Extract<CatalogPrivateAssetFacts, { kind: "print_source" }> {
	return {
		kind: "print_source",
		assetKey,
		privateObjectKey: `sites/${SITE_A}/catalog/print-sources/${assetKey}/original`,
		originalFilename: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-6000x4000.jpg",
		mimeType: "image/jpeg",
		sizeBytes: 8_000_000,
		widthPixels: 6000,
		heightPixels: 4000,
		sha256,
		provenance: {
			provider: "sanity",
			sourceId: assetKey,
			sourceRevision: "print-source-revision-1",
		},
	};
}

export function paidFacts(): Extract<
	CatalogPrivateAssetFacts,
	{ kind: "paid_digital_file" }
> {
	const assetKey = "file-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb-zip";
	return {
		kind: "paid_digital_file",
		assetKey,
		privateObjectKey: `sites/${SITE_A}/catalog/paid-digital-files/${assetKey}/original`,
		originalFilename: "time-aware-theme.zip",
		mimeType: "application/zip",
		sizeBytes: 15_064,
		sha256: "b".repeat(64),
		version: "1.0.0",
		provenance: {
			provider: "sanity",
			sourceId: assetKey,
			sourceRevision: "paid-file-revision-1",
		},
	};
}

export function storageSet(
	facts: CatalogPrivateAssetFacts[] = [printFacts(), paidFacts()],
	receiptSetId = DEFAULT_RECEIPT_SET_ID,
): CatalogPrivateStorageReceiptSet {
	return {
		schemaVersion: 1,
		receiptSetId,
		siteUrl: SITE_A,
		receipts: facts.map((item, index) => ({
			facts: item,
			uploadedAt: `2026-07-20T08:19:${String(26 + index).padStart(2, "0")}.000Z`,
			etag: `r2-etag-${index}`,
		})) as CatalogPrivateStorageReceiptSet["receipts"],
	};
}

export function inspectionSet(
	facts: CatalogPrivateAssetFacts[] = [printFacts(), paidFacts()],
	receiptSetId = DEFAULT_RECEIPT_SET_ID,
): CatalogPrivateInspectionReceiptSet {
	return {
		schemaVersion: 1,
		receiptSetId,
		siteUrl: SITE_A,
		receipts: facts.map((item) => item.kind === "print_source"
			? { facts: item, inspection: { method: "decoded_image_v1" as const } }
			: {
					facts: item,
					inspection: {
						method: "safe_zip_v1" as const,
						entryCount: 6,
						totalUncompressedBytes: 48_000,
						maximumEntryCompressionRatio: 4.5,
						encryptedEntryCount: 0,
						unsafePathCount: 0,
						duplicatePathCount: 0,
					},
				}) as CatalogPrivateInspectionReceiptSet["receipts"],
	};
}

function restoreEnvironment(name: string, previous: string | undefined) {
	if (previous === undefined) delete process.env[name];
	else process.env[name] = previous;
}

export async function withReceiptEnvironment<T>(
	action: () => Promise<T>,
	options: { storage?: string; inspection?: string } = {},
) {
	const names = [
		"SITE_URL",
		"BETTER_AUTH_SECRET",
		"CATALOG_PRIVATE_ASSET_STORAGE_RECEIPT_SECRETS",
		"CATALOG_PRIVATE_ASSET_INSPECTION_RECEIPT_SECRETS",
	] as const;
	const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
	process.env.SITE_URL = `https://${SITE_A}`;
	process.env.BETTER_AUTH_SECRET = "test-better-auth-secret-0123456789";
	process.env.CATALOG_PRIVATE_ASSET_STORAGE_RECEIPT_SECRETS = options.storage
		?? JSON.stringify({ [SITE_A]: [STORAGE_SECRET_A], [SITE_B]: [STORAGE_SECRET_B] });
	process.env.CATALOG_PRIVATE_ASSET_INSPECTION_RECEIPT_SECRETS = options.inspection
		?? JSON.stringify({ [SITE_A]: [INSPECTION_SECRET_A], [SITE_B]: [INSPECTION_SECRET_B] });
	try {
		return await action();
	} finally {
		for (const name of names) restoreEnvironment(name, previous[name]);
	}
}

export async function postReceipt(
	t: ReturnType<typeof convexTest>,
	path: string,
	secret: string,
	body: CatalogPrivateStorageReceiptSet | CatalogPrivateInspectionReceiptSet,
) {
	return await t.fetch(path, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${secret}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify(body),
	});
}

export async function storedState(t: ReturnType<typeof convexTest>) {
	return await t.run(async (ctx) => ({
		coordinations: await ctx.db.query("catalogPrivateAssetReceiptCoordinations").take(40),
		printSources: await ctx.db.query("catalogPrintSourceAssets").take(40),
		paidFiles: await ctx.db.query("catalogDigitalFileAssets").take(40),
	}));
}
