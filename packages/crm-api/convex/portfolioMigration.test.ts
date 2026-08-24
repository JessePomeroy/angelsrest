/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
	canonicalPortfolioJson,
	digestPortfolioPreservedTargetActor,
	digestPortfolioMigrationPlan,
	type PortfolioMigrationPlan,
	validatePortfolioMigrationPlan,
} from "./helpers/portfolioMigrationPlan";
import {
	attestPortfolioMediaSources,
	importSanityPortfolioDrafts,
	type PortfolioPinnedRestoreEntry,
	publishSanityPortfolioDrafts,
	restorePinnedPortfolioRevisions,
} from "./helpers/portfolioMigrationStore";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const SITE = "site-a.example";
const ADMIN = "admin-a@example.com";
const WORKER_ASSET_ID = "123e4567-e89b-42d3-a456-426614174000";
const SOURCE_ASSET_REF = "image-abcdef123456-1600x1067-jpg";
const TRANSFER_SHA256 = "a".repeat(64);

const restorePinned = makeFunctionReference<
	"mutation",
	{
		siteUrl: string;
		operationId: string;
		entries: PortfolioPinnedRestoreEntry[];
	}
>("portfolioMigration:restorePinnedPublishedRevisions");

function readyWebpAsset() {
	const prefix = `sites/${SITE}/web/${WORKER_ASSET_ID}/`;
	const derivative = (name: string, width: number, height: number) => ({
		key: `${prefix}${name}.webp`,
		contentType: "image/webp" as const,
		width,
		height,
	});
	return {
		assetId: WORKER_ASSET_ID,
		originalFilename: "portfolio-transfer.webp",
		source: {
			contentType: "image/webp" as const,
			sizeBytes: 900_000,
			width: 1600,
			height: 1067,
		},
		master: {
			key: `${prefix}master.webp`,
			contentType: "image/webp" as const,
			sizeBytes: 850_000,
			width: 1600,
			height: 1067,
		},
		derivatives: {
			thumb: derivative("thumb", 320, 213),
			card: derivative("card", 768, 512),
			display1280: derivative("display-1280", 1280, 854),
			display2048: derivative("display-2048", 1600, 1067),
			display2560: derivative("display-2560", 1600, 1067),
		},
	};
}

function migrationPlan(
	assetId: Id<"mediaAssets">,
	preservedTargetGallery: PortfolioMigrationPlan["preservedTargetGallery"],
): PortfolioMigrationPlan {
	return {
		version: 1,
		migrationId: "portfolio-test-v1",
		siteUrl: SITE,
		source: {
			projectId: "source-project",
			dataset: "production",
			perspective: "published",
		},
		decisionSet: {
			id: "portfolio-decisions-v1",
			ordering: "order-rank-then-source-id-owner-approved",
			visibility: "preserve-unfiltered-all-published-owner-approved",
			canonicalUrl: "preserve-title-derived-canonical-owner-approved",
			derivatives: "accept-fixed-convex-webp-owner-approved",
			cropHotspot: "accept-focal-only-owner-approved",
			captions: "confirmed-absent-owner-approved",
			missingAlt: "legacy-runtime-fallback-only-owner-approved",
			seo: "confirmed-absent-owner-approved",
			unsupportedFields:
				"omit-category-date-featured-visibility-with-presence-recorded-owner-approved",
			mediaTransfer: "sanity-width-1600-webp-q90-owner-approved",
			gifCanary: "17-frames-100ms-infinite-card-and-display2048",
		},
		preservedTargetGallery,
		mediaMappings: [{
			sourceAssetRef: SOURCE_ASSET_REF,
			sourceAssetRevision: "asset-revision-1",
			sourceOriginalContentType: "image/jpeg",
			transferRecipe: "sanity-width-1600-webp-q90",
			transferSha256: TRANSFER_SHA256,
			transferSizeBytes: 900_000,
			transferWidth: 1600,
			transferHeight: 1067,
			targetMediaAssetId: assetId,
			targetWorkerAssetId: WORKER_ASSET_ID,
			targetReceiptSha256: "b".repeat(64),
		}],
		entries: [{
			sourceId: "gallery-source-1",
			sourceRevision: "gallery-revision-1",
			sourceOrderRank: "a0",
			sourceUnsupportedCanonical: canonicalPortfolioJson({
				category: { present: false },
				date: { present: false },
				featured: { present: false },
				isVisible: { present: false },
			}),
			targetIsVisible: true,
			portfolioOrder: 0,
			draft: {
				title: "Selected work",
				description: "A deliberate sequence.",
				slug: "selected-work",
				placements: [{
					key: "hero",
					assetId,
					sourceAltState: "absent",
					focalPoint: { x: 0.5, y: 0.5 },
					sourceAssetRef: SOURCE_ASSET_REF,
					sourceCropCanonical: "null",
					sourceHotspotCanonical: "null",
				}],
			},
		}],
	};
}

describe("Portfolio fixed-manifest migration", () => {
	test("requires the accepted public-derivative animation evidence for a GIF", async () => {
		expect(await digestPortfolioPreservedTargetActor(
			SITE,
			"gallery-created-by",
			"actor",
		)).toBe("07076c627b886b08065cbc40511d196412db9ed51549cc91db64dc9866ccd081");
		const plan = migrationPlan("media-asset-id" as Id<"mediaAssets">, {
			galleryId: "gallery-id" as Id<"portfolioGalleries">,
			draftRevisionId: "revision-id" as Id<"portfolioGalleryRevisions">,
			publishedRevisionId: null,
			slug: "test",
			portfolioOrder: 0,
			isPublished: false,
			isVisible: null,
			sourceDocumentId: null,
			createdAt: 1,
			createdByDigest: "d".repeat(64),
			updatedAt: 1,
			updatedByDigest: "e".repeat(64),
			publishedAt: null,
			publishedBy: null,
			revision: {
				revisionId: "revision-id" as Id<"portfolioGalleryRevisions">,
				checksum: "c".repeat(64),
				createdAt: 1,
				createdByDigest: "f".repeat(64),
			},
		});
		const mapping = plan.mediaMappings[0]!;
		mapping.sourceOriginalContentType = "image/gif";
		expect(() => validatePortfolioMigrationPlan(plan)).toThrow(/animation inspection/);
		mapping.targetAnimationInspection = {
			card: { frameCount: 17, frameDurationMs: 100, loop: "infinite" },
			display2048: { frameCount: 17, frameDurationMs: 100, loop: "infinite" },
		};
		expect(validatePortfolioMigrationPlan(plan)).toMatchObject({ galleryCount: 1 });
	});

	test("leaves unrelated drafts untouched and replays import, publication, and restore exactly", async () => {
		const t = convexTest(schema, modules);
		await t.mutation(internal.platform.seedClient, {
			name: SITE,
			email: ADMIN,
			siteUrl: SITE,
			tier: "full",
			subscriptionStatus: "active",
			adminEmails: [ADMIN],
			role: "client",
		});
		const admin = t.withIdentity({ subject: ADMIN, email: ADMIN });
		const asset = await admin.mutation(api.mediaAssets.registerReadyWebAsset, {
			siteUrl: SITE,
			asset: readyWebpAsset(),
		});
		const unrelated = await admin.mutation(api.portfolioGalleries.saveDraft, {
			siteUrl: SITE,
			draft: {
				title: "Test",
				slug: "test",
				placements: [{ key: "test", assetId: asset.id, altText: "Test image" }],
			},
		});
		const preservedTargetGallery = await t.run(async (ctx) => {
			const [gallery, revision] = await Promise.all([
				ctx.db.get(unrelated.galleryId),
				ctx.db.get(unrelated.revisionId),
			]);
			if (!gallery || !revision) throw new Error("Preserved target fixture missing");
			const [createdByDigest, updatedByDigest, revisionCreatedByDigest] = await Promise.all([
				digestPortfolioPreservedTargetActor(
					SITE,
					"gallery-created-by",
					gallery.createdBy,
				),
				digestPortfolioPreservedTargetActor(
					SITE,
					"gallery-updated-by",
					gallery.updatedBy,
				),
				digestPortfolioPreservedTargetActor(
					SITE,
					"revision-created-by",
					revision.createdBy,
				),
			]);
			return {
				galleryId: gallery._id,
				draftRevisionId: unrelated.revisionId,
				publishedRevisionId: gallery.publishedRevisionId ?? null,
				slug: gallery.slug,
				portfolioOrder: gallery.portfolioOrder,
				isPublished: gallery.isPublished,
				isVisible: gallery.isVisible === undefined ? null : gallery.isVisible,
				sourceDocumentId:
					gallery.sourceDocumentId === undefined ? null : gallery.sourceDocumentId,
				createdAt: gallery.createdAt,
				createdByDigest,
				updatedAt: gallery.updatedAt,
				updatedByDigest,
				publishedAt: gallery.publishedAt ?? null,
				publishedBy: gallery.publishedBy ?? null,
				revision: {
					revisionId: revision._id,
					checksum: revision.checksum,
					createdAt: revision.createdAt,
					createdByDigest: revisionCreatedByDigest,
				},
			};
		});
		const plan = migrationPlan(asset.id, preservedTargetGallery);
		const digest = await digestPortfolioMigrationPlan(plan);

		expect(await t.run(async (ctx) =>
			await attestPortfolioMediaSources(ctx, { plan, digest })
		)).toMatchObject({ status: "attested", attestedCount: 1 });
		const imported = await t.run(async (ctx) =>
			await importSanityPortfolioDrafts(ctx, { plan, digest })
		);
		expect(imported.status).toBe("imported");
		expect(await t.run(async (ctx) =>
			await importSanityPortfolioDrafts(ctx, { plan, digest })
		)).toMatchObject({ status: "identical-replay", entries: imported.entries });

		await expect(admin.mutation(api.portfolioGalleries.saveDraft, {
			siteUrl: SITE,
			draft: { title: "Blocked", slug: "blocked", placements: [] },
		})).rejects.toThrow(/fixed initial publication/);
		await expect(admin.mutation(api.portfolioGalleries.saveDraft, {
			siteUrl: SITE,
			galleryId: unrelated.galleryId,
			expectedDraftRevisionId: unrelated.revisionId,
			draft: { title: "Changed", slug: "test", placements: [] },
		})).rejects.toThrow(/fixed initial publication/);
		await expect(admin.mutation(api.portfolioGalleries.reorder, {
			siteUrl: SITE,
			galleryIds: [unrelated.galleryId, imported.entries[0]!.galleryId],
		})).rejects.toThrow(/fixed initial publication/);
		await expect(admin.mutation(api.portfolioGalleries.publish, {
			galleryId: imported.entries[0]!.galleryId,
			draftRevisionId: imported.entries[0]!.revisionId,
		})).rejects.toThrow(/fixed initial publication/);

		const published = await t.run(async (ctx) =>
			await publishSanityPortfolioDrafts(ctx, { plan, digest })
		);
		expect(published.status).toBe("published");
		expect(await t.run(async (ctx) =>
			await publishSanityPortfolioDrafts(ctx, { plan, digest })
		)).toMatchObject({ status: "identical-replay", entries: published.entries });
		expect(await t.run(async (ctx) => {
			const gallery = await ctx.db.get(unrelated.galleryId);
			if (!gallery) throw new Error("Preserved target missing after publication");
			return {
				galleryId: gallery._id,
				draftRevisionId: gallery.draftRevisionId,
				publishedRevisionId: gallery.publishedRevisionId ?? null,
				slug: gallery.slug,
				portfolioOrder: gallery.portfolioOrder,
				createdAt: gallery.createdAt,
				updatedAt: gallery.updatedAt,
			};
		})).toEqual({
			galleryId: preservedTargetGallery.galleryId,
			draftRevisionId: preservedTargetGallery.draftRevisionId,
			publishedRevisionId: preservedTargetGallery.publishedRevisionId,
			slug: preservedTargetGallery.slug,
			portfolioOrder: preservedTargetGallery.portfolioOrder,
			createdAt: preservedTargetGallery.createdAt,
			updatedAt: preservedTargetGallery.updatedAt,
		});
		const initialEditor = await admin.query(api.portfolioGalleries.getEditorState, {
			galleryId: imported.entries[0]!.galleryId,
		});
		expect(initialEditor.draft?.revisionId).toBe(imported.entries[0]!.revisionId);
		expect(initialEditor.published?.revisionId).toBe(imported.entries[0]!.revisionId);
		expect(initialEditor.draft).toEqual(initialEditor.published);
		expect(await admin.query(api.portfolioGalleries.listPublishedWithPlacements, {
			siteUrl: SITE,
		})).toMatchObject([{ slug: "selected-work", placements: [{ altText: "" }] }]);
		await admin.mutation(api.portfolioGalleries.reorder, {
			siteUrl: SITE,
			galleryIds: [unrelated.galleryId, imported.entries[0]!.galleryId],
		});
		await t.run(async (ctx) => {
			const gallery = await ctx.db.get(imported.entries[0]!.galleryId);
			if (!gallery) throw new Error("Visibility fixture missing");
			await ctx.db.patch(gallery._id, {
				isVisible: false,
				updatedAt: gallery.updatedAt + 1,
				updatedBy: "later-editor",
			});
		});

		const beforeRestore = await t.run(async (ctx) => {
			const gallery = await ctx.db.get(imported.entries[0]!.galleryId);
			if (
				!gallery?.draftRevisionId
				|| !gallery.publishedRevisionId
				|| gallery.publishedAt === undefined
				|| !gallery.publishedBy
			) {
				throw new Error("Published fixture missing");
			}
			return gallery;
		});
		const restoreArgs = {
			siteUrl: SITE,
			operationId: "portfolio-restore-1",
			entries: [{
				galleryId: beforeRestore._id,
				sourceRevisionId: imported.entries[0]!.revisionId,
				sourcePortfolioOrder: 0,
				sourceIsVisible: true,
				expected: {
					draftRevisionId: beforeRestore.draftRevisionId!,
					publishedRevisionId: beforeRestore.publishedRevisionId!,
					slug: beforeRestore.slug,
					portfolioOrder: beforeRestore.portfolioOrder,
					isVisible: beforeRestore.isVisible!,
					publishedAt: beforeRestore.publishedAt!,
					publishedBy: beforeRestore.publishedBy!,
					updatedAt: beforeRestore.updatedAt,
					updatedBy: beforeRestore.updatedBy,
				},
			}],
		};
		await expect(t.mutation(restorePinned, restoreArgs)).rejects.toThrow(
			/capability is disabled/i,
		);
		expect(await t.run(async (ctx) =>
			await restorePinnedPortfolioRevisions(ctx, restoreArgs)
		)).toMatchObject({ status: "restored", operationId: "portfolio-restore-1" });
		expect(await t.run(async (ctx) =>
			await restorePinnedPortfolioRevisions(ctx, restoreArgs)
		)).toMatchObject({ status: "identical-replay", operationId: "portfolio-restore-1" });
		const restoredClean = await t.run(async (ctx) =>
			await ctx.db.get(imported.entries[0]!.galleryId)
		);
		expect(restoredClean?.draftRevisionId).toBe(restoredClean?.publishedRevisionId);
		expect(restoredClean?.publishedRevisionId).not.toBe(imported.entries[0]!.revisionId);
		expect(restoredClean?.portfolioOrder).toBe(0);
		expect(restoredClean?.isVisible).toBe(true);
		const distinctDraft = await admin.mutation(api.portfolioGalleries.saveDraft, {
			siteUrl: SITE,
			galleryId: imported.entries[0]!.galleryId,
			expectedDraftRevisionId: restoredClean?.draftRevisionId,
			draft: {
				title: "Separate draft",
				description: "A deliberate sequence.",
				slug: "selected-work",
				placements: [{
					key: "hero",
					assetId: asset.id,
					altText: "Factual editor alt",
					focalPoint: { x: 0.5, y: 0.5 },
				}],
			},
		});
		const beforeDistinctRestore = await t.run(async (ctx) => {
			const gallery = await ctx.db.get(imported.entries[0]!.galleryId);
			if (
				!gallery?.publishedRevisionId
				|| gallery.publishedAt === undefined
				|| !gallery.publishedBy
			) throw new Error("Distinct draft fixture missing");
			return gallery;
		});
		const distinctRestoreArgs = {
			siteUrl: SITE,
			operationId: "portfolio-restore-2",
			entries: [{
				galleryId: beforeDistinctRestore._id,
				sourceRevisionId: imported.entries[0]!.revisionId,
				sourcePortfolioOrder: 0,
				sourceIsVisible: true,
				expected: {
					draftRevisionId: distinctDraft.revisionId,
					publishedRevisionId: beforeDistinctRestore.publishedRevisionId!,
					slug: beforeDistinctRestore.slug,
					portfolioOrder: beforeDistinctRestore.portfolioOrder,
					isVisible: beforeDistinctRestore.isVisible!,
					publishedAt: beforeDistinctRestore.publishedAt!,
					publishedBy: beforeDistinctRestore.publishedBy!,
					updatedAt: beforeDistinctRestore.updatedAt,
					updatedBy: beforeDistinctRestore.updatedBy,
				},
			}],
		};
		expect(await t.run(async (ctx) =>
			await restorePinnedPortfolioRevisions(ctx, distinctRestoreArgs)
		)).toMatchObject({ status: "restored", operationId: "portfolio-restore-2" });
		expect(await t.run(async (ctx) =>
			await restorePinnedPortfolioRevisions(ctx, distinctRestoreArgs)
		)).toMatchObject({ status: "identical-replay", operationId: "portfolio-restore-2" });
		await admin.mutation(api.portfolioGalleries.publish, {
			galleryId: unrelated.galleryId,
			draftRevisionId: unrelated.revisionId,
		});
		await expect(t.run(async (ctx) =>
			await restorePinnedPortfolioRevisions(ctx, distinctRestoreArgs)
		)).rejects.toThrow(/pinned restore conflict/);
		const finalState = await t.run(async (ctx) => ({
			gallery: await ctx.db.get(imported.entries[0]!.galleryId),
			unrelated: await ctx.db.get(unrelated.galleryId),
			unrelatedRevision: await ctx.db.get(unrelated.revisionId),
			restoreRevisions: await ctx.db
				.query("portfolioGalleryRevisions")
				.withIndex("by_siteUrl_and_restoreOperationId", (q) =>
					q.eq("siteUrl", SITE).eq("restoreOperationId", "portfolio-restore-1")
				)
				.collect(),
		}));
		expect(finalState.gallery?.draftRevisionId).toBe(distinctDraft.revisionId);
		expect(finalState.gallery?.publishedRevisionId).not.toBe(distinctDraft.revisionId);
		expect(finalState.unrelated?.draftRevisionId).toBe(unrelated.revisionId);
		expect(finalState.unrelatedRevision?.title).toBe("Test");
		expect(finalState.restoreRevisions).toHaveLength(1);
	}, 15_000);
});
