/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import {
	CATALOG_PRIVATE_ASSET_RECEIPT_SET_V2_VERSION,
	type CatalogPrivateAssetFacts,
} from "./helpers/catalogPrivateAssetReceiptContract";
import {
	createCatalogPrivateAssetReceiptSetId,
	privateCatalogRegistrationTarget,
	validateCatalogPrivateInspectionReceiptSet,
	validateCatalogPrivateStorageReceiptSet,
} from "./helpers/catalogPrivateAssetReceiptValidation";
import schema from "./schema";
import {
	DEFAULT_RECEIPT_SET_ID,
	INSPECTION_PATH,
	INSPECTION_SECRET_A,
	STORAGE_PATH,
	STORAGE_SECRET_A,
	STORAGE_SECRET_B,
	SITE_A,
	inspectionSet,
	inspectionSetV2,
	paidFacts,
	postReceipt,
	printFacts,
	storageSet,
	storageSetV2,
	storedState,
	withReceiptEnvironment,
} from "../test/catalogPrivateAssetReceiptFixtures";

const modules = import.meta.glob("./**/*.ts");

function v2PrintInspection(receiptSet: ReturnType<typeof inspectionSetV2>) {
	const receipt = receiptSet.receipts[0];
	if (
		!receipt
		|| receipt.facts.kind !== "print_source"
		|| receipt.inspection.method !== "sharp_libvips_full_raster_v1"
	) throw new Error("V2 print fixture drift");
	return receipt.inspection;
}

describe("private catalog dual-receipt registration", () => {
	test("binds the deterministic receipt identity to exact canonical asset membership", async () => {
		const defaultFacts = [printFacts(), paidFacts()];
		expect(await createCatalogPrivateAssetReceiptSetId(SITE_A, defaultFacts))
			.toBe(DEFAULT_RECEIPT_SET_ID);
		expect(await createCatalogPrivateAssetReceiptSetId(SITE_A, [...defaultFacts].reverse()))
			.toBe(DEFAULT_RECEIPT_SET_ID);

		const t = convexTest(schema, modules);
		const extraPrint = printFacts(
			`image-${"c".repeat(40)}-6000x4000-jpg`,
			"c".repeat(64),
		);
		await withReceiptEnvironment(async () => {
			for (const facts of [
				[defaultFacts[0]!],
				[defaultFacts[0]!, extraPrint, defaultFacts[1]!],
			]) {
				const response = await postReceipt(
					t,
					STORAGE_PATH,
					STORAGE_SECRET_A,
					storageSet(facts, DEFAULT_RECEIPT_SET_ID),
				);
				expect(response.status).toBe(409);
			}
		});
		expect((await storedState(t)).coordinations).toHaveLength(0);
	});

	test("locks V1 canonical identity and V1/V2 role checksum vectors", async () => {
		const facts = [printFacts(), paidFacts()];
		const v2ReceiptSetId = await createCatalogPrivateAssetReceiptSetId(SITE_A, facts, 2);
		const [v1Storage, v1Inspection, v2Storage, v2Inspection] = await Promise.all([
			validateCatalogPrivateStorageReceiptSet(storageSet()),
			validateCatalogPrivateInspectionReceiptSet(inspectionSet()),
			validateCatalogPrivateStorageReceiptSet(storageSetV2(v2ReceiptSetId, facts)),
			validateCatalogPrivateInspectionReceiptSet(inspectionSetV2(v2ReceiptSetId, facts)),
		]);
		const v1AssetCanonical = "{\"schemaVersion\":1,\"siteUrl\":\"site-a.example\",\"assets\":[{\"kind\":\"print_source\",\"assetKey\":\"image-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-6000x4000-jpg\",\"privateObjectKey\":\"sites/site-a.example/catalog/print-sources/image-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-6000x4000-jpg/original\",\"originalFilename\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-6000x4000.jpg\",\"mimeType\":\"image/jpeg\",\"sizeBytes\":8000000,\"widthPixels\":6000,\"heightPixels\":4000,\"sha256\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\"provenance\":{\"provider\":\"sanity\",\"sourceId\":\"image-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-6000x4000-jpg\",\"sourceRevision\":\"print-source-revision-1\"}},{\"kind\":\"paid_digital_file\",\"assetKey\":\"file-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb-zip\",\"privateObjectKey\":\"sites/site-a.example/catalog/paid-digital-files/file-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb-zip/original\",\"originalFilename\":\"time-aware-theme.zip\",\"mimeType\":\"application/zip\",\"sizeBytes\":15064,\"version\":\"1.0.0\",\"sha256\":\"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\",\"provenance\":{\"provider\":\"sanity\",\"sourceId\":\"file-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb-zip\",\"sourceRevision\":\"paid-file-revision-1\"}}]}";

		expect(v1Storage.assetCanonical).toBe(v1AssetCanonical);
		expect(v1Inspection.assetCanonical).toBe(v1AssetCanonical);
		expect({
			v1Asset: v1Storage.assetSetChecksum,
			v1Storage: v1Storage.roleChecksum,
			v1Inspection: v1Inspection.roleChecksum,
			v2Asset: v2Storage.assetSetChecksum,
			v2Storage: v2Storage.roleChecksum,
			v2Inspection: v2Inspection.roleChecksum,
		}).toEqual({
			v1Asset: "df78d059f07865559876bf34204bd8f59dcaf385bdf6735193f5549f32107b2c",
			v1Storage: "8089204fd88518f79072b27627f16f538eb09521a1ff110e654ccc58792d8671",
			v1Inspection: "b56304472195ab0c8fe635a5c0235cbd22893070a0161b2d6214994f79dd2a2e",
			v2Asset: "14ba0d80cf2d12314f848d7323ad5284b1ec60b3d4d35521074e171ad0ad6455",
			v2Storage: "dcef6fc9989382a40775abae7f3d81dca8853eb6b6d12935ca1acca8f5d85672",
			v2Inspection: "2d49a9a2539b3cd12dd7d955fff10103f73c85e832f6dcfd78cb45139e38657c",
		});
		expect(v2Inspection.canonical).toContain(
			'\"inspection\":{\"method\":\"sharp_libvips_full_raster_v1\",\"decodedFormat\":\"jpeg\",\"decodedWidthPixels\":6000,\"decodedHeightPixels\":4000,\"decodedChannels\":3,\"decodedPageCount\":1,\"decodedDepth\":\"uchar\",\"decodedPixelCount\":24000000,\"decodedByteCount\":72000000,\"rasterSha256\":\"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc\",\"sharpVersion\":\"0.34.5\",\"libvipsVersion\":\"8.17.3\"}',
		);
	});

	test("accepts V2 only when the trusted inspector attests a complete raster decode", async () => {
		const t = convexTest(schema, modules);
		const facts = [printFacts(), paidFacts()];
		const receiptSetId = await createCatalogPrivateAssetReceiptSetId(
			SITE_A,
			facts,
			CATALOG_PRIVATE_ASSET_RECEIPT_SET_V2_VERSION,
		);
		expect(receiptSetId).toMatch(/^catalog-private-assets-v2:[a-f0-9]{64}$/);

		await withReceiptEnvironment(async () => {
			const stored = await postReceipt(
				t,
				STORAGE_PATH,
				STORAGE_SECRET_A,
				storageSetV2(receiptSetId, facts),
			);
			expect(await stored.json()).toEqual({
				status: "pending_inspection",
				replayed: false,
				assetCount: 2,
			});

			const legacyInspection = inspectionSet(facts, receiptSetId);
			expect((await postReceipt(
				t,
				INSPECTION_PATH,
				INSPECTION_SECRET_A,
				legacyInspection,
			)).status).toBe(409);

			const invalidInspections = [
				(inspection: ReturnType<typeof inspectionSetV2>) => {
					v2PrintInspection(inspection).decodedPixelCount -= 1;
				},
				(inspection: ReturnType<typeof inspectionSetV2>) => {
					v2PrintInspection(inspection).decodedWidthPixels -= 1;
				},
				(inspection: ReturnType<typeof inspectionSetV2>) => {
					v2PrintInspection(inspection).decodedPixelCount = Number.MAX_SAFE_INTEGER;
				},
				(inspection: ReturnType<typeof inspectionSetV2>) => {
					v2PrintInspection(inspection).decodedByteCount -= 1;
				},
				(inspection: ReturnType<typeof inspectionSetV2>) => {
					v2PrintInspection(inspection).rasterSha256 = "not-a-raster-checksum";
				},
				(inspection: ReturnType<typeof inspectionSetV2>) => {
					v2PrintInspection(inspection).decodedFormat = "png";
				},
				(inspection: ReturnType<typeof inspectionSetV2>) => {
					v2PrintInspection(inspection).decodedHeightPixels -= 1;
				},
				(inspection: ReturnType<typeof inspectionSetV2>) => {
					v2PrintInspection(inspection).sharpVersion = "latest";
				},
				(inspection: ReturnType<typeof inspectionSetV2>) => {
					Reflect.set(v2PrintInspection(inspection), "decodedPageCount", 2);
				},
				(inspection: ReturnType<typeof inspectionSetV2>) => {
					Reflect.set(v2PrintInspection(inspection), "decodedDepth", "ushort");
				},
				(inspection: ReturnType<typeof inspectionSetV2>) => {
					Reflect.set(v2PrintInspection(inspection), "method", "decoded_image_v1");
				},
			];
			for (const invalidate of invalidInspections) {
				const invalid = inspectionSetV2(receiptSetId, facts);
				invalidate(invalid);
				expect((await postReceipt(
					t,
					INSPECTION_PATH,
					INSPECTION_SECRET_A,
					invalid,
				)).status).toBe(409);
				expect((await storedState(t)).printSources).toHaveLength(0);
			}

			const inspected = await postReceipt(
				t,
				INSPECTION_PATH,
				INSPECTION_SECRET_A,
				inspectionSetV2(receiptSetId, facts),
			);
			expect(await inspected.json()).toMatchObject({
				status: "verified",
				replayed: false,
			});
			const state = await storedState(t);
			expect(state.coordinations).toHaveLength(1);
			expect(state.printSources).toHaveLength(1);
			expect(state.paidFiles).toHaveLength(1);
			const verifiedState = JSON.stringify(state);

			for (const [path, secret, receiptSet] of [
				[INSPECTION_PATH, INSPECTION_SECRET_A, inspectionSetV2(receiptSetId, facts)],
				[STORAGE_PATH, STORAGE_SECRET_A, storageSetV2(receiptSetId, facts)],
			] as const) {
				const replay = await postReceipt(t, path, secret, receiptSet);
				expect(await replay.json()).toMatchObject({ status: "verified", replayed: true });
				expect(JSON.stringify(await storedState(t))).toBe(verifiedState);
			}

			const rasterDrift = inspectionSetV2(receiptSetId, facts);
			v2PrintInspection(rasterDrift).rasterSha256 = "d".repeat(64);
			expect((await postReceipt(
				t,
				INSPECTION_PATH,
				INSPECTION_SECRET_A,
				rasterDrift,
			)).status).toBe(409);
			expect(JSON.stringify(await storedState(t))).toBe(verifiedState);
		});
	});

	test("accepts complete V2 PNG rasters with every supported uchar channel count", async () => {
		for (const channels of [1, 2, 4] as const) {
			const png = printFacts(`image-${String(channels).repeat(40)}-32x16-png`, String(channels).repeat(64));
			png.privateObjectKey = `sites/${SITE_A}/catalog/print-sources/${png.assetKey}/original`;
			png.originalFilename = `${String(channels).repeat(40)}-32x16.png`;
			png.mimeType = "image/png";
			png.widthPixels = 32;
			png.heightPixels = 16;
			png.provenance.sourceId = png.assetKey;
			const receiptSetId = await createCatalogPrivateAssetReceiptSetId(SITE_A, [png], 2);
			const receiptSet = inspectionSetV2(receiptSetId, [png]);
			const raster = v2PrintInspection(receiptSet);
			raster.decodedChannels = channels;
			raster.decodedByteCount = raster.decodedPixelCount * channels;

			await expect(validateCatalogPrivateInspectionReceiptSet(receiptSet)).resolves.toMatchObject({
				assetSetChecksum: receiptSetId.slice("catalog-private-assets-v2:".length),
			});
		}
	});

	test("keeps safe_zip_v1 usable for a paid-only V2 set and rejects unsafe ZIP evidence", async () => {
		const facts = [paidFacts()];
		const receiptSetId = await createCatalogPrivateAssetReceiptSetId(SITE_A, facts, 2);
		const unsafe = inspectionSetV2(receiptSetId, facts);
		const unsafePaid = unsafe.receipts[0];
		if (!unsafePaid || unsafePaid.inspection.method !== "safe_zip_v1") {
			throw new Error("V2 paid fixture drift");
		}
		unsafePaid.inspection.unsafePathCount = 1;

		const t = convexTest(schema, modules);
		await withReceiptEnvironment(async () => {
			expect((await postReceipt(
				t,
				INSPECTION_PATH,
				INSPECTION_SECRET_A,
				unsafe,
			)).status).toBe(409);
			expect((await storedState(t)).coordinations).toHaveLength(0);

			expect((await postReceipt(
				t,
				INSPECTION_PATH,
				INSPECTION_SECRET_A,
				inspectionSetV2(receiptSetId, facts),
			)).status).toBe(200);
			const completed = await postReceipt(
				t,
				STORAGE_PATH,
				STORAGE_SECRET_A,
				storageSetV2(receiptSetId, facts),
			);
			expect(await completed.json()).toMatchObject({ status: "verified", replayed: false });
			const state = await storedState(t);
			expect(state.printSources).toHaveLength(0);
			expect(state.paidFiles).toHaveLength(1);
		});
	});

	test("keeps the first complete receipt set pending and atomically registers the matching set", async () => {
		const t = convexTest(schema, modules);
		await withReceiptEnvironment(async () => {
			const stored = await postReceipt(t, STORAGE_PATH, STORAGE_SECRET_A, storageSet());
			expect(stored.status).toBe(200);
			expect(await stored.json()).toEqual({
				status: "pending_inspection",
				replayed: false,
				assetCount: 2,
			});
			const pending = await storedState(t);
			expect(pending.coordinations).toHaveLength(1);
			expect(pending.printSources).toHaveLength(0);
			expect(pending.paidFiles).toHaveLength(0);

			const storageReplay = await postReceipt(t, STORAGE_PATH, STORAGE_SECRET_A, storageSet());
			expect(await storageReplay.json()).toEqual({
				status: "pending_inspection",
				replayed: true,
				assetCount: 2,
			});

			const inspected = await postReceipt(
				t,
				INSPECTION_PATH,
				INSPECTION_SECRET_A,
				inspectionSet(),
			);
			expect(inspected.status).toBe(200);
			const result = await inspected.json() as Record<string, unknown>;
			expect(Object.keys(result).sort()).toEqual(["replayed", "status", "targets"]);
			expect(result.status).toBe("verified");
			expect(result.replayed).toBe(false);
			const targets = result.targets as Array<Record<string, unknown>>;
			expect(targets).toHaveLength(2);
			for (const target of targets) {
				expect(Object.keys(target).sort()).toEqual(["assetId", "assetKey", "kind"]);
				expect(target).not.toHaveProperty("privateObjectKey");
				expect(target).not.toHaveProperty("sha256");
				expect(target).not.toHaveProperty("provenance");
			}
			const verified = await storedState(t);
			expect(verified.coordinations).toHaveLength(1);
			expect(verified.coordinations[0]?.status).toBe("verified");
			expect(verified.printSources).toHaveLength(1);
			expect(verified.paidFiles).toHaveLength(1);
			expect(verified.printSources[0]?.status).toBe("verified");
			expect(verified.paidFiles[0]?.status).toBe("verified");

			const beforeReplay = JSON.stringify(verified);
			const inspectionReplay = await postReceipt(
				t,
				INSPECTION_PATH,
				INSPECTION_SECRET_A,
				inspectionSet(),
			);
			expect(await inspectionReplay.json()).toMatchObject({
				status: "verified",
				replayed: true,
				targets,
			});
			expect(JSON.stringify(await storedState(t))).toBe(beforeReplay);
		});
	});

	test("accepts the independent inspection role first", async () => {
		const t = convexTest(schema, modules);
		await withReceiptEnvironment(async () => {
			const inspected = await postReceipt(
				t,
				INSPECTION_PATH,
				INSPECTION_SECRET_A,
				inspectionSet(),
			);
			expect(await inspected.json()).toEqual({
				status: "pending_storage",
				replayed: false,
				assetCount: 2,
			});
			const reordered = inspectionSet();
			const paidInspection = reordered.receipts[1];
			if (!paidInspection || paidInspection.inspection.method !== "safe_zip_v1") {
				throw new Error("fixture drift");
			}
			paidInspection.inspection = {
				duplicatePathCount: paidInspection.inspection.duplicatePathCount,
				unsafePathCount: paidInspection.inspection.unsafePathCount,
				method: paidInspection.inspection.method,
				encryptedEntryCount: paidInspection.inspection.encryptedEntryCount,
				maximumEntryCompressionRatio:
					paidInspection.inspection.maximumEntryCompressionRatio,
				totalUncompressedBytes: paidInspection.inspection.totalUncompressedBytes,
				entryCount: paidInspection.inspection.entryCount,
			};
			const replay = await postReceipt(
				t,
				INSPECTION_PATH,
				INSPECTION_SECRET_A,
				reordered,
			);
			expect(await replay.json()).toEqual({
				status: "pending_storage",
				replayed: true,
				assetCount: 2,
			});
			expect((await storedState(t)).printSources).toHaveLength(0);

			const stored = await postReceipt(t, STORAGE_PATH, STORAGE_SECRET_A, storageSet());
			expect(await stored.json()).toMatchObject({ status: "verified", replayed: false });
			const state = await storedState(t);
			expect(state.printSources).toHaveLength(1);
			expect(state.paidFiles).toHaveLength(1);
		});
	});

	test("registers the current 11-print and one-paid-file migration set as one transaction", async () => {
		const t = convexTest(schema, modules);
		const prints = Array.from({ length: 11 }, (_, index) => {
			const identity = index.toString(16).padStart(40, "0");
			const assetKey = `image-${identity}-6000x4000-jpg`;
			const facts = printFacts(assetKey, index.toString(16).repeat(64));
			facts.originalFilename = `${identity}-6000x4000.jpg`;
			facts.provenance = {
				provider: "sanity",
				sourceId: assetKey,
				sourceRevision: `print-source-revision-${index}`,
			};
			return facts;
		});
		const completeSet: CatalogPrivateAssetFacts[] = [...prints, paidFacts()];
		const receiptSetId = await createCatalogPrivateAssetReceiptSetId(SITE_A, completeSet);
		await withReceiptEnvironment(async () => {
			const first = await postReceipt(
				t,
				STORAGE_PATH,
				STORAGE_SECRET_A,
				storageSet(completeSet, receiptSetId),
			);
			expect(await first.json()).toEqual({
				status: "pending_inspection",
				replayed: false,
				assetCount: 12,
			});
			const second = await postReceipt(
				t,
				INSPECTION_PATH,
				INSPECTION_SECRET_A,
				inspectionSet(completeSet, receiptSetId),
			);
			const result = await second.json() as { status: string; targets: unknown[] };
			expect(result.status).toBe("verified");
			expect(result.targets).toHaveLength(12);
			const state = await storedState(t);
			expect(state.printSources).toHaveLength(11);
			expect(state.paidFiles).toHaveLength(1);
		});
	});

	test("fails closed for missing, foreign, wrong-role, or reused credentials", async () => {
		const t = convexTest(schema, modules);
		await withReceiptEnvironment(async () => {
			for (const secret of ["wrong-secret-that-is-at-least-32-characters", STORAGE_SECRET_B]) {
				const response = await postReceipt(t, STORAGE_PATH, secret, storageSet());
				expect(response.status).toBe(401);
			}
			const wrongRole = await postReceipt(t, STORAGE_PATH, INSPECTION_SECRET_A, storageSet());
			expect(wrongRole.status).toBe(401);
		});
		expect((await storedState(t)).coordinations).toHaveLength(0);

		await withReceiptEnvironment(async () => {
			const overlap = await postReceipt(t, STORAGE_PATH, STORAGE_SECRET_A, storageSet());
			expect(overlap.status).toBe(503);
		}, {
			inspection: JSON.stringify({ [SITE_A]: [STORAGE_SECRET_A] }),
		});
		expect((await storedState(t)).coordinations).toHaveLength(0);

		await withReceiptEnvironment(async () => {
			delete process.env.CATALOG_PRIVATE_ASSET_INSPECTION_RECEIPT_SECRETS;
			const missing = await postReceipt(t, STORAGE_PATH, STORAGE_SECRET_A, storageSet());
			expect(missing.status).toBe(503);
		});
		expect((await storedState(t)).coordinations).toHaveLength(0);
	});

	test("rejects receipt drift without changing the pending set", async () => {
		const t = convexTest(schema, modules);
		await withReceiptEnvironment(async () => {
			const original = storageSet();
			expect((await postReceipt(t, STORAGE_PATH, STORAGE_SECRET_A, original)).status).toBe(200);
			const pending = JSON.stringify(await storedState(t));

			const storageDrift = storageSet();
			storageDrift.receipts[0]!.etag = "changed-etag";
			expect((await postReceipt(t, STORAGE_PATH, STORAGE_SECRET_A, storageDrift)).status).toBe(409);
			expect(JSON.stringify(await storedState(t))).toBe(pending);

			const inspectionDrift = inspectionSet();
			inspectionDrift.receipts[0]!.facts.sha256 = "c".repeat(64);
			expect((await postReceipt(
				t,
				INSPECTION_PATH,
				INSPECTION_SECRET_A,
				inspectionDrift,
			)).status).toBe(409);
			expect(JSON.stringify(await storedState(t))).toBe(pending);

			const unsafeZip = inspectionSet();
			const paid = unsafeZip.receipts[1];
			if (!paid || paid.inspection.method !== "safe_zip_v1") throw new Error("fixture drift");
			paid.inspection.unsafePathCount = 1;
			expect((await postReceipt(
				t,
				INSPECTION_PATH,
				INSPECTION_SECRET_A,
				unsafeZip,
			)).status).toBe(409);
			expect(JSON.stringify(await storedState(t))).toBe(pending);
		});
	});

	test("allows distinct asset keys to preserve identity even when bytes are identical", async () => {
		const t = convexTest(schema, modules);
		const sharedSha = "d".repeat(64);
		const first = printFacts(
			"image-cccccccccccccccccccccccccccccccccccccccc-6000x4000-jpg",
			sharedSha,
		);
		const second = printFacts(
			"image-dddddddddddddddddddddddddddddddddddddddd-6000x4000-jpg",
			sharedSha,
		);
		second.originalFilename = "dddddddddddddddddddddddddddddddddddddddd-6000x4000.jpg";
		second.provenance = {
			provider: "sanity",
			sourceId: second.assetKey,
			sourceRevision: "print-source-revision-2",
		};
		const facts = [first, second];
		const receiptSetId = await createCatalogPrivateAssetReceiptSetId(SITE_A, facts);
		await withReceiptEnvironment(async () => {
			expect((await postReceipt(
				t,
				STORAGE_PATH,
				STORAGE_SECRET_A,
				storageSet(facts, receiptSetId),
			)).status).toBe(200);
			expect((await postReceipt(
				t,
				INSPECTION_PATH,
				INSPECTION_SECRET_A,
				inspectionSet(facts, receiptSetId),
			)).status).toBe(200);
			const state = await storedState(t);
			expect(state.printSources).toHaveLength(2);
			expect(new Set(state.printSources.map((asset) => asset._id)).size).toBe(2);
			expect(new Set(state.printSources.map((asset) => asset.sha256))).toEqual(new Set([sharedSha]));
		});
	});

	test("rejects any uncoordinated preexisting target instead of aliasing it", async () => {
		const t = convexTest(schema, modules);
		await t.run(async (ctx) => {
			const target = privateCatalogRegistrationTarget(SITE_A, printFacts(), {
				createdAt: 1,
				createdBy: "legacy-test",
				verifiedAt: 1,
				verifiedBy: "legacy-test",
			});
			if (target.kind !== "print_source") throw new Error("fixture kind mismatch");
			await ctx.db.insert("catalogPrintSourceAssets", target.asset);
		});
		await withReceiptEnvironment(async () => {
			const response = await postReceipt(t, STORAGE_PATH, STORAGE_SECRET_A, storageSet());
			expect(response.status).toBe(409);
		});
		const state = await storedState(t);
		expect(state.coordinations).toHaveLength(0);
		expect(state.printSources).toHaveLength(1);
		expect(state.paidFiles).toHaveLength(0);
	});
});
