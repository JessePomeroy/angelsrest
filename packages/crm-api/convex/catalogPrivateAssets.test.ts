/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import type { CatalogPrivateAssetFacts } from "./helpers/catalogPrivateAssetReceiptContract";
import {
	createCatalogPrivateAssetReceiptSetId,
	privateCatalogRegistrationTarget,
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
	paidFacts,
	postReceipt,
	printFacts,
	storageSet,
	storedState,
	withReceiptEnvironment,
} from "../test/catalogPrivateAssetReceiptFixtures";

const modules = import.meta.glob("./**/*.ts");

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
