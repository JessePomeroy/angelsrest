/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { internal } from "./_generated/api";
import {
	createCatalogPrivateAssetV2CanarySnapshot,
	requireCatalogPrivateAssetV2CanaryInspectionReceipt,
	requireCatalogPrivateAssetV2CanaryStorageReceipt,
} from "./helpers/catalogPrivateAssetCanarySnapshot";
import type { CatalogPrivateAssetFacts } from "./helpers/catalogPrivateAssetReceiptContract";
import { createCatalogPrivateAssetReceiptSetId } from "./helpers/catalogPrivateAssetReceiptValidation";
import schema from "./schema";
import {
	INSPECTION_PATH,
	INSPECTION_SECRET_A,
	SITE_A,
	STORAGE_PATH,
	STORAGE_SECRET_A,
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
type TestClient = ReturnType<typeof convexTest>;

function exactFacts() {
	const prints = Array.from({ length: 11 }, (_, index) => {
		const identity = index.toString(16).padStart(40, "0");
		const extension = index === 1 ? "png" : "jpg";
		const width = index === 1 ? 6_935 : 2_160 + index;
		const height = index === 1 ? 4_623 : 1_440 + index;
		const assetKey = `image-${identity}-${width}x${height}-${extension}`;
		const facts = printFacts(assetKey, index.toString(16).repeat(64));
		facts.originalFilename = `${identity}-${width}x${height}.${extension}`;
		facts.mimeType = extension === "png" ? "image/png" : "image/jpeg";
		facts.widthPixels = width;
		facts.heightPixels = height;
		facts.sizeBytes = index === 1 ? 55_009_177 : 8_000_000 + index;
		facts.provenance = {
			provider: "sanity",
			sourceId: assetKey,
			sourceRevision: `source-revision-${index}`,
		};
		return facts;
	});
	return { prints, all: [...prints, paidFacts()] satisfies CatalogPrivateAssetFacts[] };
}

async function registerV1(t: TestClient, facts: CatalogPrivateAssetFacts[]) {
	const receiptSetId = await createCatalogPrivateAssetReceiptSetId(SITE_A, facts, 1);
	expect((await postReceipt(t, STORAGE_PATH, STORAGE_SECRET_A, storageSet(facts, receiptSetId))).status)
		.toBe(200);
	expect((await postReceipt(t, INSPECTION_PATH, INSPECTION_SECRET_A, inspectionSet(facts, receiptSetId))).status)
		.toBe(200);
	return receiptSetId;
}

async function fixture(t: TestClient) {
	const { prints, all } = exactFacts();
	const v1ReceiptSetId = await registerV1(t, all);
	const state = await storedState(t);
	const selectedFacts: CatalogPrivateAssetFacts[] = [prints[0]!, prints[1]!, all[11]!];
	const selected = selectedFacts.map((facts, index) => {
		const target = facts.kind === "print_source"
			? state.printSources.find((row) => row.assetKey === facts.assetKey)
			: state.paidFiles.find((row) => row.assetKey === facts.assetKey);
		if (!target) throw new Error("target fixture missing");
		return {
			label: (["jpeg", "oversized_png", "paid_zip"] as const)[index]!,
			kind: facts.kind,
			assetKey: facts.assetKey,
			targetId: target._id,
		};
	});
	return {
		all,
		selectedFacts,
		expectation: {
			siteUrl: SITE_A,
			v1ReceiptSetId,
			selected,
			expectedSharpVersion: "0.34.5",
			expectedLibvipsVersion: "8.17.3",
		},
	};
}

describe("catalog private asset canary snapshot", () => {
	test("redacts exact V1 state, exposes only stable internal mappings, and verifies V2 evidence", async () => {
		const t = convexTest(schema, modules);
		await withReceiptEnvironment(async () => {
			const setup = await fixture(t);
			await t.run(async (ctx) => {
				const authorities = await ctx.db.query("catalogPrivateAssetTargetAuthorities").take(20);
				for (const authority of authorities) await ctx.db.delete(authority._id);
			});
			const before = await t.run(async (ctx) =>
				await createCatalogPrivateAssetV2CanarySnapshot(ctx, setup.expectation)
			);
			expect(before.counts).toMatchObject({
				authorities: 0,
				printTargets: 11,
				paidTargets: 1,
				publicationPointers: 0,
			});
			expect(before.v2).toEqual({ status: "absent", evidence: null });
			const serialized = JSON.stringify(before);
			for (const forbidden of [
				setup.selectedFacts[0]!.assetKey,
				setup.selectedFacts[0]!.privateObjectKey,
				setup.selectedFacts[0]!.sha256,
				"originalFilename",
				"provenance",
				"createdBy",
				"https://",
			]) expect(serialized).not.toContain(forbidden);
			expect(before.canary.targets.map((target) => target.targetId))
				.toEqual(setup.expectation.selected.map((target) => target.targetId));

			expect(await t.mutation(internal.catalogPrivateAssets.backfillTargetAuthorities, {
				siteUrl: SITE_A,
				receiptSetId: setup.expectation.v1ReceiptSetId,
			})).toEqual({ replayed: false, targetCount: 12 });
			const afterBackfill = await t.run(async (ctx) =>
				await createCatalogPrivateAssetV2CanarySnapshot(ctx, setup.expectation)
			);
			expect(afterBackfill.counts.authorities).toBe(12);
			expect(afterBackfill.digests.registryTargets).toBe(before.digests.registryTargets);

			const v2ReceiptSetId = await createCatalogPrivateAssetReceiptSetId(
				SITE_A,
				setup.selectedFacts,
				2,
			);
			expect((await postReceipt(
				t,
				STORAGE_PATH,
				STORAGE_SECRET_A,
				storageSetV2(v2ReceiptSetId, setup.selectedFacts),
			)).status).toBe(200);
			const pending = await t.run(async (ctx) =>
				await createCatalogPrivateAssetV2CanarySnapshot(ctx, setup.expectation)
			);
			expect(pending.v2.status).toBe("pending_inspection");
			expect((await postReceipt(
				t,
				INSPECTION_PATH,
				INSPECTION_SECRET_A,
				inspectionSetV2(v2ReceiptSetId, setup.selectedFacts),
			)).status).toBe(200);
			const verified = await t.run(async (ctx) =>
				await createCatalogPrivateAssetV2CanarySnapshot(ctx, setup.expectation)
			);
			expect(verified.v2).toEqual({
				status: "verified",
				evidence: {
					fullRaster: true,
					safeZip: true,
					sharpVersion: "0.34.5",
					libvipsVersion: "8.17.3",
				},
			});
			expect(verified.digests.registryTargets).toBe(before.digests.registryTargets);
			expect(verified.digests.authorities).toBe(afterBackfill.digests.authorities);
		});
	});

	test("rejects drifted identity and decoder versions before receipt mutation", async () => {
		const t = convexTest(schema, modules);
		await withReceiptEnvironment(async () => {
			const setup = await fixture(t);
			const receiptSetId = await createCatalogPrivateAssetReceiptSetId(
				SITE_A,
				setup.selectedFacts,
				2,
			);
			const wrongIdentity = storageSetV2(
				`catalog-private-assets-v2:${"0".repeat(64)}`,
				setup.selectedFacts,
			);
			await expect(
				t.run(async (ctx) =>
					await requireCatalogPrivateAssetV2CanaryStorageReceipt(
						ctx,
						wrongIdentity,
						setup.expectation,
					)
				),
			).rejects.toThrow(/identity differs/);

			const wrongDecoder = inspectionSetV2(receiptSetId, setup.selectedFacts);
			for (const receipt of wrongDecoder.receipts) {
				if (
					receipt.facts.kind === "print_source" &&
					receipt.inspection.method === "sharp_libvips_full_raster_v1"
				) {
					receipt.inspection.sharpVersion = "0.35.3";
				}
			}
			await expect(
				t.run(async (ctx) =>
					await requireCatalogPrivateAssetV2CanaryInspectionReceipt(
						ctx,
						wrongDecoder,
						setup.expectation,
					)
				),
			).rejects.toThrow(/decoder versions differ/);
			expect((await storedState(t)).coordinations).toHaveLength(1);
		});
	});

	test("fails closed when a bounded catalog table exceeds its production ceiling", async () => {
		const t = convexTest(schema, modules);
		await withReceiptEnvironment(async () => {
			const setup = await fixture(t);
			await t.run(async (ctx) => {
				for (let index = 0; index < 41; index += 1) {
					await ctx.db.insert("catalogProducts", {
						siteUrl: SITE_A,
						productKey: `overflow-${index}`,
						productKind: "print",
						createdAt: index,
						createdBy: "fixture",
						updatedAt: index,
						updatedBy: "fixture",
					});
				}
			});
			await expect(t.run(async (ctx) =>
				await createCatalogPrivateAssetV2CanarySnapshot(ctx, setup.expectation)
			)).rejects.toThrow(/product table.*bound/i);
		});
	});

	test("fails closed for partial authority and corrupted full-raster evidence", async () => {
		const t = convexTest(schema, modules);
		await withReceiptEnvironment(async () => {
			const setup = await fixture(t);
			const state = await storedState(t);
			await t.run(async (ctx) => await ctx.db.delete(state.authorities[0]!._id));
			await expect(t.run(async (ctx) =>
				await createCatalogPrivateAssetV2CanarySnapshot(ctx, setup.expectation)
			)).rejects.toThrow(/authority baseline is partial/);
		});

		const corrupted = convexTest(schema, modules);
		await withReceiptEnvironment(async () => {
			const setup = await fixture(corrupted);
			const receiptSetId = await createCatalogPrivateAssetReceiptSetId(
				SITE_A,
				setup.selectedFacts,
				2,
			);
			await postReceipt(
				corrupted,
				STORAGE_PATH,
				STORAGE_SECRET_A,
				storageSetV2(receiptSetId, setup.selectedFacts),
			);
			await postReceipt(
				corrupted,
				INSPECTION_PATH,
				INSPECTION_SECRET_A,
				inspectionSetV2(receiptSetId, setup.selectedFacts),
			);
			const state = await storedState(corrupted);
			const v2 = state.coordinations.find((row) => row.receiptSetId === receiptSetId);
			if (!v2 || v2.status !== "verified" || v2.inspectionReceiptSet.schemaVersion !== 2) {
				throw new Error("verified V2 fixture missing");
			}
			const inspectionReceiptSet = structuredClone(v2.inspectionReceiptSet);
			const print = inspectionReceiptSet.receipts[0];
			if (!print || print.inspection.method !== "sharp_libvips_full_raster_v1") {
				throw new Error("full-raster fixture missing");
			}
			print.inspection.decodedByteCount -= 1;
			await corrupted.run(async (ctx) => {
				await ctx.db.patch(v2._id, { inspectionReceiptSet });
			});
			await expect(corrupted.run(async (ctx) =>
				await createCatalogPrivateAssetV2CanarySnapshot(ctx, setup.expectation)
			)).rejects.toThrow(/pixel byte/);
		});
	});
});
