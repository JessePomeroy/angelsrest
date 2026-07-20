import { describe, expect, test, vi } from "vitest";
import type { CatalogPrivateInspectionReceiptSet } from "../../packages/crm-api/convex/helpers/catalogPrivateAssetReceiptContract";
import type { CatalogPrivateAssetReceipt } from "./sanityCatalogPrivateAssetReceipts";
import {
	CATALOG_PRIVATE_INSPECTION_PATH,
	CATALOG_PRIVATE_WORKER_ORIGIN,
	submitCatalogPrivateInspectionReceipt,
	submitCatalogPrivateStorageReceipt,
	transferCatalogPrivateAsset,
} from "./sanityCatalogPrivateAssetTransfer";

const WORKER_SECRET = "worker-tenant-secret-0123456789abcdef";
const INSPECTION_SECRET = "inspection-secret-0123456789abcdef";
const CONVEX_ORIGIN = "https://kind-otter-123.convex.site";
const RECEIPT_SET_ID = `catalog-private-assets-v1:${"a".repeat(64)}`;
const ASSET_KEY = `image-${"1".repeat(40)}-1200x800-jpg`;
const PRIVATE_OBJECT_KEY = `sites/angelsrest.online/catalog/print-sources/${ASSET_KEY}/original`;
const BYTES = new TextEncoder().encode("abc");

function json(value: unknown, status = 200) {
	return Response.json(value, { status });
}

function receipt(): CatalogPrivateAssetReceipt {
	return {
		kind: "print_source",
		sourceAssetRef: ASSET_KEY,
		target: {
			siteUrl: "angelsrest.online",
			assetKey: ASSET_KEY,
			privateObjectKey: PRIVATE_OBJECT_KEY,
			status: "verified",
			originalFilename: `${"1".repeat(40)}-1200x800.jpg`,
			mimeType: "image/jpeg",
			sizeBytes: BYTES.byteLength,
			widthPixels: 1200,
			heightPixels: 800,
			sha256: "b".repeat(64),
			provenance: {
				provider: "sanity",
				sourceId: ASSET_KEY,
				sourceRevision: "asset-revision-1",
			},
			createdAt: 1,
			createdBy: "cms-catalog-migration",
			verifiedAt: 1,
			verifiedBy: "cms-catalog-migration",
		},
	};
}

function inspectionSet(): CatalogPrivateInspectionReceiptSet {
	return {
		schemaVersion: 1,
		receiptSetId: RECEIPT_SET_ID,
		siteUrl: "angelsrest.online",
		receipts: [
			{
				facts: {
					kind: "print_source",
					assetKey: ASSET_KEY,
					privateObjectKey: PRIVATE_OBJECT_KEY,
					originalFilename: `${"1".repeat(40)}-1200x800.jpg`,
					mimeType: "image/jpeg",
					sizeBytes: BYTES.byteLength,
					widthPixels: 1200,
					heightPixels: 800,
					sha256: "b".repeat(64),
					provenance: {
						provider: "sanity",
						sourceId: ASSET_KEY,
						sourceRevision: "asset-revision-1",
					},
				},
				inspection: { method: "decoded_image_v1" },
			},
		],
	};
}

describe("private catalog asset transport", () => {
	test("uploads exact bytes with a Worker capability and finalizes the object", async () => {
		const fetcher = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
			const url = String(input);
			if (url.endsWith("/v1/catalog-assets/uploads/capabilities")) {
				return json({
					status: "upload_required",
					kind: "print_source",
					assetKey: ASSET_KEY,
					privateObjectKey: PRIVATE_OBJECT_KEY,
					uploadUrl: `/v1/catalog-assets/uploads/source?key=${encodeURIComponent(PRIVATE_OBJECT_KEY)}`,
					uploadToken: "upload-token",
					expiresAt: "2026-07-20T12:00:00.000Z",
				});
			}
			if (url.includes("/v1/catalog-assets/uploads/source?")) {
				return json({
					status: "stored_unverified",
					replayed: false,
					assetKey: ASSET_KEY,
					privateObjectKey: PRIVATE_OBJECT_KEY,
				});
			}
			expect(url).toBe(`${CATALOG_PRIVATE_WORKER_ORIGIN}/v1/catalog-assets/uploads/finalize`);
			return json({
				status: "stored_unverified",
				asset: { privateObjectKey: PRIVATE_OBJECT_KEY },
			});
		});

		await expect(
			transferCatalogPrivateAsset({
				receipt: receipt(),
				bytes: BYTES,
				workerTenantSecret: WORKER_SECRET,
				fetcher,
			}),
		).resolves.toBe(PRIVATE_OBJECT_KEY);
		expect(fetcher).toHaveBeenCalledTimes(3);

		const capabilityInit = fetcher.mock.calls[0]?.[1];
		const capabilityHeaders = new Headers(capabilityInit?.headers);
		expect(capabilityHeaders.get("Authorization")).toBe(`Bearer ${WORKER_SECRET}`);
		expect(JSON.parse(String(capabilityInit?.body))).toEqual({
			siteUrl: "angelsrest.online",
			kind: "print_source",
			assetKey: ASSET_KEY,
			originalFilename: `${"1".repeat(40)}-1200x800.jpg`,
			contentType: "image/jpeg",
			sizeBytes: BYTES.byteLength,
			sha256: "b".repeat(64),
			provenance: {
				provider: "sanity",
				sourceId: ASSET_KEY,
				sourceRevision: "asset-revision-1",
			},
			widthPixels: 1200,
			heightPixels: 800,
		});

		const uploadInit = fetcher.mock.calls[1]?.[1];
		const uploadHeaders = new Headers(uploadInit?.headers);
		expect(uploadHeaders.get("Authorization")).toBeNull();
		expect(uploadHeaders.get("X-CMS-Media-Upload-Token")).toBe("upload-token");
		expect(uploadHeaders.get("Content-Type")).toBe("image/jpeg");
		expect(uploadHeaders.get("Content-Length")).toBe(String(BYTES.byteLength));
		expect(uploadInit?.body).toBe(BYTES);

		const finalizeInit = fetcher.mock.calls[2]?.[1];
		expect(JSON.parse(String(finalizeInit?.body))).toEqual({
			privateObjectKey: PRIVATE_OBJECT_KEY,
		});
	});

	test("skips PUT for a stored-unverified capability replay and still finalizes", async () => {
		const fetcher = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(
				json({
					status: "stored_unverified",
					replayed: true,
					asset: { privateObjectKey: PRIVATE_OBJECT_KEY },
				}),
			)
			.mockResolvedValueOnce(
				json({
					status: "stored_unverified",
					asset: { privateObjectKey: PRIVATE_OBJECT_KEY },
				}),
			);

		await transferCatalogPrivateAsset({
			receipt: receipt(),
			bytes: BYTES,
			workerTenantSecret: WORKER_SECRET,
			fetcher,
		});
		expect(fetcher).toHaveBeenCalledTimes(2);
		expect(String(fetcher.mock.calls[1]?.[0])).toContain("/uploads/finalize");
	});

	test.each([
		"pending_inspection",
		"verified",
	] as const)("submits the exact storage request and parses %s", async (status) => {
		const fetcher = vi
			.fn<typeof fetch>()
			.mockResolvedValue(
				json({ status, replayed: false, assetCount: 1, receiptSetId: RECEIPT_SET_ID }),
			);
		await expect(
			submitCatalogPrivateStorageReceipt({
				privateObjectKeys: [PRIVATE_OBJECT_KEY],
				workerTenantSecret: WORKER_SECRET,
				fetcher,
			}),
		).resolves.toEqual({
			status,
			replayed: false,
			assetCount: 1,
			receiptSetId: RECEIPT_SET_ID,
		});
		const [url, init] = fetcher.mock.calls[0] ?? [];
		expect(url).toBe(`${CATALOG_PRIVATE_WORKER_ORIGIN}/v1/catalog-assets/receipts/storage`);
		expect(JSON.parse(String(init?.body))).toEqual({
			schemaVersion: 1,
			siteUrl: "angelsrest.online",
			privateObjectKeys: [PRIVATE_OBJECT_KEY],
		});
	});

	test("posts with the inspection secret and parses verified target mappings", async () => {
		const target = { kind: "print_source", assetKey: ASSET_KEY, assetId: "convex-id-1" };
		const fetcher = vi
			.fn<typeof fetch>()
			.mockResolvedValue(json({ status: "verified", replayed: false, targets: [target] }));
		const set = inspectionSet();
		await expect(
			submitCatalogPrivateInspectionReceipt({
				convexOrigin: CONVEX_ORIGIN,
				receiptSet: set,
				inspectionSecret: INSPECTION_SECRET,
				fetcher,
			}),
		).resolves.toEqual({ status: "verified", replayed: false, targets: [target] });
		const [url, init] = fetcher.mock.calls[0] ?? [];
		expect(url).toBe(`${CONVEX_ORIGIN}${CATALOG_PRIVATE_INSPECTION_PATH}`);
		expect(new Headers(init?.headers).get("Authorization")).toBe(`Bearer ${INSPECTION_SECRET}`);
		expect(JSON.parse(String(init?.body))).toEqual(set);
	});

	test("rejects cross-origin capabilities and malformed inspection responses", async () => {
		const crossOriginFetcher = vi.fn<typeof fetch>().mockResolvedValue(
			json({
				status: "upload_required",
				privateObjectKey: PRIVATE_OBJECT_KEY,
				uploadUrl: `https://attacker.example${CATALOG_PRIVATE_INSPECTION_PATH}`,
				uploadToken: "upload-token",
			}),
		);
		await expect(
			transferCatalogPrivateAsset({
				receipt: receipt(),
				bytes: BYTES,
				workerTenantSecret: WORKER_SECRET,
				fetcher: crossOriginFetcher,
			}),
		).rejects.toThrow(/crossed the Worker upload boundary/);

		await expect(
			submitCatalogPrivateInspectionReceipt({
				convexOrigin: "https://attacker.example",
				receiptSet: inspectionSet(),
				inspectionSecret: INSPECTION_SECRET,
				fetcher: vi.fn(),
			}),
		).rejects.toThrow(/\.convex\.site origin/);

		await expect(
			submitCatalogPrivateInspectionReceipt({
				convexOrigin: CONVEX_ORIGIN,
				receiptSet: inspectionSet(),
				inspectionSecret: INSPECTION_SECRET,
				fetcher: vi
					.fn<typeof fetch>()
					.mockResolvedValue(json({ status: "verified", replayed: false, targets: [] })),
			}),
		).rejects.toThrow(/malformed response/);
	});
});
