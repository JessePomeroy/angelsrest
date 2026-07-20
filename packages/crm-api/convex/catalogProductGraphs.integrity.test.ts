/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { CatalogProductGraphV2Draft } from "./helpers/catalogProductGraphValidators";
import {
	SITE_A,
	commonGraph,
	createGraph,
	graphDraft,
	graphRows,
	printSourceAsset,
	readyAsset,
	setup,
	storedCounts,
	workerAssetId,
} from "../test/catalogProductGraphFixtures";

const modules = import.meta.glob("./**/*.ts");

describe("catalog product graph V2 integrity and asset boundaries", () => {
	test("keeps web, print-source, and paid-file assets separate and tenant-owned", async () => {
		const fixture = await setup(modules);
		const before = await storedCounts(fixture);
		const invalid: CatalogProductGraphV2Draft[] = [];
		for (const [suffix, assetId] of [
			["missing-web", "missing.web"],
			["wrong-web-type", fixture.printA],
			["foreign-web", fixture.webB],
		] as const) {
			const draft = graphDraft("print", fixture, suffix);
			draft.webMedia[0]!.assetId = assetId as unknown as Id<"mediaAssets">;
			invalid.push(draft);
		}
		for (const [suffix, assetId] of [
			["missing-print", "missing.print"],
			["wrong-print-type", fixture.paidA],
			["foreign-print", fixture.printB],
		] as const) {
			const draft = graphDraft("print", fixture, suffix);
			draft.printSources[0]!.assetId = assetId as unknown as Id<"catalogPrintSourceAssets">;
			invalid.push(draft);
		}
		for (const [suffix, assetId] of [
			["missing-paid", "missing.paid"],
			["wrong-paid-type", fixture.printA],
			["foreign-paid", fixture.paidB],
		] as const) {
			const draft = graphDraft("digital_download", fixture, suffix);
			draft.paidFile!.assetId = assetId as unknown as Id<"catalogDigitalFileAssets">;
			invalid.push(draft);
		}
		await fixture.t.run(async (ctx) => {
			await ctx.db.patch(fixture.webA2, { status: "deleting" });
		});
		const deleting = graphDraft("print", fixture, "deleting-web");
		deleting.webMedia[0]!.assetId = fixture.webA2;
		invalid.push(deleting);

		for (const [index, draft] of invalid.entries()) {
			await expect(createGraph(
				fixture.adminA,
				SITE_A.siteUrl,
				`invalid-boundary-${index}`,
				draft,
			)).rejects.toThrow(/asset|same site|owned|ready|verified|invalid/i);
		}
		expect(await storedCounts(fixture)).toEqual(before);
	});

	test("fails closed on corrupt ownership, counts, order, keys, and checksums", async () => {
		const fixture = await setup(modules);
		const createPrint = async (key: string) => await createGraph(
			fixture.adminA,
			SITE_A.siteUrl,
			key,
			graphDraft("print", fixture, key),
		);
		const ownershipA = await createPrint("corrupt-owner-a");
		const ownershipB = await createPrint("corrupt-owner-b");
		await fixture.t.run(async (ctx) => {
			await ctx.db.patch(ownershipA.productId, { draftRevisionId: ownershipB.revisionId });
		});
		await expect(fixture.adminA.query(api.catalogProductGraphs.getEditorState, {
			productId: ownershipA.productId,
		})).rejects.toThrow(/ownership mismatch/i);

		const count = await createPrint("corrupt-count");
		await fixture.t.run(async (ctx) =>
			await ctx.db.patch(count.revisionId, { webMediaCount: 99 })
		);
		await expect(fixture.adminA.query(api.catalogProductGraphs.getEditorState, {
			productId: count.productId,
		})).rejects.toThrow(/count mismatch|count is outside/i);

		const order = await createPrint("corrupt-order");
		await fixture.t.run(async (ctx) => {
			const row = await ctx.db.query("catalogProductMediaPlacements")
				.withIndex("by_revisionId_and_placementKey", (q) =>
					q.eq("revisionId", order.revisionId).eq("placementKey", "primary")
				).unique();
			if (!row) throw new Error("Fixture placement not found");
			await ctx.db.patch(row._id, { order: 3 });
		});
		await expect(fixture.adminA.query(api.catalogProductGraphs.getEditorState, {
			productId: order.productId,
		})).rejects.toThrow(/order.*contiguous/i);

		const key = await createPrint("corrupt-key");
		await fixture.t.run(async (ctx) => {
			const row = await ctx.db.query("catalogProductMediaPlacements")
				.withIndex("by_revisionId_and_placementKey", (q) =>
					q.eq("revisionId", key.revisionId).eq("placementKey", "detail")
				).unique();
			if (!row) throw new Error("Fixture placement not found");
			await ctx.db.patch(row._id, { placementKey: "primary" });
		});
		await expect(fixture.adminA.query(api.catalogProductGraphs.getEditorState, {
			productId: key.productId,
		})).rejects.toThrow(/placement keys.*unique|unique.*placement/i);

		const checksum = await createPrint("corrupt-checksum");
		await fixture.t.run(async (ctx) =>
			await ctx.db.patch(checksum.revisionId, { checksum: "tampered" })
		);
		await expect(fixture.adminA.query(api.catalogProductGraphs.getEditorState, {
			productId: checksum.productId,
		})).rejects.toThrow(/checksum mismatch/i);
	});

	test("fails closed when a stored private relation crosses the tenant boundary", async () => {
		const fixture = await setup(modules);
		const created = await createGraph(
			fixture.adminA,
			SITE_A.siteUrl,
			"corrupt-private-relation",
			graphDraft("print", fixture, "corrupt-private-relation"),
		);
		await fixture.t.run(async (ctx) => {
			const relation = await ctx.db.query("catalogProductPrintSources")
				.withIndex("by_revisionId_and_order", (q) => q.eq("revisionId", created.revisionId))
				.unique();
			if (!relation) throw new Error("Fixture print-source relation not found");
			await ctx.db.patch(relation._id, { assetId: fixture.printB });
		});
		await expect(fixture.adminA.query(api.catalogProductGraphs.getEditorState, {
			productId: created.productId,
		})).rejects.toThrow(/same site|owned|verified/i);
	});

	test("proves tenant-wide key and slug ownership during kind-specific lists", async () => {
		const keyFixture = await setup(modules);
		const keyOwner = await createGraph(
			keyFixture.adminA,
			SITE_A.siteUrl,
			"list-owned-key",
			graphDraft("print", keyFixture, "list-owned-key"),
		);
		await keyFixture.t.run(async (ctx) => {
			await ctx.db.insert("catalogProducts", {
				siteUrl: SITE_A.siteUrl,
				productKey: "list-owned-key",
				productKind: "tapestry",
				graphVersion: 2,
				slug: "different-list-slug",
				createdAt: 1,
				createdBy: "fixture",
				updatedAt: 1,
				updatedBy: "fixture",
			});
		});
		await expect(keyFixture.adminA.query(api.catalogProductGraphs.listForEditor, {
			siteUrl: SITE_A.siteUrl,
			productKind: "print",
		})).rejects.toThrow(/unique|duplicate|identity ownership|more than one/i);
		expect(keyOwner.productId).toEqual(expect.any(String));

		const slugFixture = await setup(modules);
		await createGraph(
			slugFixture.adminA,
			SITE_A.siteUrl,
			"list-slug-owner",
			graphDraft("postcard", slugFixture, "list-owned-slug"),
		);
		await slugFixture.t.run(async (ctx) => {
			await ctx.db.insert("catalogProducts", {
				siteUrl: SITE_A.siteUrl,
				productKey: "v1-corrupt-slug-owner",
				productKind: "print",
				slug: "list-owned-slug",
				createdAt: 1,
				createdBy: "fixture",
				updatedAt: 1,
				updatedBy: "fixture",
			});
		});
		await expect(slugFixture.adminA.query(api.catalogProductGraphs.listForEditor, {
			siteUrl: SITE_A.siteUrl,
			productKind: "postcard",
		})).rejects.toThrow(/unique|duplicate|identity ownership|more than one/i);
	});

	test("blocks deletion of web media referenced by immutable catalog history", async () => {
		const fixture = await setup(modules);
		const created = await createGraph(
			fixture.adminA,
			SITE_A.siteUrl,
			"deletion-guard",
			graphDraft("postcard", fixture, "deletion-guard"),
		);
		await fixture.adminA.mutation(api.catalogProductGraphs.discardDraft, {
			productId: created.productId,
			draftRevisionId: created.revisionId,
		});
		await expect(fixture.adminA.mutation(api.mediaAssets.requestDeletion, {
			siteUrl: SITE_A.siteUrl,
			id: fixture.webA,
		})).rejects.toThrow(/in use by catalog content/i);
		expect((await fixture.adminA.query(api.mediaAssets.get, { id: fixture.webA })).status)
			.toBe("ready");
	});

	test("stores and reloads the maximum twenty-member aggregate graph atomically", async () => {
		const fixture = await setup(modules);
		const seeded = await fixture.t.run(async (ctx) => {
			const web: Id<"mediaAssets">[] = [];
			const print: Id<"catalogPrintSourceAssets">[] = [];
			for (let index = 0; index < 22; index += 1) {
				const asset = readyAsset(SITE_A.siteUrl, workerAssetId("m", index + 1));
				web.push(await ctx.db.insert("mediaAssets", {
					...asset,
					siteUrl: SITE_A.siteUrl,
					intent: "web",
					status: "ready",
					createdAt: 1_000 + index,
					createdBy: "fixture",
					updatedAt: 1_000 + index,
					updatedBy: "fixture",
				}));
			}
			for (let index = 0; index < 20; index += 1) {
				print.push(await ctx.db.insert(
					"catalogPrintSourceAssets",
					printSourceAsset(SITE_A.siteUrl, `maximum-${index}`, index + 4),
				));
			}
			return { web, print };
		});
		const draft: CatalogProductGraphV2Draft = {
			...commonGraph("maximum-set"),
			productKind: "print_set",
			fulfillmentMode: "production_partner",
			printOptions: {
				borderOptionsEnabled: true,
				frameOptionsEnabled: true,
				framePriceMultiplierBasisPoints: 12_500,
			},
			variants: Array.from({ length: 100 }, (_, index) => ({
				key: `variant-${index}`,
				order: index,
				materialOptionKey: `material-${index}`,
				sizeOptionKey: `size-${index}`,
				retailPriceCents: index + 1,
				status: "enabled" as const,
			})),
			webMedia: [
				{ key: "cover", order: 0, role: "cover", assetId: seeded.web[0]!, altText: "Set cover" },
				...Array.from({ length: 20 }, (_, index) => ({
					key: `member-media-${index}`,
					order: index,
					role: "set_member" as const,
					assetId: seeded.web[index + 1]!,
					altText: `Set member ${index + 1}`,
				})),
				{ key: "social", order: 0, role: "social_share", assetId: seeded.web[21]!, altText: "Share card" },
			],
			printSources: seeded.print.map((assetId, index) => ({
				key: `member-source-${index}`,
				order: index,
				assetId,
			})),
			setMembers: Array.from({ length: 20 }, (_, index) => ({
				key: `member-${index}`,
				order: index,
				mediaPlacementKey: `member-media-${index}`,
				printSourceKey: `member-source-${index}`,
			})),
		};
		const created = await createGraph(
			fixture.adminA,
			SITE_A.siteUrl,
			"maximum-set",
			draft,
		);
		const rows = await graphRows(fixture, created.revisionId);
		expect(rows.variants).toHaveLength(100);
		expect(rows.media).toHaveLength(22);
		expect(rows.printSources).toHaveLength(20);
		expect(rows.setMembers).toHaveLength(20);
		expect(rows.shopPlacements).toHaveLength(1);
		expect(
			rows.variants.length
			+ rows.media.length
			+ rows.printSources.length
			+ rows.setMembers.length
			+ rows.digitalFiles.length
			+ rows.shopPlacements.length,
		).toBe(163);
		const editor = await fixture.adminA.query(api.catalogProductGraphs.getEditorState, {
			productId: created.productId,
		});
		expect(editor).toMatchObject({
			draft: { revisionId: created.revisionId },
			published: null,
		});
		if (editor.draft?.draft.productKind !== "print_set") {
			throw new Error("Expected a print-set graph");
		}
		expect(editor.draft.draft.setMembers).toContainEqual({
			key: "member-19",
			order: 19,
			mediaPlacementKey: "member-media-19",
			printSourceKey: "member-source-19",
		});
	});
});
