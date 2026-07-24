/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import type { Id } from "./_generated/dataModel";
import { describe, expect, test, vi } from "vitest";
import {
	editorInspectionSetV2,
	editorPaidFacts,
	editorPrintFacts,
	editorStorageSetV2,
	inspectionSet,
	storageSet,
} from "../test/catalogPrivateAssetReceiptFixtures";
import { api, internal } from "./_generated/api";
import {
	CATALOG_EDITOR_CAPABILITY_PURGE_SKEW_MS,
	CATALOG_EDITOR_CONTINUATION_TTL_MS,
	CATALOG_EDITOR_UPLOAD_TOKEN_TTL_MS,
	catalogEditorCapabilityDigest,
	catalogEditorRawCapabilityFingerprint,
} from "./helpers/catalogPrivateAssetEditorJournal";
import type {
	CatalogPrivateInspectionReceiptSet,
	CatalogPrivateStorageReceiptSet,
} from "./helpers/catalogPrivateAssetReceiptContract";
import { createCatalogPrivateAssetReceiptSetId } from "./helpers/catalogPrivateAssetReceiptValidation";
import schema from "./schema";
import observerSource from "./catalogAcceptanceObserver.ts?raw";
import generatedApiSource from "./_generated/api.d.ts?raw";
import httpSource from "./http.ts?raw";
import privateAssetsSource from "./catalogPrivateAssets.ts?raw";

const modules = import.meta.glob("./**/*.ts");
const SITE = "angelsrest.online";
const FOREIGN_SITE = "foreign.example";
const AGGREGATE_ERROR = "Acceptance aggregate observation failed";
const POINT_ERROR = "Acceptance completed-asset observation failed";
const observeAggregate = internal.catalogAcceptanceObserver.observeAggregate;
const observeCompletedAsset = internal.catalogAcceptanceObserver.observeCompletedAsset;

type TestClient = ReturnType<typeof convexTest>;
type AssetKind = "print_source" | "paid_digital_file";

const EXPECTED_POINT = {
	interfaceVersion: "cms-5.5e.2c.5.point.v1",
	result: "verified_unattached",
	checks: {
		journal: true,
		effects: true,
		coordination: true,
		authority: true,
		target: true,
		unattached: true,
	},
} as const;

function token(character: string) {
	return `cms-editor-upload-v1.${character.repeat(2768)}`;
}

async function seedClient(t: TestClient, siteUrl = SITE) {
	await t.mutation(internal.platform.seedClient, {
		name: siteUrl,
		email: `operator@${siteUrl}`,
		siteUrl,
		tier: "full",
		subscriptionStatus: "active",
		adminEmails: [`operator@${siteUrl}`],
		role: "client",
		catalogProductKinds: ["print", "print_set", "digital_download"],
	});
}

async function seedCompletedAsset(
	kind: AssetKind,
	options: { filename?: string; operationCharacter?: string } = {},
) {
	const t = convexTest(schema, modules);
	await seedClient(t);
	const operationId = (options.operationCharacter ?? (kind === "print_source" ? "a" : "b")).repeat(40);
	const uploadHandleHash = (kind === "print_source" ? "1" : "2").repeat(64);
	const descriptor = kind === "print_source"
		? {
				productKind: "print" as const,
				kind,
				originalFilename: options.filename ?? "acceptance-print.jpg",
				contentType: "image/jpeg" as const,
				sizeBytes: 8_000_000,
				sha256: "c".repeat(64),
				widthPixels: 6000,
				heightPixels: 4000,
			}
		: {
				productKind: "digital_download" as const,
				kind,
				originalFilename: options.filename ?? "acceptance-download.zip",
				contentType: "application/zip" as const,
				sizeBytes: 15_064,
				sha256: "d".repeat(64),
				version: "2.0.0",
			};
	const reservation = await t.mutation(internal.catalogPrivateAssets.beginEditorJournal, {
		siteUrl: SITE,
		uploadHandleHash,
		proposedOperationId: operationId,
		descriptor,
	});
	const issuedAt = Date.now();
	const capability = async (
		purpose: "upload" | "storage" | "inspection",
		character: string,
	) => {
		const value = token(character);
		return {
			value,
			digest: await catalogEditorCapabilityDigest(purpose, value),
			rawFingerprint: await catalogEditorRawCapabilityFingerprint(value),
			issuedAt,
			expiresAt: issuedAt + (
				purpose === "upload"
					? CATALOG_EDITOR_UPLOAD_TOKEN_TTL_MS
					: CATALOG_EDITOR_CONTINUATION_TTL_MS
			),
		};
	};
	await t.mutation(internal.catalogPrivateAssets.commitEditorPrepare, {
		siteUrl: SITE,
		uploadHandleHash,
		operationId,
		declarationHash: reservation.declarationHash,
		generation: 1,
		upload: await capability("upload", "u"),
		storage: await capability("storage", "s"),
		inspection: await capability("inspection", "i"),
	});
	const facts = kind === "print_source"
		? editorPrintFacts(SITE, operationId)
		: editorPaidFacts(SITE, operationId);
	facts.originalFilename = descriptor.originalFilename;
	const receiptSetId = await createCatalogPrivateAssetReceiptSetId(SITE, [facts], 2);
	const storageReceipt = editorStorageSetV2(receiptSetId, facts);
	const inspectionReceipt = editorInspectionSetV2(receiptSetId, facts);
	await t.mutation(internal.catalogPrivateAssets.recordEditorStorageReceipt, {
		receiptSet: storageReceipt,
	});
	await t.mutation(internal.catalogPrivateAssets.recordEditorInspectionReceipt, {
		receiptSet: inspectionReceipt,
	});
	const state = await t.run(async (ctx) => {
		const operation = await ctx.db.query("catalogPrivateAssetEditorOperations")
			.withIndex("by_siteUrl_and_operationId", (q) =>
				q.eq("siteUrl", SITE).eq("operationId", operationId)
			)
			.unique();
		const coordination = await ctx.db.query("catalogPrivateAssetReceiptCoordinations")
			.withIndex("by_siteUrl_and_receiptSetId", (q) =>
				q.eq("siteUrl", SITE).eq("receiptSetId", receiptSetId)
			)
			.unique();
		const authority = coordination
			? await ctx.db.query("catalogPrivateAssetTargetAuthorities")
				.withIndex("by_originCoordinationId_and_kind_and_assetKey", (q) =>
					q.eq("originCoordinationId", coordination._id)
						.eq("kind", kind)
						.eq("assetKey", facts.assetKey)
				)
				.unique()
			: null;
		return { operation, coordination, authority };
	});
	if (
		!state.operation
		|| !state.coordination
		|| state.coordination.status !== "verified"
		|| !state.authority
	) {
		throw new Error("completed acceptance fixture is incomplete");
	}
	return {
		t,
		kind,
		assetId: state.authority.assetId,
		operationId,
		operation: state.operation,
		coordination: state.coordination,
		authority: state.authority,
		storageReceipt,
		inspectionReceipt,
	};
}

async function databaseSnapshot(t: TestClient) {
	return await t.run(async (ctx) => ({
		operations: await ctx.db.query("catalogPrivateAssetEditorOperations").take(200),
		capabilities: await ctx.db.query("catalogPrivateAssetEditorCapabilities").take(200),
		effects: await ctx.db.query("catalogPrivateAssetEditorEffects").take(200),
		coordinations: await ctx.db.query("catalogPrivateAssetReceiptCoordinations").take(200),
		authorities: await ctx.db.query("catalogPrivateAssetTargetAuthorities").take(200),
		printAssets: await ctx.db.query("catalogPrintSourceAssets").take(200),
		digitalAssets: await ctx.db.query("catalogDigitalFileAssets").take(200),
		products: await ctx.db.query("catalogProducts").take(200),
		revisions: await ctx.db.query("catalogProductRevisions").take(200),
		variants: await ctx.db.query("catalogProductVariants").take(300),
		mediaPlacements: await ctx.db.query("catalogProductMediaPlacements").take(300),
		printRelations: await ctx.db.query("catalogProductPrintSources").take(200),
		setMembers: await ctx.db.query("catalogProductSetMembers").take(200),
		digitalRelations: await ctx.db.query("catalogProductDigitalFiles").take(200),
		shopPlacements: await ctx.db.query("catalogProductShopPlacements").take(200),
		orders: await ctx.db.query("orders").take(200),
		scheduled: await ctx.db.system.query("_scheduled_functions").take(200),
	}));
}

function privatePrintAsset(siteUrl: string, index: number) {
	return {
		siteUrl,
		assetKey: `bound-print-${index}`,
		privateObjectKey: `sites/${siteUrl}/catalog/print-sources/bound-${index}/original`,
		status: "verified" as const,
		originalFilename: `bound-${index}.jpg`,
		mimeType: "image/jpeg" as const,
		sizeBytes: 100,
		widthPixels: 10,
		heightPixels: 10,
		sha256: index.toString(16).padStart(64, "0"),
		provenance: { provider: "editor_upload" as const, sourceId: `bound:${index}` },
		createdAt: index,
		createdBy: "test",
		verifiedAt: index,
		verifiedBy: "test",
	};
}

function privateDigitalAsset(siteUrl: string, index: number) {
	return {
		siteUrl,
		assetKey: `bound-digital-${index}`,
		privateObjectKey: `sites/${siteUrl}/catalog/paid-digital-files/bound-${index}/original`,
		status: "verified" as const,
		originalFilename: `bound-${index}.zip`,
		mimeType: "application/zip" as const,
		sizeBytes: 100,
		sha256: (index + 10_000).toString(16).padStart(64, "0"),
		provenance: { provider: "editor_upload" as const, sourceId: `bound:${index}` },
		createdAt: index,
		createdBy: "test",
		verifiedAt: index,
		verifiedBy: "test",
	};
}

async function catalogParents(t: TestClient) {
	return await t.run(async (ctx) => {
		const productId = await ctx.db.insert("catalogProducts", {
			siteUrl: FOREIGN_SITE,
			productKey: "bounds-parent",
			productKind: "print",
			createdAt: 0,
			createdBy: "test",
			updatedAt: 0,
			updatedBy: "test",
		});
		const revisionId = await ctx.db.insert("catalogProductRevisions", {
			siteUrl: FOREIGN_SITE,
			productId,
			productKind: "print",
			schemaVersion: 1,
			currency: "usd",
			fulfillmentMode: "merchant_fulfilled",
			saleAvailability: "available",
			borderOptionsEnabled: false,
			frameOptionsEnabled: false,
			framePriceMultiplierBasisPoints: 0,
			variantCount: 0,
			checksum: "bounds",
			source: "admin",
			createdAt: 0,
			createdBy: "test",
		});
		return { productId, revisionId };
	});
}

type BoundedTable =
	| "operations"
	| "capabilities"
	| "effects"
	| "coordinations"
	| "authorities"
	| "printAssets"
	| "digitalAssets"
	| "products"
	| "revisions"
	| "variants"
	| "mediaPlacements"
	| "printSources"
	| "setMembers"
	| "digitalFiles"
	| "shopPlacements"
	| "orders";

const BOUNDS: Record<BoundedTable, number> = {
	operations: 4,
	capabilities: 12,
	effects: 12,
	coordinations: 8,
	authorities: 32,
	printAssets: 32,
	digitalAssets: 8,
	products: 64,
	revisions: 128,
	variants: 256,
	mediaPlacements: 256,
	printSources: 128,
	setMembers: 128,
	digitalFiles: 64,
	shopPlacements: 64,
	orders: 128,
};

async function seedBoundedTable(t: TestClient, table: BoundedTable, count: number) {
	const parents = [
		"revisions",
		"variants",
		"mediaPlacements",
		"printSources",
		"setMembers",
		"digitalFiles",
		"shopPlacements",
	].includes(table) ? await catalogParents(t) : null;
	await t.run(async (ctx) => {
		let coordinationId: Id<"catalogPrivateAssetReceiptCoordinations"> | undefined;
		let printAssetId: Id<"catalogPrintSourceAssets"> | undefined;
		let digitalAssetId: Id<"catalogDigitalFileAssets"> | undefined;
		if (table === "authorities") {
			printAssetId = await ctx.db.insert("catalogPrintSourceAssets", privatePrintAsset(SITE, 50_000));
			const receiptSet = editorStorageSetV2(
				"catalog-private-assets-v2:" + "e".repeat(64),
				editorPrintFacts(SITE, "e".repeat(40)),
			);
			coordinationId = await ctx.db.insert("catalogPrivateAssetReceiptCoordinations", {
				siteUrl: SITE,
				receiptSetId: receiptSet.receiptSetId,
				assetSetChecksum: "authority-checksum",
				createdAt: 0,
				updatedAt: 0,
				status: "pending_inspection",
				storageReceiptChecksum: "authority-storage",
				storageReceivedAt: 0,
				storageReceiptSet: receiptSet,
			});
		}
		if (table === "printSources") {
			printAssetId = await ctx.db.insert("catalogPrintSourceAssets", privatePrintAsset(FOREIGN_SITE, 60_000));
		}
		if (table === "digitalFiles") {
			digitalAssetId = await ctx.db.insert("catalogDigitalFileAssets", privateDigitalAsset(FOREIGN_SITE, 60_000));
		}
		let mediaAssetId = await ctx.db.query("mediaAssets").first().then((row) => row?._id);
		if (table === "mediaPlacements" && !mediaAssetId) {
			throw new Error("media fixture required for media-placement bound");
		}
		for (let index = 0; index < count; index += 1) {
			switch (table) {
				case "operations":
					await ctx.db.insert("catalogPrivateAssetEditorOperations", {
						siteUrl: SITE,
						operationId: index.toString(16).padStart(40, "0"),
						sourceId: `bound:${index}`,
						kind: "print_source",
						assetKey: `bound-${index}`,
						privateObjectKey: `private/${index}`,
						createdAt: index,
					});
					break;
				case "capabilities":
					await ctx.db.insert("catalogPrivateAssetEditorCapabilities", {
						siteUrl: SITE,
						operationId: index.toString(16).padStart(40, "0"),
						purpose: "upload",
						digest: index.toString(16).padStart(64, "0"),
						issuedAt: index,
						expiresAt: index + 1,
						purgeAt: index + 2,
						generation: 1,
						createdAt: index,
						updatedAt: index,
					});
					break;
				case "effects":
					await ctx.db.insert("catalogPrivateAssetEditorEffects", {
						siteUrl: SITE,
						operationId: index.toString(16).padStart(40, "0"),
						kind: "prepare",
						generation: 1,
						state: "queued",
						attempts: 0,
						nextAttemptAt: index,
						createdAt: index,
						updatedAt: index,
					});
					break;
				case "coordinations": {
					const receiptSet = editorStorageSetV2(
						`catalog-private-assets-v2:${index.toString(16).padStart(64, "0")}`,
						editorPrintFacts(SITE, index.toString(16).padStart(40, "0")),
					);
					await ctx.db.insert("catalogPrivateAssetReceiptCoordinations", {
						siteUrl: SITE,
						receiptSetId: receiptSet.receiptSetId,
						assetSetChecksum: `checksum-${index}`,
						createdAt: index,
						updatedAt: index,
						status: "pending_inspection",
						storageReceiptChecksum: `storage-${index}`,
						storageReceivedAt: index,
						storageReceiptSet: receiptSet,
					});
					break;
				}
				case "authorities":
					await ctx.db.insert("catalogPrivateAssetTargetAuthorities", {
						siteUrl: SITE,
						kind: "print_source",
						assetKey: `authority-${index}`,
						assetId: printAssetId!,
						originCoordinationId: coordinationId!,
						originReceiptSetId: `authority-${index}`,
						originSchemaVersion: 2,
						indexedAt: index,
					});
					break;
				case "printAssets":
					await ctx.db.insert("catalogPrintSourceAssets", privatePrintAsset(SITE, index));
					break;
				case "digitalAssets":
					await ctx.db.insert("catalogDigitalFileAssets", privateDigitalAsset(SITE, index));
					break;
				case "products":
					await ctx.db.insert("catalogProducts", {
						siteUrl: SITE,
						productKey: `bound-${index}`,
						productKind: "print",
						createdAt: index,
						createdBy: "test",
						updatedAt: index,
						updatedBy: "test",
					});
					break;
				case "revisions":
					await ctx.db.insert("catalogProductRevisions", {
						siteUrl: SITE,
						productId: parents!.productId,
						productKind: "print",
						schemaVersion: 1,
						currency: "usd",
						fulfillmentMode: "merchant_fulfilled",
						saleAvailability: "available",
						borderOptionsEnabled: false,
						frameOptionsEnabled: false,
						framePriceMultiplierBasisPoints: 0,
						variantCount: 0,
						checksum: `bound-${index}`,
						source: "admin",
						createdAt: index,
						createdBy: "test",
					});
					break;
				case "variants":
					await ctx.db.insert("catalogProductVariants", {
						siteUrl: SITE,
						productId: parents!.productId,
						revisionId: parents!.revisionId,
						variantKey: `bound-${index}`,
						order: index,
						status: "enabled",
					});
					break;
				case "mediaPlacements":
					await ctx.db.insert("catalogProductMediaPlacements", {
						siteUrl: SITE,
						productId: parents!.productId,
						revisionId: parents!.revisionId,
						assetId: mediaAssetId!,
						placementKey: `bound-${index}`,
						role: "primary",
						order: index,
					});
					break;
				case "printSources":
					await ctx.db.insert("catalogProductPrintSources", {
						siteUrl: SITE,
						productId: parents!.productId,
						revisionId: parents!.revisionId,
						assetId: printAssetId!,
						relationKey: `bound-${index}`,
						order: index,
					});
					break;
				case "setMembers":
					await ctx.db.insert("catalogProductSetMembers", {
						siteUrl: SITE,
						productId: parents!.productId,
						revisionId: parents!.revisionId,
						memberKey: `bound-${index}`,
						order: index,
						mediaPlacementKey: `media-${index}`,
						printSourceKey: `print-${index}`,
					});
					break;
				case "digitalFiles":
					await ctx.db.insert("catalogProductDigitalFiles", {
						siteUrl: SITE,
						productId: parents!.productId,
						revisionId: parents!.revisionId,
						assetId: digitalAssetId!,
						relationKey: `bound-${index}`,
					});
					break;
				case "shopPlacements":
					await ctx.db.insert("catalogProductShopPlacements", {
						siteUrl: SITE,
						productId: parents!.productId,
						revisionId: parents!.revisionId,
						featured: false,
						orderRank: `bound-${index}`,
					});
					break;
				case "orders":
					await ctx.db.insert("orders", {
						siteUrl: SITE,
						orderNumber: `BOUND-${index}`,
						stripeSessionId: `cs_bound_${index}`,
						customerEmail: `bound-${index}@example.com`,
						items: [],
						total: 0,
						fulfillmentType: "self",
						status: "new",
					});
					break;
			}
		}
	});
}

async function fixtureWithMedia() {
	const t = convexTest(schema, modules);
	await t.run(async (ctx) => {
		await ctx.db.insert("mediaAssets", {
			siteUrl: FOREIGN_SITE,
			assetId: "bounds-media",
			intent: "web",
			status: "ready",
			originalFilename: "bounds.jpg",
			source: { contentType: "image/jpeg", sizeBytes: 1, width: 1, height: 1 },
			master: {
				key: "bounds/master",
				contentType: "image/webp",
				sizeBytes: 1,
				width: 1,
				height: 1,
			},
			derivatives: Object.fromEntries(
				["thumb", "card", "display1280", "display2048", "display2560"].map((name) => [
					name,
					{ key: `bounds/${name}`, contentType: "image/webp", width: 1, height: 1 },
				]),
			) as {
				thumb: { key: string; contentType: "image/webp"; width: number; height: number };
				card: { key: string; contentType: "image/webp"; width: number; height: number };
				display1280: { key: string; contentType: "image/webp"; width: number; height: number };
				display2048: { key: string; contentType: "image/webp"; width: number; height: number };
				display2560: { key: string; contentType: "image/webp"; width: number; height: number };
			},
			createdAt: 0,
			createdBy: "test",
			updatedAt: 0,
			updatedBy: "test",
		});
	});
	return t;
}

describe("CMS-5.5e.2c.5 internal acceptance observer", () => {
	test("uses exactly two generated internal functions and rejects the public candidate", () => {
		expect(observeAggregate).toBeDefined();
		expect(observeCompletedAsset).toBeDefined();
		expect(observerSource.match(/export const observe[A-Za-z]+ = internalQuery\(/g)).toHaveLength(2);
		expect(observerSource).not.toMatch(/\bexport const observe\s*=/);
		expect(observerSource).not.toMatch(/\bquery\s*\(\s*\{/);
		expect(observerSource).toContain('const SITE_URL = "angelsrest.online"');
		expect(generatedApiSource).toContain("catalogAcceptanceObserver: typeof catalogAcceptanceObserver");
		expect(generatedApiSource).toContain("declare const fullApi: ApiFromModules");
		if (false) {
			// @ts-expect-error An internal-only module has no public API member.
			void api.catalogAcceptanceObserver;
		}
	});

	test("source gate forbids variable authority, unbounded reads, effects, routes, and write-path imports", () => {
		for (const forbidden of [
			/\.collect\s*\(/,
			/\.paginate\s*\(/,
			/\.filter\s*\(/,
			/\bfetch\s*\(/,
			/\brunMutation\b/,
			/\brunAction\b/,
			/\bscheduler\b/,
			/console\./,
			/args:\s*\{[^}]*siteUrl/s,
			/args:\s*\{[^}]*tenant/s,
			/args:\s*\{[^}]*cursor/s,
			/args:\s*\{[^}]*limit/s,
		]) expect(observerSource).not.toMatch(forbidden);
		expect(httpSource).not.toContain("catalogAcceptanceObserver");
		expect(privateAssetsSource).not.toContain("catalogAcceptanceObserver");
	});

	test("aggregate is hard-pinned, stable, private, and exposes only the adjudicated projection", async () => {
		const print = await seedCompletedAsset("print_source", {
			filename: "customer+private@example.com.jpg",
		});
		await print.t.run(async (ctx) => {
			await ctx.db.insert("catalogPrivateAssetEditorOperations", {
				siteUrl: FOREIGN_SITE,
				operationId: "f".repeat(40),
				sourceId: "foreign-private-source",
				kind: "print_source",
				assetKey: "foreign-private-key",
				privateObjectKey: "foreign/private/path",
				createdAt: 9_999_999,
			});
			await ctx.db.insert("orders", {
				siteUrl: SITE,
				orderNumber: "PRIVATE-ORDER",
				stripeSessionId: "cs_private",
				stripePaymentIntentId: "pi_private",
				customerEmail: "buyer-private@example.com",
				items: [{ productName: "private product", quantity: 1, price: 10 }],
				total: 10,
				fulfillmentType: "lumaprints",
				lumaprintsOrderNumber: "LP-PRIVATE",
				trackingUrl: "https://tracking.invalid/private",
				stripeFeeCaptureStatus: "captured",
				stripeFeeCaptureLastAttemptAt: 700,
				shipmentEmailDeliveryStatus: "sent",
				shipmentEmailDeliveryAttemptedAt: 800,
				status: "shipped",
			});
		});
		const first = await print.t.query(observeAggregate, {});
		const repeated = await print.t.query(observeAggregate, {});
		expect(repeated).toEqual(first);
		expect(Object.keys(first).sort()).toEqual([
			"boundsVersion",
			"catalog",
			"commerce",
			"interfaceVersion",
			"privateState",
		]);
		expect(first).toMatchObject({
			interfaceVersion: "cms-5.5e.2c.5.aggregate.v1",
			boundsVersion: 1,
			privateState: {
				operations: { count: 1 },
				capabilities: { count: 3 },
				effects: { count: 3 },
				coordinations: { count: 1 },
				authorities: { count: 1 },
				printAssets: { count: 1 },
				digitalAssets: { count: 0 },
			},
			commerce: {
				orders: { count: 1, statuses: { shipped: 1 } },
				fulfillment: { lumaprints: 1 },
				feeCapture: { captured: 1, activityHighWater: 700 },
				lumaPrintsSubmission: { count: 1 },
				tracking: { count: 1 },
				shipmentEmail: { sent: 1, activityHighWater: 800 },
			},
		});
		const serialized = JSON.stringify(first).toLowerCase();
		for (const forbidden of [
			SITE,
			FOREIGN_SITE,
			print.operationId,
			String(print.assetId),
			"customer+private@example.com",
			"buyer-private@example.com",
			"private-order",
			"cs_private",
			"pi_private",
			"lp-private",
			"tracking.invalid",
			"foreign-private-source",
			"private/path",
			"sha256",
			"digest",
			"fingerprint",
			"lease",
			"receipt",
		]) expect(serialized).not.toContain(forbidden.toLowerCase());
	});

	test("aggregate proves exact expected deltas while catalog/publication/commerce remain equal", async () => {
		const t = convexTest(schema, modules);
		await seedClient(t);
		const before = await t.query(observeAggregate, {});
		const completed = await seedCompletedAsset("paid_digital_file");
		const after = await completed.t.query(observeAggregate, {});
		expect(after.privateState.operations.count - before.privateState.operations.count).toBe(1);
		expect(after.privateState.capabilities.count - before.privateState.capabilities.count).toBe(3);
		expect(after.privateState.effects.count - before.privateState.effects.count).toBe(3);
		expect(after.privateState.coordinations.count - before.privateState.coordinations.count).toBe(1);
		expect(after.privateState.authorities.count - before.privateState.authorities.count).toBe(1);
		expect(after.privateState.printAssets.count - before.privateState.printAssets.count).toBe(0);
		expect(after.privateState.digitalAssets.count - before.privateState.digitalAssets.count).toBe(1);
		expect(after.catalog).toEqual(before.catalog);
		expect(after.commerce).toEqual(before.commerce);
		expect(await completed.t.query(observeAggregate, {})).toEqual(after);
	});

	test.each(Object.entries(BOUNDS) as [BoundedTable, number][])(
		"fails closed at the fixed %s sentinel bound",
		async (table, limit) => {
			const atLimit = await fixtureWithMedia();
			await seedBoundedTable(atLimit, table, limit);
			await expect(atLimit.query(observeAggregate, {})).resolves.toMatchObject({
				boundsVersion: 1,
			});
			const overLimit = await fixtureWithMedia();
			await seedBoundedTable(overLimit, table, limit + 1);
			await expect(overLimit.query(observeAggregate, {})).rejects.toThrow(AGGREGATE_ERROR);
		},
		30_000,
	);

	test("the sixteen sentinels enforce the 1,340-document maximum budget", () => {
		expect(Object.values(BOUNDS).reduce((sum, limit) => sum + limit + 1, 0)).toBe(1_340);
		expect(observerSource.match(/\.take\(BOUNDS\.[A-Za-z]+ \+ 1\)/g)).toHaveLength(16);
	});

	test.each(["print_source", "paid_digital_file"] as const)(
		"point observer proves a completed unattached %s with a fixed replay-safe result",
		async (kind) => {
			const fixture = await seedCompletedAsset(kind);
			const first = await fixture.t.query(observeCompletedAsset, { assetId: fixture.assetId });
			const repeated = await fixture.t.query(observeCompletedAsset, { assetId: fixture.assetId });
			expect(first).toEqual(EXPECTED_POINT);
			expect(repeated).toEqual(first);
			expect(JSON.stringify(first)).not.toContain(String(fixture.assetId));
		},
	);

	test("rejects coupled outer receipt-set drift from both embedded receipt sets", async () => {
		const fixture = await seedCompletedAsset("print_source");
		const driftedReceiptSetId = "catalog-private-assets-v2:" + "f".repeat(64);
		await fixture.t.run(async (ctx) => {
			await Promise.all([
				ctx.db.patch(fixture.coordination._id, { receiptSetId: driftedReceiptSetId }),
				ctx.db.patch(fixture.authority._id, { originReceiptSetId: driftedReceiptSetId }),
				ctx.db.patch(fixture.operation._id, { receiptSetId: driftedReceiptSetId }),
			]);
		});
		await expect(fixture.t.query(observeCompletedAsset, { assetId: fixture.assetId }))
			.rejects.toThrow(POINT_ERROR);
	});

	test.each(["global asset id", "tenant asset key"] as const)(
		"rejects a conflicting authority in the %s index",
		async (index) => {
			const fixture = await seedCompletedAsset("print_source");
			await fixture.t.run(async (ctx) => {
				const conflictingAssetId = index === "global asset id"
					? fixture.assetId
					: await ctx.db.insert(
						"catalogPrintSourceAssets",
						privatePrintAsset(SITE, 77_777),
					);
				await ctx.db.insert("catalogPrivateAssetTargetAuthorities", {
					siteUrl: index === "global asset id" ? FOREIGN_SITE : SITE,
					kind: "print_source",
					assetKey: index === "tenant asset key"
						? fixture.authority.assetKey
						: "foreign-authority-key",
					assetId: conflictingAssetId as Id<"catalogPrintSourceAssets">,
					originCoordinationId: fixture.coordination._id,
					originReceiptSetId: fixture.coordination.receiptSetId,
					originSchemaVersion: 2,
					indexedAt: fixture.authority.indexedAt,
				});
			});
			await expect(fixture.t.query(observeCompletedAsset, { assetId: fixture.assetId }))
				.rejects.toThrow(POINT_ERROR);
		},
	);

	test("point work is unaffected by unrelated tenant and journal growth", async () => {
		const fixture = await seedCompletedAsset("print_source");
		await fixture.t.run(async (ctx) => {
			for (let index = 0; index < 100; index += 1) {
				await ctx.db.insert("catalogPrivateAssetEditorOperations", {
					siteUrl: FOREIGN_SITE,
					operationId: index.toString(16).padStart(40, "0"),
					sourceId: `foreign:${index}`,
					kind: "print_source",
					assetKey: `foreign-${index}`,
					privateObjectKey: `foreign/${index}`,
					createdAt: index,
				});
			}
		});
		expect(await fixture.t.query(observeCompletedAsset, { assetId: fixture.assetId }))
			.toEqual(EXPECTED_POINT);
	});

	test("unattached means exactly zero same-tenant relations without claiming foreign-row absence", async () => {
		const fixture = await seedCompletedAsset("print_source");
		await fixture.t.run(async (ctx) => {
			const productId = await ctx.db.insert("catalogProducts", {
				siteUrl: FOREIGN_SITE,
				productKey: "foreign-corrupt-reference",
				productKind: "print",
				createdAt: 0,
				createdBy: "test",
				updatedAt: 0,
				updatedBy: "test",
			});
			const revisionId = await ctx.db.insert("catalogProductRevisions", {
				siteUrl: FOREIGN_SITE,
				productId,
				productKind: "print",
				schemaVersion: 1,
				currency: "usd",
				fulfillmentMode: "merchant_fulfilled",
				saleAvailability: "available",
				borderOptionsEnabled: false,
				frameOptionsEnabled: false,
				framePriceMultiplierBasisPoints: 0,
				variantCount: 0,
				checksum: "foreign",
				source: "admin",
				createdAt: 0,
				createdBy: "test",
			});
			await ctx.db.insert("catalogProductPrintSources", {
				siteUrl: FOREIGN_SITE,
				productId,
				revisionId,
				assetId: fixture.assetId as Id<"catalogPrintSourceAssets">,
				relationKey: "foreign-corrupt-reference",
				order: 0,
			});
		});
		expect(await fixture.t.query(observeCompletedAsset, { assetId: fixture.assetId }))
			.toEqual(EXPECTED_POINT);
	});

	test.each([
		"foreign target",
		"authority mismatch",
		"coordination mismatch",
		"schema one",
		"multiple targets",
		"wrong generation",
		"missing capability",
		"duplicate capability",
		"capability wrong generation",
		"missing effect",
		"duplicate effect",
		"effect wrong generation",
		"nonterminal effect",
		"failed effect outcome",
		"unsafe attempts",
		"malformed upload hash",
		"operation timestamp inversion",
		"effect timestamp inversion",
		"corrupt descriptor",
		"attached",
	] as const)("sanitizes the %s adversary", async (corruption) => {
		const fixture = await seedCompletedAsset("print_source");
		await fixture.t.run(async (ctx) => {
			if (corruption === "foreign target") {
				await ctx.db.patch(fixture.assetId as Id<"catalogPrintSourceAssets">, {
					siteUrl: FOREIGN_SITE,
				});
				return;
			}
			if (corruption === "authority mismatch") {
				await ctx.db.patch(fixture.authority._id, { assetKey: "mismatch-private-key" });
				return;
			}
			if (corruption === "coordination mismatch") {
				await ctx.db.patch(fixture.coordination._id, { receiptSetId: `private-${Date.now()}` });
				return;
			}
			if (corruption === "schema one") {
				const facts = editorPrintFacts(SITE, fixture.operationId);
				facts.originalFilename = fixture.operation.originalFilename ?? "acceptance-print.jpg";
				const storage = {
					...storageSet([facts], fixture.coordination.receiptSetId),
					siteUrl: SITE,
				} as Extract<CatalogPrivateStorageReceiptSet, { schemaVersion: 1 }>;
				const inspection = {
					...inspectionSet([facts], fixture.coordination.receiptSetId),
					siteUrl: SITE,
				} as Extract<CatalogPrivateInspectionReceiptSet, { schemaVersion: 1 }>;
				await ctx.db.replace("catalogPrivateAssetReceiptCoordinations", fixture.coordination._id, {
					siteUrl: SITE,
					receiptSetId: fixture.coordination.receiptSetId,
					assetSetChecksum: fixture.coordination.assetSetChecksum,
					createdAt: fixture.coordination.createdAt,
					updatedAt: fixture.coordination.updatedAt,
					status: "verified",
					storageReceiptChecksum: fixture.coordination.storageReceiptChecksum,
					inspectionReceiptChecksum: fixture.coordination.inspectionReceiptChecksum,
					storageReceivedAt: fixture.coordination.storageReceivedAt,
					inspectionReceivedAt: fixture.coordination.inspectionReceivedAt,
					verifiedAt: fixture.coordination.verifiedAt,
					storageReceiptSet: storage,
					inspectionReceiptSet: inspection,
					targets: fixture.coordination.targets,
				});
				return;
			}
			if (corruption === "multiple targets") {
				if (!("targetBindings" in fixture.coordination) || !fixture.coordination.targetBindings) {
					throw new Error("V2 target bindings missing");
				}
				await ctx.db.patch(fixture.coordination._id, {
					targets: [...fixture.coordination.targets, fixture.coordination.targets[0]!],
					targetBindings: [
						...fixture.coordination.targetBindings,
						fixture.coordination.targetBindings[0]!,
					],
				});
				return;
			}
			if (corruption === "wrong generation") {
				await ctx.db.patch(fixture.operation._id, { generation: 2 });
				return;
			}
			if (corruption === "malformed upload hash") {
				await ctx.db.patch(fixture.operation._id, { uploadHandleHash: "not-a-hash" });
				return;
			}
			if (corruption === "operation timestamp inversion") {
				await ctx.db.patch(fixture.operation._id, { updatedAt: 0 });
				return;
			}
			const capabilities = await ctx.db.query("catalogPrivateAssetEditorCapabilities")
				.withIndex("by_siteUrl_and_operationId_and_purpose", (q) =>
					q.eq("siteUrl", SITE).eq("operationId", fixture.operationId)
				)
				.take(4);
			if (corruption === "missing capability") {
				await ctx.db.delete(capabilities[0]!._id);
				return;
			}
			if (corruption === "duplicate capability") {
				const { _id, _creationTime, ...duplicate } = capabilities[0]!;
				void _id;
				void _creationTime;
				await ctx.db.insert("catalogPrivateAssetEditorCapabilities", duplicate);
				return;
			}
			if (corruption === "capability wrong generation") {
				await ctx.db.patch(capabilities[0]!._id, { generation: 2 });
				return;
			}
			const effects = await ctx.db.query("catalogPrivateAssetEditorEffects")
				.withIndex("by_siteUrl_and_operationId_and_kind", (q) =>
					q.eq("siteUrl", SITE).eq("operationId", fixture.operationId)
				)
				.take(4);
			const storageEffect = effects.find((effect) => effect.kind === "storage")!;
			if (corruption === "effect timestamp inversion") {
				await ctx.db.patch(storageEffect._id, { updatedAt: 0, acknowledgedAt: 0 });
				return;
			}
			if (corruption === "missing effect") {
				await ctx.db.delete(storageEffect._id);
				return;
			}
			if (corruption === "duplicate effect") {
				const { _id, _creationTime, ...duplicate } = storageEffect;
				void _id;
				void _creationTime;
				await ctx.db.insert("catalogPrivateAssetEditorEffects", duplicate);
				return;
			}
			if (corruption === "effect wrong generation") {
				await ctx.db.patch(storageEffect._id, { generation: 2 });
				return;
			}
			if (corruption === "nonterminal effect") {
				await ctx.db.patch(storageEffect._id, { state: "queued" });
				return;
			}
			if (corruption === "failed effect outcome") {
				await ctx.db.patch(storageEffect._id, { state: "failed", lastOutcome: "rejected" });
				return;
			}
			if (corruption === "unsafe attempts") {
				await ctx.db.patch(storageEffect._id, { attempts: 9 });
				return;
			}
			if (corruption === "corrupt descriptor") {
				await ctx.db.patch(fixture.operation._id, { originalFilename: "private-drift.jpg" });
				return;
			}
			if (corruption === "attached") {
				const productId = await ctx.db.insert("catalogProducts", {
					siteUrl: SITE,
					productKey: "attached",
					productKind: "print",
					createdAt: 0,
					createdBy: "test",
					updatedAt: 0,
					updatedBy: "test",
				});
				const revisionId = await ctx.db.insert("catalogProductRevisions", {
					siteUrl: SITE,
					productId,
					productKind: "print",
					schemaVersion: 1,
					currency: "usd",
					fulfillmentMode: "merchant_fulfilled",
					saleAvailability: "available",
					borderOptionsEnabled: false,
					frameOptionsEnabled: false,
					framePriceMultiplierBasisPoints: 0,
					variantCount: 0,
					checksum: "attached",
					source: "admin",
					createdAt: 0,
					createdBy: "test",
				});
				await ctx.db.insert("catalogProductPrintSources", {
					siteUrl: SITE,
					productId,
					revisionId,
					assetId: fixture.assetId as Id<"catalogPrintSourceAssets">,
					relationKey: "attached",
					order: 0,
				});
			}
		});
		await expect(fixture.t.query(observeCompletedAsset, { assetId: fixture.assetId }))
			.rejects.toThrow(POINT_ERROR);
	});

	test("unknown and malformed browser IDs cannot enumerate private state", async () => {
		const fixture = await seedCompletedAsset("paid_digital_file");
		const unknown = await fixture.t.run(async (ctx) =>
			await ctx.db.insert("catalogDigitalFileAssets", privateDigitalAsset(SITE, 99_999))
		);
		await expect(fixture.t.query(observeCompletedAsset, { assetId: unknown }))
			.rejects.toThrow(POINT_ERROR);
		for (const invalid of ["not-an-id", String(fixture.operation._id)]) {
			await expect(fixture.t.query(observeCompletedAsset, {
				assetId: invalid as Id<"catalogDigitalFileAssets">,
			})).rejects.toThrow();
		}
	});

	test("success and failure calls leave all rows and scheduled functions byte-identical", async () => {
		const fixture = await seedCompletedAsset("print_source");
		const unknown = await fixture.t.run(async (ctx) =>
			await ctx.db.insert("catalogPrintSourceAssets", privatePrintAsset(SITE, 88_888))
		);
		const before = await databaseSnapshot(fixture.t);
		await fixture.t.query(observeAggregate, {});
		await fixture.t.query(observeAggregate, {});
		await fixture.t.query(observeCompletedAsset, { assetId: fixture.assetId });
		await expect(fixture.t.query(observeCompletedAsset, { assetId: unknown }))
			.rejects.toThrow(POINT_ERROR);
		const after = await databaseSnapshot(fixture.t);
		expect(after).toEqual(before);

		await fixture.t.run(async (ctx) => {
			for (let index = 0; index < 4; index += 1) {
				await ctx.db.insert("catalogPrivateAssetEditorOperations", {
					siteUrl: SITE,
					operationId: (index + 100).toString(16).padStart(40, "0"),
					sourceId: `overflow:${index}`,
					kind: "print_source",
					assetKey: `overflow-${index}`,
					privateObjectKey: `overflow/${index}`,
					createdAt: index,
				});
			}
		});
		const failureBefore = await databaseSnapshot(fixture.t);
		await expect(fixture.t.query(observeAggregate, {})).rejects.toThrow(AGGREGATE_ERROR);
		expect(await databaseSnapshot(fixture.t)).toEqual(failureBefore);
	});

	test("privacy corpus never reaches point output, fixed errors, or logs", async () => {
		const consoleSpies = [
			vi.spyOn(console, "log").mockImplementation(() => undefined),
			vi.spyOn(console, "warn").mockImplementation(() => undefined),
			vi.spyOn(console, "error").mockImplementation(() => undefined),
		];
		try {
			const fixture = await seedCompletedAsset("print_source", {
				filename: "person+secret@example.com.jpg",
			});
			const success = await fixture.t.query(observeCompletedAsset, { assetId: fixture.assetId });
			await fixture.t.run(async (ctx) => {
				await ctx.db.patch(fixture.operation._id, { canonicalDeclaration: "private receipt body" });
			});
			let failure = "";
			try {
				await fixture.t.query(observeCompletedAsset, { assetId: fixture.assetId });
			} catch (error) {
				failure = String(error);
			}
			const observed = `${JSON.stringify(success)} ${failure}`.toLowerCase();
			for (const forbidden of [
				"person+secret@example.com",
				fixture.operationId,
				String(fixture.assetId),
				"private receipt body",
				"cms-editor-upload-v1",
				"privateobjectkey",
				"sha256",
				"digest",
				"fingerprint",
				"lease",
				"https://",
			]) expect(observed).not.toContain(forbidden.toLowerCase());
			expect(failure).toContain(POINT_ERROR);
			expect(consoleSpies.every((spy) => spy.mock.calls.length === 0)).toBe(true);
		} finally {
			for (const spy of consoleSpies) spy.mockRestore();
		}
	});
});
