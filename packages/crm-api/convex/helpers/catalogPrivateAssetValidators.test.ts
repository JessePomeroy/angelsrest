import { describe, expect, test } from "vitest";
import {
	PRIVATE_CATALOG_ASSET_LIMITS,
	type PaidDigitalFileAsset,
	type PrivatePrintSourceAsset,
	toEditorSafePaidDigitalFileAsset,
	toEditorSafePrivatePrintSourceAsset,
	validatePaidDigitalFileAsset,
	validatePrivatePrintSourceAsset,
} from "./catalogPrivateAssetValidators";

const SHA_256 = "a".repeat(64);

function printSource(overrides: Partial<PrivatePrintSourceAsset> = {}): PrivatePrintSourceAsset {
	return {
		siteUrl: "angelsrest.online",
		assetKey: "catalog.print.source-001",
		privateObjectKey:
			"sites/angelsrest.online/catalog/print-sources/catalog.print.source-001/original",
		status: "verified",
		originalFilename: "gallery-master.jpg",
		mimeType: "image/jpeg",
		sizeBytes: 40_000_000,
		widthPixels: 12_000,
		heightPixels: 8_000,
		sha256: SHA_256,
		provenance: {
			provider: "sanity",
			sourceId: "image-source-001-12000x8000-jpg",
			sourceRevision: "sanity-revision-001",
		},
		createdAt: 1_750_000_000_000,
		createdBy: "catalog-migration",
		verifiedAt: 1_750_000_000_100,
		verifiedBy: "catalog-migration",
		...overrides,
	};
}

function paidFile(overrides: Partial<PaidDigitalFileAsset> = {}): PaidDigitalFileAsset {
	return {
		siteUrl: "angelsrest.online",
		assetKey: "catalog.paid-file.theme-v1",
		privateObjectKey:
			"sites/angelsrest.online/catalog/paid-digital-files/catalog.paid-file.theme-v1/original",
		status: "verified",
		originalFilename: "time-aware-theme-v1.0.0.zip",
		mimeType: "application/zip",
		sizeBytes: 15_064,
		sha256: SHA_256,
		version: "1.0.0",
		provenance: {
			provider: "sanity",
			sourceId: "file-source-001-zip",
			sourceRevision: "sanity-revision-002",
		},
		createdAt: 1_750_000_000_000,
		createdBy: "catalog-migration",
		verifiedAt: 1_750_000_000_100,
		verifiedBy: "catalog-migration",
		...overrides,
	};
}

function expectValidPrint(overrides: Partial<PrivatePrintSourceAsset> = {}) {
	expect(() => validatePrivatePrintSourceAsset(printSource(overrides))).not.toThrow();
}

function expectInvalidPrint(
	overrides: Partial<PrivatePrintSourceAsset>,
	message?: string | RegExp,
) {
	expect(() => validatePrivatePrintSourceAsset(printSource(overrides))).toThrow(message);
}

function expectValidPaidFile(overrides: Partial<PaidDigitalFileAsset> = {}) {
	expect(() => validatePaidDigitalFileAsset(paidFile(overrides))).not.toThrow();
}

function expectInvalidPaidFile(
	overrides: Partial<PaidDigitalFileAsset>,
	message?: string | RegExp,
) {
	expect(() => validatePaidDigitalFileAsset(paidFile(overrides))).toThrow(message);
}

describe("private catalog asset registry boundaries", () => {
	test("accepts complete verified print-source and paid-file metadata", () => {
		expectValidPrint();
		expectValidPrint({
			mimeType: "image/png",
			originalFilename: "gallery-master.png",
		});
		expectValidPaidFile();
	});

	test("keeps print masters and paid files in distinct tenant storage namespaces", () => {
		expectInvalidPrint(
			{
				privateObjectKey:
					"sites/angelsrest.online/catalog/paid-digital-files/catalog.print.source-001/original",
			},
			/print-sources boundary/i,
		);
		expectInvalidPaidFile(
			{
				privateObjectKey:
					"sites/angelsrest.online/catalog/print-sources/catalog.paid-file.theme-v1/original",
			},
			/paid-digital-files boundary/i,
		);
		expectInvalidPrint(
			{
				privateObjectKey:
					"sites/reflecting-pool.vercel.app/catalog/print-sources/catalog.print.source-001/original",
			},
			/tenant print-sources boundary/i,
		);
	});

	test("requires canonical tenant, identity, digest, timestamp, and actor metadata", () => {
		for (const invalid of [
			printSource({ siteUrl: "https://angelsrest.online" }),
			printSource({ siteUrl: "AngelsRest.online" }),
			printSource({ assetKey: "key/with/path" }),
			printSource({ sha256: "A".repeat(64) }),
			printSource({ sha256: "a".repeat(63) }),
			printSource({ createdAt: -1 }),
			printSource({ verifiedAt: 1_749_999_999_999 }),
			printSource({ createdBy: " " }),
		]) {
			expect(() => validatePrivatePrintSourceAsset(invalid)).toThrow();
		}
	});

	test("requires bounded positive bytes and dimensions for full-quality print sources", () => {
		expectValidPrint({
			sizeBytes: PRIVATE_CATALOG_ASSET_LIMITS.printSourceSizeBytes,
			widthPixels: PRIVATE_CATALOG_ASSET_LIMITS.imageDimensionPixels,
			heightPixels: PRIVATE_CATALOG_ASSET_LIMITS.imageDimensionPixels,
		});

		for (const invalid of [
			printSource({ sizeBytes: 0 }),
			printSource({ sizeBytes: 1.5 }),
			printSource({ sizeBytes: PRIVATE_CATALOG_ASSET_LIMITS.printSourceSizeBytes + 1 }),
			printSource({ widthPixels: 0 }),
			printSource({ heightPixels: PRIVATE_CATALOG_ASSET_LIMITS.imageDimensionPixels + 1 }),
		]) {
			expect(() => validatePrivatePrintSourceAsset(invalid)).toThrow(/bounded positive/i);
		}
	});

	test("uses a closed print-image MIME contract", () => {
		for (const mimeType of ["image/webp", "image/tiff", "application/zip"]) {
			expectInvalidPrint(
				{
					mimeType: mimeType as PrivatePrintSourceAsset["mimeType"],
				},
				/jpeg or png/i,
			);
		}
	});

	test("uses a closed paid-file MIME contract and ZIP filename", () => {
		expectValidPaidFile({
			sizeBytes: PRIVATE_CATALOG_ASSET_LIMITS.paidDigitalFileSizeBytes,
		});
		expectInvalidPaidFile(
			{
				mimeType: "application/pdf" as PaidDigitalFileAsset["mimeType"],
			},
			/supported safe mime/i,
		);
		expectInvalidPaidFile(
			{
				originalFilename: "time-aware-theme.exe",
			},
			/zip extension/i,
		);
		expectInvalidPaidFile(
			{
				sizeBytes: PRIVATE_CATALOG_ASSET_LIMITS.paidDigitalFileSizeBytes + 1,
			},
			/bounded positive/i,
		);
	});

	test("requires revisioned Sanity provenance and permits bounded editor-upload provenance", () => {
		expectValidPrint({
			provenance: {
				provider: "editor_upload",
				sourceId: "upload-receipt-001",
			},
		});
		expectInvalidPrint(
			{
				provenance: {
					provider: "sanity",
					sourceId: "image-source-001",
					sourceRevision: "",
				},
			},
			/source revision/i,
		);
		expectInvalidPrint(
			{
				provenance: {
					provider: "editor_upload",
					sourceId: "upload-receipt-001",
					sourceRevision: "not-allowed",
				} as PrivatePrintSourceAsset["provenance"],
			},
			/unsupported field sourceRevision/i,
		);
		expectInvalidPrint(
			{
				provenance: {
					provider: "unknown-provider",
					sourceId: "source-001",
				} as unknown as PrivatePrintSourceAsset["provenance"],
			},
			/provenance provider is unsupported/i,
		);
	});

	test("rejects path-like filenames and unsupported registry fields", () => {
		expectInvalidPrint(
			{
				originalFilename: "../master.jpg",
			},
			/path/i,
		);
		expect(() =>
			validatePaidDigitalFileAsset({
				...paidFile(),
				downloadGrant: "secret",
			} as PaidDigitalFileAsset),
		).toThrow(/unsupported field downloadGrant/i);
		expect(() =>
			validatePrivatePrintSourceAsset({
				...printSource(),
				providerUrl: "https://private.example.test/master.jpg",
			} as PrivatePrintSourceAsset),
		).toThrow(/unsupported field providerUrl/i);
	});
});

describe("Editor-safe private catalog asset projections", () => {
	test("projects useful print metadata without private location or provenance", () => {
		const projected = toEditorSafePrivatePrintSourceAsset({
			...printSource(),
			_id: "print-source-convex-id",
		});
		expect(projected).toEqual({
			kind: "print_source",
			assetId: "print-source-convex-id",
			status: "verified",
			originalFilename: "gallery-master.jpg",
			mimeType: "image/jpeg",
			sizeBytes: 40_000_000,
			widthPixels: 12_000,
			heightPixels: 8_000,
			createdAt: 1_750_000_000_000,
		});
		const serialized = JSON.stringify(projected);
		for (const forbidden of [
			"privateObjectKey",
			"sanity-revision",
			"sourceId",
			"sha256",
			"upload",
			"capability",
			"grant",
			"https://",
		]) {
			expect(serialized).not.toContain(forbidden);
		}
	});

	test("projects useful paid-file metadata without a download location or grant", () => {
		const projected = toEditorSafePaidDigitalFileAsset({
			...paidFile(),
			_id: "paid-file-convex-id",
		});
		expect(projected).toEqual({
			kind: "paid_digital_file",
			assetId: "paid-file-convex-id",
			status: "verified",
			originalFilename: "time-aware-theme-v1.0.0.zip",
			mimeType: "application/zip",
			sizeBytes: 15_064,
			version: "1.0.0",
			createdAt: 1_750_000_000_000,
		});
		const serialized = JSON.stringify(projected);
		for (const forbidden of [
			"privateObjectKey",
			"sanity-revision",
			"sourceId",
			"sha256",
			"upload",
			"download",
			"capability",
			"grant",
			"https://",
		]) {
			expect(serialized).not.toContain(forbidden);
		}
	});
});
