/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { internal } from "./_generated/api";
import type {
	CatalogPrivateAssetFacts,
	CatalogPrivateAssetTargetBinding,
} from "./helpers/catalogPrivateAssetReceiptContract";
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

function twelveAssetFacts() {
	const prints = Array.from({ length: 11 }, (_, index) => {
		const identity = index.toString(16).padStart(40, "0");
		const extension = index === 0 ? "png" : "jpg";
		const assetKey = `image-${identity}-6000x4000-${extension}`;
		const facts = printFacts(assetKey, index.toString(16).repeat(64));
		facts.originalFilename = `${identity}-6000x4000.${extension}`;
		facts.mimeType = index === 0 ? "image/png" : "image/jpeg";
		facts.provenance = {
			provider: "sanity",
			sourceId: assetKey,
			sourceRevision: `print-source-revision-${index}`,
		};
		return facts;
	});
	return { prints, facts: [...prints, paidFacts()] satisfies CatalogPrivateAssetFacts[] };
}

async function registerV1(t: TestClient, facts: CatalogPrivateAssetFacts[]) {
	const receiptSetId = await createCatalogPrivateAssetReceiptSetId(SITE_A, facts, 1);
	const first = await postReceipt(
		t,
		STORAGE_PATH,
		STORAGE_SECRET_A,
		storageSet(facts, receiptSetId),
	);
	const second = await postReceipt(
		t,
		INSPECTION_PATH,
		INSPECTION_SECRET_A,
		inspectionSet(facts, receiptSetId),
	);
	expect(first.status).toBe(200);
	expect(second.status).toBe(200);
	return receiptSetId;
}

async function catalogPublicState(t: TestClient) {
	return await t.run(async (ctx) => ({
		products: await ctx.db.query("catalogProducts").take(40),
		revisions: await ctx.db.query("catalogProductRevisions").take(40),
		printSources: await ctx.db.query("catalogProductPrintSources").take(40),
		digitalFiles: await ctx.db.query("catalogProductDigitalFiles").take(40),
		setMembers: await ctx.db.query("catalogProductSetMembers").take(40),
		shopPlacements: await ctx.db.query("catalogProductShopPlacements").take(40),
	}));
}

async function deleteAuthorities(t: TestClient) {
	await t.run(async (ctx) => {
		const rows = await ctx.db.query("catalogPrivateAssetTargetAuthorities").take(40);
		for (const row of rows) await ctx.db.delete(row._id);
	});
}

async function completeV2(
	t: TestClient,
	facts: CatalogPrivateAssetFacts[],
	firstRole: "storage" | "inspection",
) {
	const receiptSetId = await createCatalogPrivateAssetReceiptSetId(SITE_A, facts, 2);
	const storage = storageSetV2(receiptSetId, facts);
	const inspection = inspectionSetV2(receiptSetId, facts);
	const first = firstRole === "storage"
		? await postReceipt(t, STORAGE_PATH, STORAGE_SECRET_A, storage)
		: await postReceipt(t, INSPECTION_PATH, INSPECTION_SECRET_A, inspection);
	const pendingState = JSON.stringify(await storedState(t));
	const retry = firstRole === "storage"
		? await postReceipt(t, STORAGE_PATH, STORAGE_SECRET_A, storage)
		: await postReceipt(t, INSPECTION_PATH, INSPECTION_SECRET_A, inspection);
	expect(await retry.json()).toMatchObject({ replayed: true });
	expect(JSON.stringify(await storedState(t))).toBe(pendingState);
	const second = firstRole === "storage"
		? await postReceipt(t, INSPECTION_PATH, INSPECTION_SECRET_A, inspection)
		: await postReceipt(t, STORAGE_PATH, STORAGE_SECRET_A, storage);
	return { receiptSetId, storage, inspection, first, second };
}

function v2PrintInspection(receiptSet: ReturnType<typeof inspectionSetV2>) {
	const receipt = receiptSet.receipts.find((item) => item.facts.kind === "print_source");
	if (!receipt || receipt.inspection.method !== "sharp_libvips_full_raster_v1") {
		throw new Error("V2 print inspection fixture missing");
	}
	return receipt.inspection;
}

describe("stable-target V2 re-attestation", () => {
	test("backfills a historical 12-target V1 set and reuses a JPEG, PNG, and ZIP with zero target or public-state rewrites", async () => {
		const t = convexTest(schema, modules);
		const { prints, facts } = twelveAssetFacts();
		await withReceiptEnvironment(async () => {
			const v1ReceiptSetId = await registerV1(t, facts);
			const original = await storedState(t);
			const originalV1 = original.coordinations.find((row) =>
				row.receiptSetId === v1ReceiptSetId
			);
			expect(originalV1?.status).toBe("verified");
			const originalTargets = JSON.stringify({
				printSources: original.printSources,
				paidFiles: original.paidFiles,
			});

			// Simulate the exact pre-contract production shape, then materialize only
			// the truthful reverse authority index.
			await deleteAuthorities(t);
			const backfill = await t.mutation(
				internal.catalogPrivateAssets.backfillTargetAuthorities,
				{ siteUrl: SITE_A, receiptSetId: v1ReceiptSetId },
			);
			expect(backfill).toEqual({ replayed: false, targetCount: 12 });
			const indexedState = JSON.stringify(await storedState(t));
			expect(await t.mutation(
				internal.catalogPrivateAssets.backfillTargetAuthorities,
				{ siteUrl: SITE_A, receiptSetId: v1ReceiptSetId },
			)).toEqual({ replayed: true, targetCount: 12 });
			expect(JSON.stringify(await storedState(t))).toBe(indexedState);

			const publicBefore = JSON.stringify(await catalogPublicState(t));
			const subset: CatalogPrivateAssetFacts[] = [
				structuredClone(prints[0]!),
				structuredClone(prints[1]!),
				paidFacts(),
			];
			const firstProvenance = subset[0]!.provenance;
			if (firstProvenance.provider !== "sanity") throw new Error("fixture drift");
			// Property insertion order is not identity; canonical immutable values are.
			subset[0]!.provenance = {
				sourceRevision: firstProvenance.sourceRevision,
				sourceId: firstProvenance.sourceId,
				provider: firstProvenance.provider,
			};
			const completed = await completeV2(t, subset, "storage");
			expect(await completed.first.json()).toEqual({
				status: "pending_inspection",
				replayed: false,
				assetCount: 3,
			});
			const body = await completed.second.json() as Record<string, unknown>;
			expect(Object.keys(body).sort()).toEqual(["replayed", "status", "targets"]);
			expect(body).toMatchObject({ status: "verified", replayed: false });
			const targets = body.targets as Array<Record<string, unknown>>;
			expect(targets).toHaveLength(3);
			for (const target of targets) {
				expect(Object.keys(target).sort()).toEqual(["assetId", "assetKey", "kind"]);
			}

			const after = await storedState(t);
			const sourceIds = new Map<string, string>([
				...original.printSources.map((row) => [row.assetKey, row._id] as const),
				...original.paidFiles.map((row) => [row.assetKey, row._id] as const),
			]);
			expect(targets.map((target) => target.assetId)).toEqual(
				subset.map((item) => sourceIds.get(item.assetKey)),
			);
			expect(JSON.stringify({
				printSources: after.printSources,
				paidFiles: after.paidFiles,
			})).toBe(originalTargets);
			expect(JSON.stringify(after.coordinations.find((row) =>
				row.receiptSetId === v1ReceiptSetId
			))).toBe(JSON.stringify(originalV1));
			expect(JSON.stringify(await catalogPublicState(t))).toBe(publicBefore);

			const v2 = after.coordinations.find((row) =>
				row.receiptSetId === completed.receiptSetId
			);
			if (!v2 || v2.status !== "verified" || !("targetBindings" in v2)) {
				throw new Error("V2 coordination binding fixture missing");
			}
			expect(v2.targetResolutionVersion).toBe(1);
			const bindings = v2.targetBindings as CatalogPrivateAssetTargetBinding[];
			expect(bindings.map((binding) => binding.resolution))
				.toEqual(["reused_v1", "reused_v1", "reused_v1"]);
			expect(new Set(bindings.map((binding) =>
				binding.resolution === "reused_v1" ? binding.originCoordinationId : null
			))).toEqual(new Set([originalV1?._id]));

			const verifiedState = JSON.stringify(after);
			for (const [path, secret, receipt] of [
				[STORAGE_PATH, STORAGE_SECRET_A, completed.storage],
				[INSPECTION_PATH, INSPECTION_SECRET_A, completed.inspection],
			] as const) {
				const replay = await postReceipt(t, path, secret, receipt);
				expect(await replay.json()).toMatchObject({ status: "verified", replayed: true });
				expect(JSON.stringify(await storedState(t))).toBe(verifiedState);
			}
		});
	});

	test("preserves V1 replay and authority backfill for matching keys in separate kinds", async () => {
		const t = convexTest(schema, modules);
		const print = printFacts();
		const paid = paidFacts();
		paid.assetKey = print.assetKey;
		paid.privateObjectKey = `sites/${SITE_A}/catalog/paid-digital-files/${paid.assetKey}/original`;
		paid.provenance.sourceId = paid.assetKey;
		await withReceiptEnvironment(async () => {
			const printReceiptSetId = await registerV1(t, [print]);
			const paidReceiptSetId = await registerV1(t, [paid]);
			let state = await storedState(t);
			expect(state.printSources).toHaveLength(1);
			expect(state.paidFiles).toHaveLength(1);
			expect(state.authorities).toHaveLength(2);
			await deleteAuthorities(t);

			for (const [facts, receiptSetId] of [
				[[print], printReceiptSetId],
				[[paid], paidReceiptSetId],
			] as const) {
				for (const [path, secret, receipt] of [
					[STORAGE_PATH, STORAGE_SECRET_A, storageSet([...facts], receiptSetId)],
					[INSPECTION_PATH, INSPECTION_SECRET_A, inspectionSet([...facts], receiptSetId)],
				] as const) {
					const replay = await postReceipt(t, path, secret, receipt);
					expect(replay.status).toBe(200);
					expect(await replay.json()).toMatchObject({ status: "verified", replayed: true });
				}
			}

			for (const receiptSetId of [printReceiptSetId, paidReceiptSetId]) {
				expect(await t.mutation(
					internal.catalogPrivateAssets.backfillTargetAuthorities,
					{ siteUrl: SITE_A, receiptSetId },
				)).toEqual({ replayed: false, targetCount: 1 });
			}
			state = await storedState(t);
			expect(state.authorities).toHaveLength(2);

			const v2ReceiptSetId = await createCatalogPrivateAssetReceiptSetId(SITE_A, [print], 2);
			const before = JSON.stringify(state);
			expect((await postReceipt(
				t,
				STORAGE_PATH,
				STORAGE_SECRET_A,
				storageSetV2(v2ReceiptSetId, [print]),
			)).status).toBe(409);
			expect(JSON.stringify(await storedState(t))).toBe(before);
		});
	});

	test("supports inspection-first reuse and concurrent identical/conflicting V2 submissions", async () => {
		const t = convexTest(schema, modules);
		const facts = [printFacts(), paidFacts()];
		await withReceiptEnvironment(async () => {
			await registerV1(t, facts);
			const receiptSetId = await createCatalogPrivateAssetReceiptSetId(SITE_A, facts, 2);
			const inspection = inspectionSetV2(receiptSetId, facts);
			const firstPair = await Promise.all([
				postReceipt(t, INSPECTION_PATH, INSPECTION_SECRET_A, inspection),
				postReceipt(t, INSPECTION_PATH, INSPECTION_SECRET_A, inspection),
			]);
			expect(firstPair.map((response) => response.status)).toEqual([200, 200]);
			const firstBodies = await Promise.all(firstPair.map((response) => response.json()));
			expect(firstBodies.map((body) => body.replayed).sort()).toEqual([false, true]);

			const conflicting = inspectionSetV2(receiptSetId, facts);
			v2PrintInspection(conflicting).rasterSha256 = "d".repeat(64);
			const [completed, rejected] = await Promise.all([
				postReceipt(t, STORAGE_PATH, STORAGE_SECRET_A, storageSetV2(receiptSetId, facts)),
				postReceipt(t, INSPECTION_PATH, INSPECTION_SECRET_A, conflicting),
			]);
			expect(completed.status).toBe(200);
			expect(rejected.status).toBe(409);
			const state = await storedState(t);
			expect(state.coordinations).toHaveLength(2);
			expect(state.authorities).toHaveLength(2);
			expect(state.printSources).toHaveLength(1);
			expect(state.paidFiles).toHaveLength(1);
		});
	});

	test("fails closed for immutable-fact drift without leaving pending or target writes", async () => {
		const mutations: Array<[string, (facts: ReturnType<typeof printFacts>) => void]> = [
			["private object key", (facts) => {
				facts.privateObjectKey += "-drift";
			}],
			["filename", (facts) => {
				facts.originalFilename = "changed.jpg";
			}],
			["MIME", (facts) => {
				facts.mimeType = "image/png";
				facts.originalFilename = "changed.png";
			}],
			["byte count", (facts) => {
				facts.sizeBytes += 1;
			}],
			["width", (facts) => {
				facts.widthPixels -= 1;
			}],
			["height", (facts) => {
				facts.heightPixels -= 1;
			}],
			["source checksum", (facts) => {
				facts.sha256 = "e".repeat(64);
			}],
			["provenance source", (facts) => {
				facts.provenance.sourceId = "different-source";
			}],
			["provenance revision", (facts) => {
				if (facts.provenance.provider === "sanity") {
					facts.provenance.sourceRevision = "different-revision";
				}
			}],
			["provenance provider", (facts) => {
				facts.provenance = { provider: "editor_upload", sourceId: facts.assetKey };
			}],
		];
		for (const [, mutate] of mutations) {
			const t = convexTest(schema, modules);
			await withReceiptEnvironment(async () => {
				await registerV1(t, [printFacts()]);
				const before = JSON.stringify(await storedState(t));
				const drifted = printFacts();
				mutate(drifted);
				const receiptSetId = await createCatalogPrivateAssetReceiptSetId(SITE_A, [drifted], 2);
				const response = await postReceipt(
					t,
					STORAGE_PATH,
					STORAGE_SECRET_A,
					storageSetV2(receiptSetId, [drifted]),
				);
				expect(response.status).toBe(409);
				expect(JSON.stringify(await storedState(t))).toBe(before);
			});
		}

		const paid = convexTest(schema, modules);
		await withReceiptEnvironment(async () => {
			await registerV1(paid, [paidFacts()]);
			const before = JSON.stringify(await storedState(paid));
			const drifted = paidFacts();
			drifted.version = "2.0.0";
			const receiptSetId = await createCatalogPrivateAssetReceiptSetId(SITE_A, [drifted], 2);
			expect((await postReceipt(
				paid,
				STORAGE_PATH,
				STORAGE_SECRET_A,
				storageSetV2(receiptSetId, [drifted]),
			)).status).toBe(409);
			expect(JSON.stringify(await storedState(paid))).toBe(before);
		});
	});

	test("rejects missing/conflicting authority, V2-origin reuse, source corruption, target drift, deletion, and opposite-kind twins", async () => {
		const corruptionCases: Array<[
			string,
			(t: TestClient, state: Awaited<ReturnType<typeof storedState>>) => Promise<void>,
		]> = [
			["missing authority", async (t, state) => {
				await t.run(async (ctx) => await ctx.db.delete(state.authorities[0]!._id));
			}],
			["conflicting authority", async (t, state) => {
				const authority = state.authorities[0]!;
				const { _id, _creationTime, ...value } = authority;
				void _id;
				void _creationTime;
				await t.run(async (ctx) => {
					await ctx.db.insert("catalogPrivateAssetTargetAuthorities", value);
				});
			}],
			["cross-tenant authority", async (t, state) => {
				await t.run(async (ctx) => {
					await ctx.db.patch(state.authorities[0]!._id, { siteUrl: "foreign.example" });
				});
			}],
			["rebound authority ID", async (t, state) => {
				await t.run(async (ctx) => {
					const source = state.printSources[0]!;
					const { _id, _creationTime, ...copy } = source;
					void _id;
					void _creationTime;
					const reboundId = await ctx.db.insert("catalogPrintSourceAssets", {
						...copy,
						siteUrl: "foreign.example",
						assetKey: "foreign-target",
						privateObjectKey: "sites/foreign.example/catalog/print-sources/foreign-target/original",
					});
					await ctx.db.patch(state.authorities[0]!._id, { assetId: reboundId });
				});
			}],
			["source checksum corruption", async (t, state) => {
				await t.run(async (ctx) => {
					await ctx.db.patch(state.coordinations[0]!._id, { assetSetChecksum: "f".repeat(64) });
				});
			}],
			["pending source coordination", async (t, state) => {
				const source = state.coordinations[0]!;
				if (source.status !== "verified" || source.storageReceiptSet.schemaVersion !== 1) {
					throw new Error("verified V1 fixture missing");
				}
				await t.run(async (ctx) => {
					await ctx.db.replace("catalogPrivateAssetReceiptCoordinations", source._id, {
						siteUrl: source.siteUrl,
						receiptSetId: source.receiptSetId,
						assetSetChecksum: source.assetSetChecksum,
						status: "pending_inspection",
						storageReceiptChecksum: source.storageReceiptChecksum,
						storageReceivedAt: source.storageReceivedAt,
						storageReceiptSet: source.storageReceiptSet,
						createdAt: source.storageReceivedAt,
						updatedAt: source.storageReceivedAt,
					});
				});
			}],
			["source receipt corruption", async (t, state) => {
				const source = state.coordinations[0]!;
				if (source.status !== "verified" || source.storageReceiptSet.schemaVersion !== 1) {
					throw new Error("verified V1 fixture missing");
				}
				const storageReceiptSet = structuredClone(source.storageReceiptSet);
				storageReceiptSet.receipts[0]!.etag = "corrupt-etag";
				await t.run(async (ctx) => {
					await ctx.db.patch(source._id, { storageReceiptSet });
				});
			}],
			["target audit drift", async (t, state) => {
				await t.run(async (ctx) => {
					await ctx.db.patch(state.printSources[0]!._id, {
						verifiedAt: state.printSources[0]!.verifiedAt + 1,
					});
				});
			}],
			["target deletion", async (t, state) => {
				await t.run(async (ctx) => await ctx.db.delete(state.printSources[0]!._id));
			}],
			["target re-key", async (t, state) => {
				await t.run(async (ctx) => {
					await ctx.db.patch(state.printSources[0]!._id, { assetKey: "rebound-key" });
				});
			}],
			["opposite-kind twin", async (t, state) => {
				const print = state.printSources[0]!;
				await t.run(async (ctx) => {
					await ctx.db.insert("catalogDigitalFileAssets", {
						siteUrl: print.siteUrl,
						assetKey: print.assetKey,
						privateObjectKey: `sites/${SITE_A}/catalog/paid-digital-files/${print.assetKey}/original`,
						status: "verified",
						originalFilename: "conflict.zip",
						mimeType: "application/zip",
						sizeBytes: 1,
						sha256: "f".repeat(64),
						provenance: { provider: "editor_upload", sourceId: "conflict" },
						createdAt: 1,
						createdBy: "conflict-test",
						verifiedAt: 1,
						verifiedBy: "conflict-test",
					});
				});
			}],
		];
		for (const [, corrupt] of corruptionCases) {
			const t = convexTest(schema, modules);
			await withReceiptEnvironment(async () => {
				await registerV1(t, [printFacts()]);
				await corrupt(t, await storedState(t));
				const corrupted = JSON.stringify(await storedState(t));
				const receiptSetId = await createCatalogPrivateAssetReceiptSetId(SITE_A, [printFacts()], 2);
				const response = await postReceipt(
					t,
					STORAGE_PATH,
					STORAGE_SECRET_A,
					storageSetV2(receiptSetId, [printFacts()]),
				);
				expect(response.status).toBe(409);
				expect(JSON.stringify(await storedState(t))).toBe(corrupted);
			});
		}

		const v2Origin = convexTest(schema, modules);
		await withReceiptEnvironment(async () => {
			const original = printFacts();
			const firstId = await createCatalogPrivateAssetReceiptSetId(SITE_A, [original], 2);
			expect((await postReceipt(
				v2Origin,
				STORAGE_PATH,
				STORAGE_SECRET_A,
				storageSetV2(firstId, [original]),
			)).status).toBe(200);
			expect((await postReceipt(
				v2Origin,
				INSPECTION_PATH,
				INSPECTION_SECRET_A,
				inspectionSetV2(firstId, [original]),
			)).status).toBe(200);
			const drifted = printFacts();
			if (drifted.provenance.provider !== "sanity") throw new Error("fixture drift");
			drifted.provenance.sourceRevision = "v2-alias-attempt";
			const secondId = await createCatalogPrivateAssetReceiptSetId(SITE_A, [drifted], 2);
			const before = JSON.stringify(await storedState(v2Origin));
			expect((await postReceipt(
				v2Origin,
				STORAGE_PATH,
				STORAGE_SECRET_A,
				storageSetV2(secondId, [drifted]),
			)).status).toBe(409);
			expect(JSON.stringify(await storedState(v2Origin))).toBe(before);
		});
	});

	test("keeps legacy V2 pending and verified rows without resolution metadata replayable", async () => {
		const t = convexTest(schema, modules);
		const facts = [printFacts()];
		await withReceiptEnvironment(async () => {
			const receiptSetId = await createCatalogPrivateAssetReceiptSetId(SITE_A, facts, 2);
			const storage = storageSetV2(receiptSetId, facts);
			const inspection = inspectionSetV2(receiptSetId, facts);
			expect((await postReceipt(t, STORAGE_PATH, STORAGE_SECRET_A, storage)).status).toBe(200);
			const pending = (await storedState(t)).coordinations[0]!;
			if (pending.status !== "pending_inspection" || pending.storageReceiptSet.schemaVersion !== 2) {
				throw new Error("pending V2 fixture missing");
			}
			await t.run(async (ctx) => {
				await ctx.db.replace("catalogPrivateAssetReceiptCoordinations", pending._id, {
					siteUrl: pending.siteUrl,
					receiptSetId: pending.receiptSetId,
					assetSetChecksum: pending.assetSetChecksum,
					status: pending.status,
					storageReceiptChecksum: pending.storageReceiptChecksum,
					storageReceivedAt: pending.storageReceivedAt,
					storageReceiptSet: pending.storageReceiptSet,
					createdAt: pending.createdAt,
					updatedAt: pending.updatedAt,
				});
			});
			const legacyPending = JSON.stringify(await storedState(t));
			expect(await (await postReceipt(
				t,
				STORAGE_PATH,
				STORAGE_SECRET_A,
				storage,
			)).json()).toMatchObject({ replayed: true, status: "pending_inspection" });
			expect(JSON.stringify(await storedState(t))).toBe(legacyPending);
			expect((await postReceipt(
				t,
				INSPECTION_PATH,
				INSPECTION_SECRET_A,
				inspection,
			)).status).toBe(200);

			const verified = (await storedState(t)).coordinations[0]!;
			if (
				verified.status !== "verified"
				|| verified.storageReceiptSet.schemaVersion !== 2
				|| verified.inspectionReceiptSet.schemaVersion !== 2
			) throw new Error("verified V2 fixture missing");
			await t.run(async (ctx) => {
				await ctx.db.replace("catalogPrivateAssetReceiptCoordinations", verified._id, {
					siteUrl: verified.siteUrl,
					receiptSetId: verified.receiptSetId,
					assetSetChecksum: verified.assetSetChecksum,
					status: verified.status,
					storageReceiptChecksum: verified.storageReceiptChecksum,
					inspectionReceiptChecksum: verified.inspectionReceiptChecksum,
					storageReceivedAt: verified.storageReceivedAt,
					inspectionReceivedAt: verified.inspectionReceivedAt,
					verifiedAt: verified.verifiedAt,
					storageReceiptSet: verified.storageReceiptSet,
					inspectionReceiptSet: verified.inspectionReceiptSet,
					targets: verified.targets,
					createdAt: verified.createdAt,
					updatedAt: verified.updatedAt,
				});
				const authorities = await ctx.db.query("catalogPrivateAssetTargetAuthorities").take(2);
				for (const authority of authorities) await ctx.db.delete(authority._id);
			});
			const legacyVerified = JSON.stringify(await storedState(t));
			expect(await (await postReceipt(
				t,
				STORAGE_PATH,
				STORAGE_SECRET_A,
				storage,
			)).json()).toMatchObject({ replayed: true, status: "verified" });
			expect(JSON.stringify(await storedState(t))).toBe(legacyVerified);
		});
	});

	test("rejects reuse assembled from more than one V1 source coordination", async () => {
		const t = convexTest(schema, modules);
		const first = printFacts();
		const second = printFacts(
			"image-dddddddddddddddddddddddddddddddddddddddd-6000x4000-jpg",
			"d".repeat(64),
		);
		second.originalFilename = "dddddddddddddddddddddddddddddddddddddddd-6000x4000.jpg";
		second.provenance = {
			provider: "sanity",
			sourceId: second.assetKey,
			sourceRevision: "second-origin",
		};
		await withReceiptEnvironment(async () => {
			await registerV1(t, [first]);
			await registerV1(t, [second]);
			const combined: CatalogPrivateAssetFacts[] = [first, second];
			const receiptSetId = await createCatalogPrivateAssetReceiptSetId(SITE_A, combined, 2);
			const before = JSON.stringify(await storedState(t));
			expect((await postReceipt(
				t,
				STORAGE_PATH,
				STORAGE_SECRET_A,
				storageSetV2(receiptSetId, combined),
			)).status).toBe(409);
			expect(JSON.stringify(await storedState(t))).toBe(before);
		});
	});

	test("rolls back a mixed create/reuse plan when its pinned authority conflicts before completion", async () => {
		const t = convexTest(schema, modules);
		const existing = printFacts();
		const fresh = printFacts(
			"image-cccccccccccccccccccccccccccccccccccccccc-6000x4000-jpg",
			"c".repeat(64),
		);
		fresh.originalFilename = "cccccccccccccccccccccccccccccccccccccccc-6000x4000.jpg";
		fresh.provenance = {
			provider: "sanity",
			sourceId: fresh.assetKey,
			sourceRevision: "fresh-revision",
		};
		const mixed: CatalogPrivateAssetFacts[] = [existing, fresh];
		await withReceiptEnvironment(async () => {
			await registerV1(t, [existing]);
			const receiptSetId = await createCatalogPrivateAssetReceiptSetId(SITE_A, mixed, 2);
			expect((await postReceipt(
				t,
				STORAGE_PATH,
				STORAGE_SECRET_A,
				storageSetV2(receiptSetId, mixed),
			)).status).toBe(200);
			const pending = await storedState(t);
			const authority = pending.authorities[0]!;
			await t.run(async (ctx) => {
				await ctx.db.patch(authority._id, { originReceiptSetId: "conflicting-origin" });
			});
			const beforeCompletion = JSON.stringify(await storedState(t));
			expect((await postReceipt(
				t,
				INSPECTION_PATH,
				INSPECTION_SECRET_A,
				inspectionSetV2(receiptSetId, mixed),
			)).status).toBe(409);
			const after = await storedState(t);
			expect(JSON.stringify(after)).toBe(beforeCompletion);
			expect(after.printSources).toHaveLength(1);
			expect(after.printSources.some((row) => row.assetKey === fresh.assetKey)).toBe(false);
		});
	});
});
