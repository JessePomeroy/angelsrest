/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import { describe, expect, test, vi } from "vitest";
import {
	EDITOR_INSPECTION_PATH,
	EDITOR_STORAGE_PATH,
	editorInspectionSetV2,
	editorPaidFacts,
	editorPrintFacts,
	editorStorageSetV2,
	INSPECTION_PATH,
	INSPECTION_SECRET_A,
	inspectionSet,
	inspectionSetV2,
	postReceipt,
	SITE_A,
	STORAGE_PATH,
	STORAGE_SECRET_A,
	storageSet,
	storageSetV2,
	storedState,
	withReceiptEnvironment,
} from "../test/catalogPrivateAssetReceiptFixtures";
import {
	catalogPrivateAssetValidationError,
	catalogPrivateEditorPrevalidationHttpStatus,
	catalogPrivateEditorReceiptError,
	catalogPrivateEditorReceiptHttpStatus,
} from "./helpers/catalogPrivateAssetEditorErrors";
import {
	createCatalogPrivateAssetReceiptSetId,
	validateCatalogPrivateEditorStorageReceiptSet,
} from "./helpers/catalogPrivateAssetReceiptValidation";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

describe("private catalog editor receipt HTTP boundary", () => {
	test("keeps receipt roles disjoint and fails closed for missing or overlapping registries", async () => {
		const t = convexTest(schema, modules);
		const facts = editorPrintFacts();
		const receiptSetId = await createCatalogPrivateAssetReceiptSetId(SITE_A, [facts], 2);
		const receipt = editorStorageSetV2(receiptSetId, facts);
		await withReceiptEnvironment(async () => {
			expect((await postReceipt(t, EDITOR_STORAGE_PATH, INSPECTION_SECRET_A, receipt)).status).toBe(
				401,
			);
			expect((await postReceipt(t, EDITOR_INSPECTION_PATH, STORAGE_SECRET_A, receipt)).status).toBe(
				401,
			);
		});
		await withReceiptEnvironment(
			async () => {
				const response = await postReceipt(t, EDITOR_STORAGE_PATH, STORAGE_SECRET_A, receipt);
				expect(response.status).toBe(503);
				expect(response.headers.get("Cache-Control")).toBe("no-store");
				expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
			},
			{
				inspection: JSON.stringify({ [SITE_A]: [STORAGE_SECRET_A] }),
			},
		);
		await withReceiptEnvironment(async () => {
			delete process.env.CATALOG_PRIVATE_ASSET_INSPECTION_RECEIPT_SECRETS;
			expect((await postReceipt(t, EDITOR_STORAGE_PATH, STORAGE_SECRET_A, receipt)).status).toBe(
				503,
			);
		});
		expect((await storedState(t)).coordinations).toHaveLength(0);
	});

	test("rejects unknown fields and returns only generic bounded conflict evidence", async () => {
		const t = convexTest(schema, modules);
		const facts = editorPrintFacts();
		const receiptSetId = await createCatalogPrivateAssetReceiptSetId(SITE_A, [facts], 2);
		const receipt = editorStorageSetV2(receiptSetId, facts);
		const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
		try {
			await withReceiptEnvironment(async () => {
				const unknownField = await t.fetch(EDITOR_STORAGE_PATH, {
					method: "POST",
					headers: {
						Authorization: `Bearer ${STORAGE_SECRET_A}`,
						"Content-Type": "application/json",
					},
					body: JSON.stringify({ ...receipt, operationId: "must-not-be-accepted" }),
				});
				expect(unknownField.status).toBe(400);

				const nestedUnknown = structuredClone(receipt);
				Reflect.set(nestedUnknown.receipts[0]?.facts ?? {}, "browserOnlyKey", "reject");
				expect(
					(await postReceipt(t, EDITOR_STORAGE_PATH, STORAGE_SECRET_A, nestedUnknown)).status,
				).toBe(400);

				const accepted = await postReceipt(t, EDITOR_STORAGE_PATH, STORAGE_SECRET_A, receipt);
				expect(accepted.status).toBe(200);
				const pending = JSON.stringify(await storedState(t));
				const driftedFacts = structuredClone(facts);
				driftedFacts.originalFilename = "changed-under-bound-operation.jpg";
				const driftedId = await createCatalogPrivateAssetReceiptSetId(SITE_A, [driftedFacts], 2);
				const conflict = await postReceipt(
					t,
					EDITOR_INSPECTION_PATH,
					INSPECTION_SECRET_A,
					editorInspectionSetV2(driftedId, driftedFacts),
				);
				expect(conflict.status).toBe(409);
				expect(conflict.headers.get("Cache-Control")).toBe("no-store");
				expect(conflict.headers.get("X-Content-Type-Options")).toBe("nosniff");
				const body = await conflict.text();
				expect(body).toBe("Private catalog inspection receipt could not be accepted");
				expect(body).not.toContain(receiptSetId);
				expect(body).not.toContain(facts.assetKey);
				expect(body).not.toContain(facts.privateObjectKey);
				expect(JSON.stringify(await storedState(t))).toBe(pending);
			});
			expect(error).toHaveBeenCalledTimes(1);
			const logged = error.mock.calls.flat().join(" ");
			expect(logged).toContain("cms.catalog_private_receipt_rejected");
			expect(logged).toContain("editor_upload");
			expect(logged).not.toContain(receiptSetId);
			expect(logged).not.toContain(facts.assetKey);
			expect(logged).not.toContain(facts.privateObjectKey);
			expect(logged).not.toContain(facts.sha256);
		} finally {
			error.mockRestore();
		}
		expect((await storedState(t)).coordinations).toHaveLength(1);
	});

	test("classifies only closed validation errors while unknown failures remain retryable", () => {
		expect(
			catalogPrivateEditorPrevalidationHttpStatus(
				catalogPrivateAssetValidationError(
					"Private catalog editor facts contain an unsupported field",
				),
			),
		).toBe(400);
		expect(
			catalogPrivateEditorPrevalidationHttpStatus(catalogPrivateEditorReceiptError("validation")),
		).toBe(400);
		expect(
			catalogPrivateEditorPrevalidationHttpStatus(
				new Error("Private catalog database unavailable"),
			),
		).toBe(503);
		expect(
			catalogPrivateEditorReceiptHttpStatus(catalogPrivateEditorReceiptError("validation")),
		).toBe(400);
		expect(
			catalogPrivateEditorReceiptHttpStatus(catalogPrivateEditorReceiptError("conflict")),
		).toBe(409);
		expect(catalogPrivateEditorReceiptHttpStatus(new Error("database unavailable"))).toBe(503);
		expect(
			catalogPrivateEditorReceiptHttpStatus({
				data: { scope: "catalog_private_editor_receipt", category: "conflict" },
			}),
		).toBe(503);
	});

	test("keeps an unknown failure inside prevalidation retryable even with a validation-like message", async () => {
		const unknownInput = new Proxy(
			{},
			{
				ownKeys() {
					throw new Error("Private catalog database unavailable");
				},
			},
		);
		let failure: unknown;
		try {
			await validateCatalogPrivateEditorStorageReceiptSet(unknownInput);
		} catch (error) {
			failure = error;
		}
		expect(failure).toBeInstanceOf(Error);
		expect(catalogPrivateEditorPrevalidationHttpStatus(failure)).toBe(503);
	});

	test("applies strict reservations and pinned policy to canonical receipts on historical ingress", async () => {
		for (const policyCase of ["image", "zip"] as const) {
			const t = convexTest(schema, modules);
			const facts =
				policyCase === "image"
					? editorPrintFacts(SITE_A, "a".repeat(40))
					: editorPaidFacts(SITE_A, "b".repeat(40));
			const receiptSetId = await createCatalogPrivateAssetReceiptSetId(SITE_A, [facts], 2);
			const inspection = editorInspectionSetV2(receiptSetId, facts);
			const receipt = inspection.receipts[0];
			if (!receipt) throw new Error("fixture drift");
			if (receipt.inspection.method === "sharp_libvips_full_raster_v1") {
				receipt.inspection.sharpVersion = "0.34.5";
			} else {
				receipt.inspection.totalUncompressedBytes = 64 * 1024 * 1024 + 1;
			}
			await withReceiptEnvironment(async () => {
				const response = await postReceipt(t, INSPECTION_PATH, INSPECTION_SECRET_A, inspection);
				expect(response.status, policyCase).toBe(409);
			});
			expect(await storedState(t), policyCase).toEqual({
				operations: [],
				coordinations: [],
				authorities: [],
				printSources: [],
				paidFiles: [],
			});
		}

		const t = convexTest(schema, modules);
		const facts = editorPrintFacts(SITE_A, "c".repeat(40));
		const receiptSetId = await createCatalogPrivateAssetReceiptSetId(SITE_A, [facts], 2);
		await withReceiptEnvironment(async () => {
			expect(
				(await postReceipt(t, STORAGE_PATH, STORAGE_SECRET_A, storageSetV2(receiptSetId, [facts])))
					.status,
			).toBe(200);
			const pending = await storedState(t);
			expect(pending.operations).toEqual([
				expect.objectContaining({
					operationId: "c".repeat(40),
					receiptSetId,
					assetKey: facts.assetKey,
				}),
			]);
			expect(pending.coordinations).toEqual([
				expect.objectContaining({ status: "pending_inspection", receiptSetId }),
			]);

			const unpinned = editorInspectionSetV2(receiptSetId, facts);
			const unpinnedReceipt = unpinned.receipts[0];
			if (unpinnedReceipt?.inspection.method !== "sharp_libvips_full_raster_v1") {
				throw new Error("fixture drift");
			}
			unpinnedReceipt.inspection.libvipsVersion = "8.17.3";
			expect((await postReceipt(t, INSPECTION_PATH, INSPECTION_SECRET_A, unpinned)).status).toBe(
				409,
			);
			expect(await storedState(t)).toEqual(pending);
		});
		const state = await storedState(t);
		expect(state.authorities).toHaveLength(0);
		expect(state.printSources).toHaveLength(0);
		expect(state.paidFiles).toHaveLength(0);
	});

	test("pairs historical and dedicated roles exactly through one shared editor admission", async () => {
		for (const [index, paths] of [
			[0, { storage: STORAGE_PATH, inspection: EDITOR_INSPECTION_PATH }],
			[1, { storage: EDITOR_STORAGE_PATH, inspection: INSPECTION_PATH }],
		] as const) {
			const t = convexTest(schema, modules);
			const operationId = `${index + 4}`.repeat(40);
			const facts = editorPrintFacts(SITE_A, operationId);
			const receiptSetId = await createCatalogPrivateAssetReceiptSetId(SITE_A, [facts], 2);
			const storage = editorStorageSetV2(receiptSetId, facts);
			const inspection = editorInspectionSetV2(receiptSetId, facts);
			await withReceiptEnvironment(async () => {
				expect((await postReceipt(t, paths.storage, STORAGE_SECRET_A, storage)).status).toBe(200);
				expect(
					(await postReceipt(t, paths.inspection, INSPECTION_SECRET_A, inspection)).status,
				).toBe(200);
				const verified = await storedState(t);
				expect(verified.operations).toEqual([
					expect.objectContaining({
						operationId,
						receiptSetId,
						assetSetChecksum: expect.any(String),
					}),
				]);
				expect(verified.coordinations).toEqual([
					expect.objectContaining({
						status: "verified",
						receiptSetId,
						targetBindings: [expect.objectContaining({ assetKey: facts.assetKey })],
					}),
				]);
				expect(verified.authorities).toHaveLength(1);
				expect(verified.printSources).toHaveLength(1);
				expect(verified.paidFiles).toHaveLength(0);

				const exactState = JSON.stringify(verified);
				const replayStoragePath =
					paths.storage === STORAGE_PATH ? EDITOR_STORAGE_PATH : STORAGE_PATH;
				const replayInspectionPath =
					paths.inspection === INSPECTION_PATH ? EDITOR_INSPECTION_PATH : INSPECTION_PATH;
				expect((await postReceipt(t, replayStoragePath, STORAGE_SECRET_A, storage)).status).toBe(
					200,
				);
				expect(
					(await postReceipt(t, replayInspectionPath, INSPECTION_SECRET_A, inspection)).status,
				).toBe(200);
				expect(JSON.stringify(await storedState(t))).toBe(exactState);
			});
		}
	});

	test("conflicts divergent operation facts and rejects mixed or malformed canonical sets on historical ingress", async () => {
		const t = convexTest(schema, modules);
		const operationId = "6".repeat(40);
		const facts = editorPrintFacts(SITE_A, operationId);
		const receiptSetId = await createCatalogPrivateAssetReceiptSetId(SITE_A, [facts], 2);
		await withReceiptEnvironment(async () => {
			expect(
				(await postReceipt(t, STORAGE_PATH, STORAGE_SECRET_A, storageSetV2(receiptSetId, [facts])))
					.status,
			).toBe(200);
			const pending = JSON.stringify(await storedState(t));
			const divergent = structuredClone(facts);
			divergent.originalFilename = "divergent-historical-operation.jpg";
			const divergentId = await createCatalogPrivateAssetReceiptSetId(SITE_A, [divergent], 2);
			expect(
				(
					await postReceipt(
						t,
						INSPECTION_PATH,
						INSPECTION_SECRET_A,
						editorInspectionSetV2(divergentId, divergent),
					)
				).status,
			).toBe(409);
			expect(JSON.stringify(await storedState(t))).toBe(pending);
		});

		for (const invalidFacts of [
			[editorPrintFacts(SITE_A, "7".repeat(40)), editorPaidFacts(SITE_A, "8".repeat(40))],
			(() => {
				const malformed = editorPrintFacts(SITE_A, "9".repeat(40));
				malformed.assetKey = "editor-upload-not-an-operation";
				malformed.privateObjectKey = `sites/${SITE_A}/catalog/print-sources/${malformed.assetKey}/original`;
				if (malformed.provenance.provider !== "editor_upload") throw new Error("fixture drift");
				malformed.provenance.sourceId = "historical-editor-receipt";
				return [malformed];
			})(),
		]) {
			const invalid = convexTest(schema, modules);
			const invalidId = await createCatalogPrivateAssetReceiptSetId(SITE_A, invalidFacts, 2);
			await withReceiptEnvironment(async () => {
				expect(
					(
						await postReceipt(
							invalid,
							STORAGE_PATH,
							STORAGE_SECRET_A,
							storageSetV2(invalidId, invalidFacts),
						)
					).status,
				).toBe(409);
			});
			expect(await storedState(invalid)).toEqual({
				operations: [],
				coordinations: [],
				authorities: [],
				printSources: [],
				paidFiles: [],
			});
		}
	});

	test("keeps dedicated admission additive while retaining V1 and noncanonical editor provenance", async () => {
		const t = convexTest(schema, modules);
		const v1Facts = editorPrintFacts(SITE_A, "1".repeat(40));
		const v2Facts = editorPrintFacts(SITE_A, "2".repeat(40));
		v2Facts.assetKey = "legacy-editor-upload-v2";
		v2Facts.privateObjectKey = `sites/${SITE_A}/catalog/print-sources/${v2Facts.assetKey}/original`;
		if (v2Facts.provenance.provider !== "editor_upload") throw new Error("fixture drift");
		v2Facts.provenance.sourceId = "historical-editor-receipt-v2";
		const [v1ReceiptSetId, v2ReceiptSetId] = await Promise.all([
			createCatalogPrivateAssetReceiptSetId(SITE_A, [v1Facts], 1),
			createCatalogPrivateAssetReceiptSetId(SITE_A, [v2Facts], 2),
		]);
		await withReceiptEnvironment(async () => {
			expect(
				(
					await postReceipt(
						t,
						EDITOR_STORAGE_PATH,
						STORAGE_SECRET_A,
						storageSet([v1Facts], v1ReceiptSetId),
					)
				).status,
			).toBe(400);

			for (const [path, secret, receipt] of [
				[STORAGE_PATH, STORAGE_SECRET_A, storageSet([v1Facts], v1ReceiptSetId)],
				[INSPECTION_PATH, INSPECTION_SECRET_A, inspectionSet([v1Facts], v1ReceiptSetId)],
				[STORAGE_PATH, STORAGE_SECRET_A, storageSetV2(v2ReceiptSetId, [v2Facts])],
				[INSPECTION_PATH, INSPECTION_SECRET_A, inspectionSetV2(v2ReceiptSetId, [v2Facts])],
			] as const) {
				const response = await postReceipt(t, path, secret, receipt);
				expect(response.status).toBe(200);
			}
		});
		const state = await storedState(t);
		expect(state.operations).toHaveLength(0);
		expect(state.coordinations).toHaveLength(2);
		expect(state.coordinations.every((coordination) => coordination.status === "verified")).toBe(
			true,
		);
		expect(state.authorities).toHaveLength(2);
		expect(state.printSources).toHaveLength(2);
		expect(state.paidFiles).toHaveLength(0);
	});

	test("maps every malformed nested editor receipt shape to HTTP 400 without reservations", async () => {
		const t = convexTest(schema, modules);
		const facts = editorPrintFacts();
		const receiptSetId = await createCatalogPrivateAssetReceiptSetId(SITE_A, [facts], 2);
		const storage = editorStorageSetV2(receiptSetId, facts);
		const inspection = editorInspectionSetV2(receiptSetId, facts);
		const storageReceipt = storage.receipts[0];
		const inspectionReceipt = inspection.receipts[0];
		if (!storageReceipt || !inspectionReceipt) throw new Error("fixture drift");
		const { provenance: _provenance, ...factsWithoutProvenance } = storageReceipt.facts;
		const storageCase = (label: string, receipts: unknown) => ({
			label,
			path: EDITOR_STORAGE_PATH,
			secret: STORAGE_SECRET_A,
			body: { ...storage, receipts },
		});
		const inspectionCase = (label: string, receipts: unknown) => ({
			label,
			path: EDITOR_INSPECTION_PATH,
			secret: INSPECTION_SECRET_A,
			body: { ...inspection, receipts },
		});
		const malformedCases = [
			storageCase("receipts null", null),
			storageCase("empty receipt", [{}]),
			storageCase("missing facts", [
				{
					uploadedAt: storageReceipt.uploadedAt,
					etag: storageReceipt.etag,
				},
			]),
			storageCase("facts null", [{ ...storageReceipt, facts: null }]),
			storageCase("facts array", [{ ...storageReceipt, facts: [] }]),
			storageCase("facts primitive", [{ ...storageReceipt, facts: "invalid" }]),
			storageCase("missing provenance", [
				{
					...storageReceipt,
					facts: factsWithoutProvenance,
				},
			]),
			storageCase("provenance null", [
				{
					...storageReceipt,
					facts: { ...storageReceipt.facts, provenance: null },
				},
			]),
			storageCase("provenance array", [
				{
					...storageReceipt,
					facts: { ...storageReceipt.facts, provenance: [] },
				},
			]),
			storageCase("provenance primitive", [
				{
					...storageReceipt,
					facts: { ...storageReceipt.facts, provenance: 42 },
				},
			]),
			storageCase("provenance unknown field", [
				{
					...storageReceipt,
					facts: {
						...storageReceipt.facts,
						provenance: {
							...storageReceipt.facts.provenance,
							sourceRevision: "reject",
						},
					},
				},
			]),
			storageCase("wrong facts primitive", [
				{
					...storageReceipt,
					facts: { ...storageReceipt.facts, sizeBytes: "8000000" },
				},
			]),
			storageCase("wrong receipt primitive", [{ ...storageReceipt, uploadedAt: null }]),
			inspectionCase("missing inspection", [{ facts: inspectionReceipt.facts }]),
			inspectionCase("inspection null", [{ ...inspectionReceipt, inspection: null }]),
			inspectionCase("inspection array", [{ ...inspectionReceipt, inspection: [] }]),
			inspectionCase("inspection primitive", [
				{
					...inspectionReceipt,
					inspection: "invalid",
				},
			]),
		];
		await withReceiptEnvironment(async () => {
			for (const malformed of malformedCases) {
				const response = await t.fetch(malformed.path, {
					method: "POST",
					headers: {
						Authorization: `Bearer ${malformed.secret}`,
						"Content-Type": "application/json",
					},
					body: JSON.stringify(malformed.body),
				});
				expect(response.status, malformed.label).toBe(400);
				expect(await response.text(), malformed.label).toBe("Invalid request");
				expect((await storedState(t)).operations, malformed.label).toHaveLength(0);
			}
		});
		const state = await storedState(t);
		expect(state.operations).toHaveLength(0);
		expect(state.coordinations).toHaveLength(0);
	});

	test("rejects declared overflow, wrong content, malformed JSON, and nested unknown data", async () => {
		const t = convexTest(schema, modules);
		const facts = editorPrintFacts();
		const receiptSetId = await createCatalogPrivateAssetReceiptSetId(SITE_A, [facts], 2);
		const receipt = editorStorageSetV2(receiptSetId, facts);
		await withReceiptEnvironment(async () => {
			const request = async (headers: Record<string, string>, body: string) =>
				await t.fetch(EDITOR_STORAGE_PATH, {
					method: "POST",
					headers: { Authorization: `Bearer ${STORAGE_SECRET_A}`, ...headers },
					body,
				});
			expect(
				(
					await request(
						{
							"Content-Type": "application/json",
							"Content-Length": String(32 * 1024 + 1),
						},
						JSON.stringify(receipt),
					)
				).status,
			).toBe(400);
			expect(
				(await request({ "Content-Type": "text/plain" }, JSON.stringify(receipt))).status,
			).toBe(400);
			expect((await request({ "Content-Type": "application/json" }, "{broken")).status).toBe(400);
			const nested = structuredClone(receipt);
			Reflect.set(nested.receipts[0] ?? {}, "unknown", true);
			expect(
				(await request({ "Content-Type": "application/json" }, JSON.stringify(nested))).status,
			).toBe(400);
		});
		expect((await storedState(t)).operations).toHaveLength(0);
	});
});
