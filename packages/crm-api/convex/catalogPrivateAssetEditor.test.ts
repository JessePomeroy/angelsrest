/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import {
	EDITOR_INSPECTION_PATH,
	EDITOR_STORAGE_PATH,
	editorInspectionSetV2,
	editorPaidFacts,
	editorPrintFacts,
	editorStorageSetV2,
	INSPECTION_PATH,
	INSPECTION_SECRET_A,
	postReceipt,
	SITE_A,
	SITE_B,
	STORAGE_PATH,
	STORAGE_SECRET_A,
	storedState,
	withReceiptEnvironment,
} from "../test/catalogPrivateAssetReceiptFixtures";
import {
	createGraph,
	graphDraft,
	printSourceAsset,
	readyAsset,
	workerAssetId,
} from "../test/catalogProductGraphFixtures";
import { api, internal } from "./_generated/api";
import type {
	CatalogPrivateAssetFacts,
	CatalogPrivateInspectionReceiptSet,
	CatalogPrivateStorageReceiptSet,
} from "./helpers/catalogPrivateAssetReceiptContract";
import { createCatalogPrivateAssetReceiptSetId } from "./helpers/catalogPrivateAssetReceiptValidation";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

type TestHarness = ReturnType<typeof convexTest>;

async function seedClients(t: TestHarness) {
	for (const site of [
		{ siteUrl: SITE_A, email: "admin-a@example.com" },
		{ siteUrl: SITE_B, email: "admin-b@example.com" },
	]) {
		await t.mutation(internal.platform.seedClient, {
			name: site.siteUrl,
			email: site.email,
			siteUrl: site.siteUrl,
			tier: "full",
			subscriptionStatus: "active",
			adminEmails: [site.email],
			role: "client",
			catalogProductKinds: [
				"print",
				"print_set",
				"postcard",
				"tapestry",
				"digital_download",
				"merchandise",
			],
		});
	}
	return {
		adminA: t.withIdentity({ subject: "admin-a", email: "admin-a@example.com" }),
		adminB: t.withIdentity({ subject: "admin-b", email: "admin-b@example.com" }),
		stranger: t.withIdentity({ subject: "stranger", email: "stranger@example.com" }),
	};
}

async function catalogGraphState(t: TestHarness) {
	return await t.run(async (ctx) => ({
		products: await ctx.db.query("catalogProducts").take(100),
		revisions: await ctx.db.query("catalogProductRevisions").take(100),
		variants: await ctx.db.query("catalogProductVariants").take(100),
		mediaPlacements: await ctx.db.query("catalogProductMediaPlacements").take(100),
		printRelations: await ctx.db.query("catalogProductPrintSources").take(100),
		setMembers: await ctx.db.query("catalogProductSetMembers").take(100),
		digitalRelations: await ctx.db.query("catalogProductDigitalFiles").take(100),
		shopPlacements: await ctx.db.query("catalogProductShopPlacements").take(100),
	}));
}

async function seedNonEmptyCatalogGraph(
	t: TestHarness,
	admin: ReturnType<TestHarness["withIdentity"]>,
) {
	const web = await admin.mutation(api.mediaAssets.registerReadyWebAsset, {
		siteUrl: SITE_A,
		asset: readyAsset(SITE_A, workerAssetId("a", 91)),
	});
	const existingPrint = await t.run(
		async (ctx) =>
			await ctx.db.insert(
				"catalogPrintSourceAssets",
				printSourceAsset(SITE_A, "existing-catalog-print", 9),
			),
	);
	const created = await createGraph(
		admin,
		SITE_A,
		"existing-catalog-product",
		graphDraft(
			"print",
			{
				webA: web.id,
				webA2: web.id,
				printA: existingPrint,
				printA2: existingPrint,
				paidA: "unused" as never,
			},
			"existing-catalog-product",
		),
	);
	await t.run(async (ctx) => {
		await ctx.db.patch(created.productId, {
			publishedRevisionId: created.revisionId,
			publishedAt: 123_456,
			publishedBy: "catalog-graph-fixture",
		});
	});
}

function expectEditorSafe(value: unknown) {
	expect(JSON.stringify(value)).not.toMatch(
		/siteUrl|privateObjectKey|assetKey|sha256|provenance|createdBy|verifiedAt|verifiedBy|etag|receipt|coordination|authority|targetBindings|grant|capability|url/i,
	);
}

async function editorIdentity(facts: CatalogPrivateAssetFacts) {
	return await createCatalogPrivateAssetReceiptSetId(
		facts.privateObjectKey.split("/", 2)[1] ?? SITE_A,
		[facts],
		2,
	);
}

function editorOperationId(facts: CatalogPrivateAssetFacts) {
	if (facts.provenance.provider !== "editor_upload") throw new Error("fixture drift");
	return facts.provenance.sourceId.slice("editor-upload:".length);
}

describe("exact-one private catalog editor receipt contract", () => {
	test("admits storage first, resolves only an authenticated safe print projection, and replays without catalog writes", async () => {
		const t = convexTest(schema, modules);
		const { adminA, adminB, stranger } = await seedClients(t);
		await seedNonEmptyCatalogGraph(t, adminA);
		const facts = editorPrintFacts();
		const receiptSetId = await editorIdentity(facts);
		const graphBefore = await catalogGraphState(t);
		expect(graphBefore.products).toHaveLength(1);
		expect(graphBefore.products[0]?.draftRevisionId).toBe(
			graphBefore.products[0]?.publishedRevisionId,
		);
		expect(graphBefore.variants).toHaveLength(1);
		expect(graphBefore.mediaPlacements).toHaveLength(2);
		expect(graphBefore.printRelations).toHaveLength(1);
		expect(graphBefore.shopPlacements).toHaveLength(1);

		await withReceiptEnvironment(async () => {
			const stored = await postReceipt(
				t,
				EDITOR_STORAGE_PATH,
				STORAGE_SECRET_A,
				editorStorageSetV2(receiptSetId, facts),
			);
			expect(stored.status).toBe(200);
			expect(stored.headers.get("Cache-Control")).toBe("no-store");
			expect(stored.headers.get("X-Content-Type-Options")).toBe("nosniff");
			expect(await stored.json()).toEqual({
				status: "pending_inspection",
				replayed: false,
				assetCount: 1,
			});

			await expect(
				adminA.query(api.catalogPrivateAssets.resolveEditorUpload, {
					siteUrl: SITE_A,
					operationId: editorOperationId(facts),
					productKind: "print",
				}),
			).rejects.toThrow(/not verified/i);

			const inspected = await postReceipt(
				t,
				EDITOR_INSPECTION_PATH,
				INSPECTION_SECRET_A,
				editorInspectionSetV2(receiptSetId, facts),
			);
			expect(inspected.status).toBe(200);
			expect(await inspected.json()).toEqual({
				status: "verified",
				replayed: false,
				assetCount: 1,
			});

			const resolved = await adminA.query(api.catalogPrivateAssets.resolveEditorUpload, {
				siteUrl: SITE_A,
				operationId: editorOperationId(facts),
				productKind: "print",
			});
			expect(resolved).toEqual({
				kind: "print_source",
				assetId: expect.any(String),
				status: "verified",
				originalFilename: facts.originalFilename,
				mimeType: "image/jpeg",
				sizeBytes: facts.sizeBytes,
				widthPixels: facts.widthPixels,
				heightPixels: facts.heightPixels,
				createdAt: expect.any(Number),
			});
			expectEditorSafe(resolved);

			await expect(
				t.query(api.catalogPrivateAssets.resolveEditorUpload, {
					siteUrl: SITE_A,
					operationId: editorOperationId(facts),
					productKind: "print",
				}),
			).rejects.toThrow(/not authenticated/i);
			await expect(
				stranger.query(api.catalogPrivateAssets.resolveEditorUpload, {
					siteUrl: SITE_A,
					operationId: editorOperationId(facts),
					productKind: "print",
				}),
			).rejects.toThrow(/not authorized/i);
			await expect(
				adminA.query(api.catalogPrivateAssets.resolveEditorUpload, {
					siteUrl: SITE_A,
					operationId: editorOperationId(facts),
					productKind: "digital_download",
				}),
			).rejects.toThrow(/not verified/i);
			await expect(
				adminB.query(api.catalogPrivateAssets.resolveEditorUpload, {
					siteUrl: SITE_B,
					operationId: editorOperationId(facts),
					productKind: "print",
				}),
			).rejects.toThrow(/not verified/i);

			const verifiedState = JSON.stringify(await storedState(t));
			for (const [path, secret, receipt] of [
				[EDITOR_STORAGE_PATH, STORAGE_SECRET_A, editorStorageSetV2(receiptSetId, facts)],
				[EDITOR_INSPECTION_PATH, INSPECTION_SECRET_A, editorInspectionSetV2(receiptSetId, facts)],
			] as const) {
				const replay = await postReceipt(t, path, secret, receipt);
				expect(await replay.json()).toEqual({
					status: "verified",
					replayed: true,
					assetCount: 1,
				});
				expect(JSON.stringify(await storedState(t))).toBe(verifiedState);
			}

			const storageDrift = editorStorageSetV2(receiptSetId, facts);
			const storedReceipt = storageDrift.receipts[0];
			if (!storedReceipt) throw new Error("fixture drift");
			storedReceipt.etag = "editor-storage-drift";
			expect(
				(await postReceipt(t, EDITOR_STORAGE_PATH, STORAGE_SECRET_A, storageDrift)).status,
			).toBe(409);

			const inspectionDrift = editorInspectionSetV2(receiptSetId, facts);
			const inspectedReceipt = inspectionDrift.receipts[0];
			if (inspectedReceipt?.inspection.method !== "sharp_libvips_full_raster_v1") {
				throw new Error("fixture drift");
			}
			inspectedReceipt.inspection.rasterSha256 = "f".repeat(64);
			expect(
				(await postReceipt(t, EDITOR_INSPECTION_PATH, INSPECTION_SECRET_A, inspectionDrift)).status,
			).toBe(409);
			expect(JSON.stringify(await storedState(t))).toBe(verifiedState);
		});

		expect(await catalogGraphState(t)).toEqual(graphBefore);
	});

	test("admits independent inspection first and returns the existing safe paid-file projection", async () => {
		const t = convexTest(schema, modules);
		const { adminA } = await seedClients(t);
		await seedNonEmptyCatalogGraph(t, adminA);
		const facts = editorPaidFacts();
		const receiptSetId = await editorIdentity(facts);
		const graphBefore = await catalogGraphState(t);

		await withReceiptEnvironment(async () => {
			const inspected = await postReceipt(
				t,
				EDITOR_INSPECTION_PATH,
				INSPECTION_SECRET_A,
				editorInspectionSetV2(receiptSetId, facts),
			);
			expect(await inspected.json()).toEqual({
				status: "pending_storage",
				replayed: false,
				assetCount: 1,
			});
			expect((await storedState(t)).paidFiles).toHaveLength(0);

			const stored = await postReceipt(
				t,
				EDITOR_STORAGE_PATH,
				STORAGE_SECRET_A,
				editorStorageSetV2(receiptSetId, facts),
			);
			expect(await stored.json()).toEqual({
				status: "verified",
				replayed: false,
				assetCount: 1,
			});
		});

		const resolved = await adminA.query(api.catalogPrivateAssets.resolveEditorUpload, {
			siteUrl: SITE_A,
			operationId: editorOperationId(facts),
			productKind: "digital_download",
		});
		expect(resolved).toEqual({
			kind: "paid_digital_file",
			assetId: expect.any(String),
			status: "verified",
			originalFilename: facts.originalFilename,
			mimeType: "application/zip",
			sizeBytes: facts.sizeBytes,
			version: facts.version,
			createdAt: expect.any(Number),
		});
		expectEditorSafe(resolved);
		expect(await catalogGraphState(t)).toEqual(graphBefore);
	});

	test("resolves a fully historical canonical pair only through its strict operation binding", async () => {
		const t = convexTest(schema, modules);
		const { adminA } = await seedClients(t);
		const facts = editorPrintFacts(SITE_A, "0".repeat(40));
		const receiptSetId = await editorIdentity(facts);
		const graphBefore = await catalogGraphState(t);
		await withReceiptEnvironment(async () => {
			expect(
				(
					await postReceipt(
						t,
						STORAGE_PATH,
						STORAGE_SECRET_A,
						editorStorageSetV2(receiptSetId, facts),
					)
				).status,
			).toBe(200);
			expect(
				(
					await postReceipt(
						t,
						INSPECTION_PATH,
						INSPECTION_SECRET_A,
						editorInspectionSetV2(receiptSetId, facts),
					)
				).status,
			).toBe(200);
		});

		const state = await storedState(t);
		expect(state.operations).toEqual([
			expect.objectContaining({
				operationId: editorOperationId(facts),
				receiptSetId,
				assetKey: facts.assetKey,
			}),
		]);
		expect(state.coordinations).toEqual([
			expect.objectContaining({ status: "verified", receiptSetId }),
		]);
		const resolved = await adminA.query(api.catalogPrivateAssets.resolveEditorUpload, {
			siteUrl: SITE_A,
			operationId: editorOperationId(facts),
			productKind: "print",
		});
		expect(resolved).toMatchObject({
			kind: "print_source",
			assetId: state.printSources[0]?._id,
			originalFilename: facts.originalFilename,
			widthPixels: facts.widthPixels,
			heightPixels: facts.heightPixels,
		});
		expectEditorSafe(resolved);
		expect(await catalogGraphState(t)).toEqual(graphBefore);
	});

	test("concurrent exact submissions converge on one coordination, authority, and target", async () => {
		const t = convexTest(schema, modules);
		const facts = editorPrintFacts();
		const receiptSetId = await editorIdentity(facts);
		await withReceiptEnvironment(async () => {
			const storage = await Promise.all([
				postReceipt(
					t,
					EDITOR_STORAGE_PATH,
					STORAGE_SECRET_A,
					editorStorageSetV2(receiptSetId, facts),
				),
				postReceipt(
					t,
					EDITOR_STORAGE_PATH,
					STORAGE_SECRET_A,
					editorStorageSetV2(receiptSetId, facts),
				),
			]);
			const storageResults = await Promise.all(storage.map((response) => response.json()));
			expect(storageResults).toEqual(
				expect.arrayContaining([
					{ status: "pending_inspection", replayed: false, assetCount: 1 },
					{ status: "pending_inspection", replayed: true, assetCount: 1 },
				]),
			);

			const inspection = await Promise.all([
				postReceipt(
					t,
					EDITOR_INSPECTION_PATH,
					INSPECTION_SECRET_A,
					editorInspectionSetV2(receiptSetId, facts),
				),
				postReceipt(
					t,
					EDITOR_INSPECTION_PATH,
					INSPECTION_SECRET_A,
					editorInspectionSetV2(receiptSetId, facts),
				),
			]);
			const inspectionResults = await Promise.all(inspection.map((response) => response.json()));
			expect(inspectionResults).toEqual(
				expect.arrayContaining([
					{ status: "verified", replayed: false, assetCount: 1 },
					{ status: "verified", replayed: true, assetCount: 1 },
				]),
			);
		});
		const state = await storedState(t);
		expect(state.operations).toHaveLength(1);
		expect(state.coordinations).toHaveLength(1);
		expect(state.authorities).toHaveLength(1);
		expect(state.printSources).toHaveLength(1);
		expect(state.paidFiles).toHaveLength(0);
	});

	test("storage and inspection first roles converge through the indexed OCC reservation", async () => {
		const t = convexTest(schema, modules);
		const facts = editorPrintFacts(SITE_A, "1".repeat(40));
		const receiptSetId = await editorIdentity(facts);
		await withReceiptEnvironment(async () => {
			const responses = await Promise.all([
				postReceipt(
					t,
					EDITOR_STORAGE_PATH,
					STORAGE_SECRET_A,
					editorStorageSetV2(receiptSetId, facts),
				),
				postReceipt(
					t,
					EDITOR_INSPECTION_PATH,
					INSPECTION_SECRET_A,
					editorInspectionSetV2(receiptSetId, facts),
				),
			]);
			expect(responses.map((response) => response.status)).toEqual([200, 200]);
			const results = await Promise.all(responses.map((response) => response.json()));
			expect(results.filter((result) => result.status === "verified")).toEqual([
				{ status: "verified", replayed: false, assetCount: 1 },
			]);
			expect(
				results.some(
					(result) => result.status === "pending_storage" || result.status === "pending_inspection",
				),
			).toBe(true);
			expect(results.every((result) => result.replayed === false && result.assetCount === 1)).toBe(
				true,
			);
		});
		const state = await storedState(t);
		expect(state.operations).toHaveLength(1);
		expect(state.coordinations).toHaveLength(1);
		expect(state.coordinations[0]?.status).toBe("verified");
		expect(state.authorities).toHaveLength(1);
		expect(state.printSources).toHaveLength(1);
	});

	test("the indexed OCC reservation admits only one divergent first role", async () => {
		const t = convexTest(schema, modules);
		const operationId = "2".repeat(40);
		const storageFacts = editorPrintFacts(SITE_A, operationId);
		const inspectionFacts = structuredClone(storageFacts);
		inspectionFacts.originalFilename = "divergent-concurrent-facts.jpg";
		const [storageReceiptSetId, inspectionReceiptSetId] = await Promise.all([
			editorIdentity(storageFacts),
			editorIdentity(inspectionFacts),
		]);
		expect(inspectionReceiptSetId).not.toBe(storageReceiptSetId);
		await withReceiptEnvironment(async () => {
			const responses = await Promise.all([
				postReceipt(
					t,
					EDITOR_STORAGE_PATH,
					STORAGE_SECRET_A,
					editorStorageSetV2(storageReceiptSetId, storageFacts),
				),
				postReceipt(
					t,
					EDITOR_INSPECTION_PATH,
					INSPECTION_SECRET_A,
					editorInspectionSetV2(inspectionReceiptSetId, inspectionFacts),
				),
			]);
			expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
		});
		const state = await storedState(t);
		expect(state.operations).toHaveLength(1);
		expect(state.coordinations).toHaveLength(1);
		expect(state.operations[0]?.receiptSetId).toBe(state.coordinations[0]?.receiptSetId);
		expect([storageReceiptSetId, inspectionReceiptSetId]).toContain(
			state.operations[0]?.receiptSetId,
		);
		expect(state.authorities).toHaveLength(0);
		expect(state.printSources).toHaveLength(0);
		expect(state.paidFiles).toHaveLength(0);
	});

	test("rolls back the operation reservation when the downstream registry rejects", async () => {
		const t = convexTest(schema, modules);
		const facts = editorPaidFacts(SITE_A, "3".repeat(40));
		const receiptSetId = await editorIdentity(facts);
		await t.run(async (ctx) => {
			await ctx.db.insert("catalogPrintSourceAssets", printSourceAsset(SITE_A, facts.assetKey, 13));
		});
		const before = await storedState(t);
		await withReceiptEnvironment(async () => {
			const response = await postReceipt(
				t,
				EDITOR_STORAGE_PATH,
				STORAGE_SECRET_A,
				editorStorageSetV2(receiptSetId, facts),
			);
			expect(response.status).toBe(503);
			expect(await response.text()).toBe(
				"Private catalog receipt service is temporarily unavailable",
			);
		});
		expect(await storedState(t)).toEqual(before);
		expect(before.operations).toHaveLength(0);
		expect(before.coordinations).toHaveLength(0);
	});

	test("preserves an existing reservation and pending coordination when second-role completion fails", async () => {
		const t = convexTest(schema, modules);
		const facts = editorPrintFacts(SITE_A, "b".repeat(40));
		const receiptSetId = await editorIdentity(facts);
		await withReceiptEnvironment(async () => {
			const stored = await postReceipt(
				t,
				EDITOR_STORAGE_PATH,
				STORAGE_SECRET_A,
				editorStorageSetV2(receiptSetId, facts),
			);
			expect(stored.status).toBe(200);
		});
		await t.run(async (ctx) => {
			await ctx.db.insert("catalogDigitalFileAssets", {
				siteUrl: SITE_A,
				assetKey: facts.assetKey,
				privateObjectKey: `sites/${SITE_A}/catalog/paid-digital-files/${facts.assetKey}/original`,
				status: "verified",
				originalFilename: `${facts.assetKey}.zip`,
				mimeType: "application/zip",
				sizeBytes: 1,
				sha256: "e".repeat(64),
				provenance: { provider: "editor_upload", sourceId: "preexisting-conflict" },
				createdAt: 1,
				createdBy: "second-role-rollback-fixture",
				verifiedAt: 1,
				verifiedBy: "second-role-rollback-fixture",
			});
		});
		const beforeCompletion = await storedState(t);
		expect(beforeCompletion.operations).toHaveLength(1);
		expect(beforeCompletion.coordinations).toEqual([
			expect.objectContaining({
				receiptSetId,
				status: "pending_inspection",
			}),
		]);
		expect(beforeCompletion.authorities).toHaveLength(0);
		expect(beforeCompletion.printSources).toHaveLength(0);
		expect(beforeCompletion.paidFiles).toHaveLength(1);

		await withReceiptEnvironment(async () => {
			const inspected = await postReceipt(
				t,
				EDITOR_INSPECTION_PATH,
				INSPECTION_SECRET_A,
				editorInspectionSetV2(receiptSetId, facts),
			);
			expect(inspected.status).toBe(503);
			expect(await inspected.text()).toBe(
				"Private catalog receipt service is temporarily unavailable",
			);
		});

		expect(await storedState(t)).toEqual(beforeCompletion);
	});

	test("rejects schema, cardinality, provider, source identity, size, kind, and inspection-policy drift atomically", async () => {
		const invalidCases: Array<{
			label: string;
			role: "storage" | "inspection";
			build: () => Promise<CatalogPrivateStorageReceiptSet | CatalogPrivateInspectionReceiptSet>;
		}> = [
			{
				label: "schema 1",
				role: "storage",
				build: async () =>
					({
						...editorStorageSetV2(await editorIdentity(editorPrintFacts()), editorPrintFacts()),
						schemaVersion: 1,
					}) as CatalogPrivateStorageReceiptSet,
			},
			{
				label: "two assets",
				role: "storage",
				build: async () => {
					const facts = [editorPrintFacts(), editorPaidFacts()];
					const receiptSetId = await createCatalogPrivateAssetReceiptSetId(SITE_A, facts, 2);
					const first = editorStorageSetV2(receiptSetId, facts[0]);
					const second = editorStorageSetV2(receiptSetId, facts[1]);
					const firstReceipt = first.receipts[0];
					const secondReceipt = second.receipts[0];
					if (!firstReceipt || !secondReceipt) throw new Error("fixture drift");
					return {
						...first,
						receipts: [firstReceipt, secondReceipt],
					};
				},
			},
			{
				label: "wrong provider",
				role: "storage",
				build: async () => {
					const facts = editorPrintFacts();
					facts.provenance = {
						provider: "sanity",
						sourceId: facts.assetKey,
						sourceRevision: "editor-provider-drift",
					};
					return editorStorageSetV2(await editorIdentity(facts), facts);
				},
			},
			{
				label: "noncanonical source identity",
				role: "storage",
				build: async () => {
					const facts = editorPrintFacts();
					if (facts.provenance.provider !== "editor_upload") throw new Error("fixture drift");
					facts.provenance.sourceId = "editor/upload/identity";
					return editorStorageSetV2(await editorIdentity(facts), facts);
				},
			},
			{
				label: "uppercase operation identity",
				role: "storage",
				build: async () => {
					const facts = editorPrintFacts(SITE_A, "C".repeat(40));
					return editorStorageSetV2(await editorIdentity(facts), facts);
				},
			},
			{
				label: "asset key identity drift",
				role: "storage",
				build: async () => {
					const facts = editorPrintFacts();
					facts.assetKey = `${facts.assetKey}-mutable-fact`;
					facts.privateObjectKey = `sites/${SITE_A}/catalog/print-sources/${facts.assetKey}/original`;
					return editorStorageSetV2(await editorIdentity(facts), facts);
				},
			},
			{
				label: "private object binding drift",
				role: "inspection",
				build: async () => {
					const facts = editorPrintFacts();
					facts.privateObjectKey = `sites/${SITE_A}/catalog/paid-digital-files/${facts.assetKey}/original`;
					return editorInspectionSetV2(await editorIdentity(facts), facts);
				},
			},
			{
				label: "source over 100 MB",
				role: "storage",
				build: async () => {
					const facts = editorPrintFacts();
					facts.sizeBytes = 100_000_001;
					return editorStorageSetV2(await editorIdentity(facts), facts);
				},
			},
			{
				label: "unsupported print MIME",
				role: "storage",
				build: async () => {
					const facts = editorPrintFacts();
					Reflect.set(facts, "mimeType", "image/webp");
					return editorStorageSetV2(await editorIdentity(facts), facts);
				},
			},
			{
				label: "unpinned decoder",
				role: "inspection",
				build: async () => {
					const facts = editorPrintFacts();
					const set = editorInspectionSetV2(await editorIdentity(facts), facts);
					const receipt = set.receipts[0];
					if (receipt?.inspection.method !== "sharp_libvips_full_raster_v1") {
						throw new Error("fixture drift");
					}
					receipt.inspection.sharpVersion = "0.34.5";
					return set;
				},
			},
			{
				label: "unsafe paid ZIP policy",
				role: "inspection",
				build: async () => {
					const facts = editorPaidFacts();
					const set = editorInspectionSetV2(await editorIdentity(facts), facts);
					const receipt = set.receipts[0];
					if (receipt?.inspection.method !== "safe_zip_v1") throw new Error("fixture drift");
					receipt.inspection.unsafePathCount = 1;
					return set;
				},
			},
			{
				label: "empty paid-file version",
				role: "storage",
				build: async () => {
					const facts = editorPaidFacts();
					facts.version = "";
					return editorStorageSetV2(await editorIdentity(facts), facts);
				},
			},
		];

		for (const invalidCase of invalidCases) {
			const t = convexTest(schema, modules);
			await withReceiptEnvironment(async () => {
				const receipt = await invalidCase.build();
				const response = await postReceipt(
					t,
					invalidCase.role === "storage" ? EDITOR_STORAGE_PATH : EDITOR_INSPECTION_PATH,
					invalidCase.role === "storage" ? STORAGE_SECRET_A : INSPECTION_SECRET_A,
					receipt,
				);
				expect(response.status, invalidCase.label).toBe(400);
			});
			const state = await storedState(t);
			expect(state.operations, invalidCase.label).toHaveLength(0);
			expect(state.coordinations, invalidCase.label).toHaveLength(0);
			expect(state.authorities, invalidCase.label).toHaveLength(0);
			expect(state.printSources, invalidCase.label).toHaveLength(0);
			expect(state.paidFiles, invalidCase.label).toHaveLength(0);
		}

		const t = convexTest(schema, modules);
		const print = editorPrintFacts();
		const printReceiptSetId = await editorIdentity(print);
		await withReceiptEnvironment(async () => {
			expect(
				(
					await postReceipt(
						t,
						EDITOR_STORAGE_PATH,
						STORAGE_SECRET_A,
						editorStorageSetV2(printReceiptSetId, print),
					)
				).status,
			).toBe(200);
			const pending = JSON.stringify(await storedState(t));
			const wrongPolicy = editorInspectionSetV2(printReceiptSetId, print);
			const wrongPolicyReceipt = wrongPolicy.receipts[0];
			if (wrongPolicyReceipt?.inspection.method !== "sharp_libvips_full_raster_v1") {
				throw new Error("fixture drift");
			}
			wrongPolicyReceipt.inspection.libvipsVersion = "8.17.3";
			const wrongPolicyResponse = await postReceipt(
				t,
				EDITOR_INSPECTION_PATH,
				INSPECTION_SECRET_A,
				wrongPolicy,
			);
			expect(wrongPolicyResponse.status).toBe(400);
			expect(JSON.stringify(await storedState(t))).toBe(pending);

			const paid = editorPaidFacts();
			const wrongKind = editorInspectionSetV2(printReceiptSetId, paid);
			const response = await postReceipt(t, EDITOR_INSPECTION_PATH, INSPECTION_SECRET_A, wrongKind);
			expect(response.status).toBe(400);
			expect(JSON.stringify(await storedState(t))).toBe(pending);
		});
	});

	test("atomically binds one operation before either role and conflicts on changed facts or receipt set", async () => {
		const t = convexTest(schema, modules);
		const operationId = "8".repeat(40);
		const facts = editorPrintFacts(SITE_A, operationId);
		const receiptSetId = await editorIdentity(facts);
		await withReceiptEnvironment(async () => {
			const first = await postReceipt(
				t,
				EDITOR_STORAGE_PATH,
				STORAGE_SECRET_A,
				editorStorageSetV2(receiptSetId, facts),
			);
			expect(first.status).toBe(200);
			const pending = await storedState(t);
			expect(pending.operations).toEqual([
				expect.objectContaining({
					siteUrl: SITE_A,
					operationId,
					sourceId: `editor-upload:${operationId}`,
					receiptSetId,
					kind: "print_source",
					assetKey: `editor-upload-${operationId}`,
					privateObjectKey: `sites/${SITE_A}/catalog/print-sources/editor-upload-${operationId}/original`,
				}),
			]);
			const beforeConflict = JSON.stringify(pending);

			const changedFacts = structuredClone(facts);
			changedFacts.originalFilename = "changed-under-the-same-operation.jpg";
			const changedReceiptSetId = await editorIdentity(changedFacts);
			expect(changedReceiptSetId).not.toBe(receiptSetId);
			expect(
				(
					await postReceipt(
						t,
						EDITOR_INSPECTION_PATH,
						INSPECTION_SECRET_A,
						editorInspectionSetV2(changedReceiptSetId, changedFacts),
					)
				).status,
			).toBe(409);

			const changedKind = editorPaidFacts(SITE_A, operationId);
			expect(
				(
					await postReceipt(
						t,
						EDITOR_INSPECTION_PATH,
						INSPECTION_SECRET_A,
						editorInspectionSetV2(await editorIdentity(changedKind), changedKind),
					)
				).status,
			).toBe(409);
			expect(JSON.stringify(await storedState(t))).toBe(beforeConflict);
		});
	});

	test("enforces editor source-size and corrected ZIP boundaries in both receipt roles", async () => {
		for (const role of ["storage", "inspection"] as const) {
			for (const [sizeBytes, expectedStatus] of [
				[1, 200],
				[100_000_000, 200],
				[0, 400],
				[100_000_001, 400],
			] as const) {
				const t = convexTest(schema, modules);
				const facts = editorPaidFacts(
					SITE_A,
					`${role === "storage" ? "a" : "b"}${String(sizeBytes).padStart(39, "0")}`,
				);
				facts.sizeBytes = sizeBytes;
				const receiptSetId = await editorIdentity(facts);
				await withReceiptEnvironment(async () => {
					const response = await postReceipt(
						t,
						role === "storage" ? EDITOR_STORAGE_PATH : EDITOR_INSPECTION_PATH,
						role === "storage" ? STORAGE_SECRET_A : INSPECTION_SECRET_A,
						role === "storage"
							? editorStorageSetV2(receiptSetId, facts)
							: editorInspectionSetV2(receiptSetId, facts),
					);
					expect(response.status, `${role} size ${sizeBytes}`).toBe(expectedStatus);
				});
				if (expectedStatus === 400) {
					expect((await storedState(t)).operations, `${role} size ${sizeBytes}`).toHaveLength(0);
				}
			}
		}

		for (const testCase of [
			{ field: "totalUncompressedBytes", value: 1, status: 200 },
			{ field: "totalUncompressedBytes", value: 64 * 1024 * 1024, status: 200 },
			{ field: "totalUncompressedBytes", value: 0, status: 400 },
			{ field: "totalUncompressedBytes", value: 64 * 1024 * 1024 + 1, status: 400 },
			{ field: "maximumEntryCompressionRatio", value: 1, status: 200 },
			{ field: "maximumEntryCompressionRatio", value: 100, status: 200 },
			{ field: "maximumEntryCompressionRatio", value: 0, status: 400 },
			{ field: "maximumEntryCompressionRatio", value: 100.000_001, status: 400 },
			{ field: "entryCount", value: 1, status: 200 },
			{ field: "entryCount", value: 10_000, status: 200 },
			{ field: "entryCount", value: 0, status: 400 },
			{ field: "entryCount", value: 10_001, status: 400 },
		] as const) {
			const t = convexTest(schema, modules);
			const operationId =
				(testCase.status === 200 ? "e" : "f") +
				Math.abs(Math.trunc(testCase.value)).toString(16).padStart(39, "0").slice(-39);
			const facts = editorPaidFacts(SITE_A, operationId);
			const receiptSetId = await editorIdentity(facts);
			const receiptSet = editorInspectionSetV2(receiptSetId, facts);
			const receipt = receiptSet.receipts[0];
			if (receipt?.inspection.method !== "safe_zip_v1") throw new Error("fixture drift");
			receipt.inspection[testCase.field] = testCase.value;
			await withReceiptEnvironment(async () => {
				expect(
					(await postReceipt(t, EDITOR_INSPECTION_PATH, INSPECTION_SECRET_A, receiptSet)).status,
					`${testCase.field}=${testCase.value}`,
				).toBe(testCase.status);
			});
			if (testCase.status === 400) {
				expect(
					(await storedState(t)).operations,
					`${testCase.field}=${testCase.value}`,
				).toHaveLength(0);
			}
		}
	});

	test("derives private kind from an enabled catalog product kind and fails closed on policy", async () => {
		const t = convexTest(schema, modules);
		const { adminA } = await seedClients(t);
		const facts = editorPrintFacts(SITE_A, "7".repeat(40));
		const receiptSetId = await editorIdentity(facts);
		await withReceiptEnvironment(async () => {
			await postReceipt(
				t,
				EDITOR_STORAGE_PATH,
				STORAGE_SECRET_A,
				editorStorageSetV2(receiptSetId, facts),
			);
			await postReceipt(
				t,
				EDITOR_INSPECTION_PATH,
				INSPECTION_SECRET_A,
				editorInspectionSetV2(receiptSetId, facts),
			);
		});
		const args = { siteUrl: SITE_A, operationId: editorOperationId(facts) };
		expect(
			await adminA.query(api.catalogPrivateAssets.resolveEditorUpload, {
				...args,
				productKind: "print_set",
			}),
		).toMatchObject({ kind: "print_source" });
		await expect(
			adminA.query(api.catalogPrivateAssets.resolveEditorUpload, {
				...args,
				productKind: "postcard",
			}),
		).rejects.toThrow(/does not support private upload resolution/i);

		await t.mutation(internal.platform.setCatalogProductKinds, {
			siteUrl: SITE_A,
			catalogProductKinds: [],
		});
		await expect(
			adminA.query(api.catalogPrivateAssets.resolveEditorUpload, {
				...args,
				productKind: "print",
			}),
		).rejects.toThrow(/not enabled/i);
		await t.run(async (ctx) => {
			const client = await ctx.db
				.query("platformClients")
				.withIndex("by_siteUrl", (q) => q.eq("siteUrl", SITE_A))
				.unique();
			if (!client) throw new Error("fixture drift");
			await ctx.db.patch(client._id, { catalogProductKinds: undefined });
		});
		await expect(
			adminA.query(api.catalogPrivateAssets.resolveEditorUpload, {
				...args,
				productKind: "print",
			}),
		).rejects.toThrow(/policy is not configured/i);
	});

	test("fails resolution when verified authority or target state drifts and the query writes nothing", async () => {
		for (const corruption of ["authority", "target", "binding"] as const) {
			const t = convexTest(schema, modules);
			const { adminA } = await seedClients(t);
			const facts = editorPrintFacts(
				SITE_A,
				corruption === "authority"
					? "4".repeat(40)
					: corruption === "target"
						? "5".repeat(40)
						: "6".repeat(40),
			);
			const receiptSetId = await editorIdentity(facts);
			await withReceiptEnvironment(async () => {
				await postReceipt(
					t,
					EDITOR_STORAGE_PATH,
					STORAGE_SECRET_A,
					editorStorageSetV2(receiptSetId, facts),
				);
				await postReceipt(
					t,
					EDITOR_INSPECTION_PATH,
					INSPECTION_SECRET_A,
					editorInspectionSetV2(receiptSetId, facts),
				);
				if (corruption === "binding") {
					const otherFacts = editorPrintFacts(SITE_A, "9".repeat(40));
					const otherReceiptSetId = await editorIdentity(otherFacts);
					await postReceipt(
						t,
						EDITOR_STORAGE_PATH,
						STORAGE_SECRET_A,
						editorStorageSetV2(otherReceiptSetId, otherFacts),
					);
					await postReceipt(
						t,
						EDITOR_INSPECTION_PATH,
						INSPECTION_SECRET_A,
						editorInspectionSetV2(otherReceiptSetId, otherFacts),
					);
				}
			});
			await t.run(async (ctx) => {
				if (corruption === "binding") {
					const [binding, otherBinding] = await Promise.all([
						ctx.db
							.query("catalogPrivateAssetEditorOperations")
							.withIndex("by_siteUrl_and_operationId", (q) =>
								q.eq("siteUrl", SITE_A).eq("operationId", editorOperationId(facts)),
							)
							.unique(),
						ctx.db
							.query("catalogPrivateAssetEditorOperations")
							.withIndex("by_siteUrl_and_operationId", (q) =>
								q.eq("siteUrl", SITE_A).eq("operationId", "9".repeat(40)),
							)
							.unique(),
					]);
					if (!binding || !otherBinding) throw new Error("missing binding fixture");
					await ctx.db.patch(binding._id, {
						receiptSetId: otherBinding.receiptSetId,
						assetSetChecksum: otherBinding.assetSetChecksum,
					});
					return;
				}
				if (corruption === "authority") {
					const authority = await ctx.db.query("catalogPrivateAssetTargetAuthorities").first();
					if (!authority) throw new Error("missing authority fixture");
					await ctx.db.delete(authority._id);
					return;
				}
				const target = await ctx.db.query("catalogPrintSourceAssets").first();
				if (!target) throw new Error("missing target fixture");
				await ctx.db.patch(target._id, { sizeBytes: target.sizeBytes + 1 });
			});
			const beforeQuery = JSON.stringify(await storedState(t));
			await expect(
				adminA.query(api.catalogPrivateAssets.resolveEditorUpload, {
					siteUrl: SITE_A,
					operationId: editorOperationId(facts),
					productKind: "print",
				}),
			).rejects.toThrow(/private catalog/i);
			expect(JSON.stringify(await storedState(t))).toBe(beforeQuery);
		}
	});
});
