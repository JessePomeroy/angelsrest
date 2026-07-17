/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

describe("retired CMS image metadata migrations", () => {
	test("strips legacy About and Modeling fields and is idempotent", async () => {
		const t = convexTest(schema, modules);
		const ids = await t.run(async (ctx) => {
			const aboutDocumentId = await ctx.db.insert("contentDocuments", {
				siteUrl: "site.example",
				kind: "aboutPage",
				createdAt: 1,
				createdBy: "test",
				updatedAt: 1,
				updatedBy: "test",
			});
			const modelingDocumentId = await ctx.db.insert("contentDocuments", {
				siteUrl: "site.example",
				kind: "modelingPage",
				createdAt: 1,
				createdBy: "test",
				updatedAt: 1,
				updatedBy: "test",
			});
			const assetId = await ctx.db.insert("mediaAssets", {
				siteUrl: "site.example",
				assetId: "123e4567-e89b-42d3-a456-426614174000",
				intent: "web",
				status: "ready",
				originalFilename: "image.jpg",
				source: { contentType: "image/jpeg", sizeBytes: 1, width: 1, height: 1 },
				master: { key: "master", contentType: "image/webp", sizeBytes: 1, width: 1, height: 1 },
				derivatives: {
					thumb: { key: "thumb", contentType: "image/webp", width: 1, height: 1 },
					card: { key: "card", contentType: "image/webp", width: 1, height: 1 },
					display1280: { key: "1280", contentType: "image/webp", width: 1, height: 1 },
					display2048: { key: "2048", contentType: "image/webp", width: 1, height: 1 },
					display2560: { key: "2560", contentType: "image/webp", width: 1, height: 1 },
				},
				createdAt: 1,
				createdBy: "test",
				updatedAt: 1,
				updatedBy: "test",
			});
			const aboutRevisionId = await ctx.db.insert("contentRevisions", {
				siteUrl: "site.example",
				documentId: aboutDocumentId,
				kind: "aboutPage",
				schemaVersion: 1,
				payload: {
					portraits: [{ key: "portrait", assetId, altText: "Portrait", decorative: false }],
					seoImageAssetId: assetId,
				},
				source: "admin",
				checksum: "legacy-about",
				createdAt: 1,
				createdBy: "test",
			});
			const modelingRevisionId = await ctx.db.insert("contentRevisions", {
				siteUrl: "site.example",
				documentId: modelingDocumentId,
				kind: "modelingPage",
				schemaVersion: 1,
				payload: {
					galleries: [{
						key: "editorial",
						isVisible: true,
						images: [{ key: "image", assetId, altText: "Portrait", decorative: false }],
					}],
					seoImageAssetId: assetId,
				},
				source: "admin",
				checksum: "legacy-modeling",
				createdAt: 1,
				createdBy: "test",
			});
			return { aboutRevisionId, modelingRevisionId, assetId };
		});

		const result = await t.mutation(
			internal.cmsMigrations.stripRetiredContentImageMetadata,
			{ cursor: null },
		);
		expect(result).toMatchObject({ isDone: true, changed: 2 });
		const revisions = await t.run(async (ctx) => ({
			about: await ctx.db.get(ids.aboutRevisionId),
			modeling: await ctx.db.get(ids.modelingRevisionId),
		}));
		expect(JSON.stringify(revisions)).not.toContain("decorative");
		expect(JSON.stringify(revisions)).not.toContain("seoImageAssetId");
		expect(revisions.about?.checksum).not.toBe("legacy-about");
		expect(revisions.modeling?.checksum).not.toBe("legacy-modeling");
		expect(await t.mutation(
			internal.cmsMigrations.stripRetiredContentImageMetadata,
			{ cursor: null },
		)).toMatchObject({ isDone: true, changed: 0 });

		await t.run(async (ctx) => {
			await ctx.db.patch(ids.aboutRevisionId, {
				payload: {
					portraits: [{
						key: "portrait",
						assetId: ids.assetId,
						decorative: true,
					}],
				},
			});
		});
		expect(await t.mutation(
			internal.cmsMigrations.stripRetiredContentImageMetadata,
			{ cursor: null },
		)).toMatchObject({ isDone: true, changed: 0, blocked: 1 });
		expect(await t.run(async (ctx) =>
			ctx.db.get(ids.aboutRevisionId)
		)).toHaveProperty("payload.portraits.0.decorative", true);

		expect(await t.mutation(
			internal.cmsMigrations.backfillRetiredContentImageAltText,
			{
				cursor: null,
				assetId: ids.assetId,
				altText: "Bouquet of blush roses and eucalyptus leaves",
			},
		)).toMatchObject({ isDone: true, changed: 1 });
		const backfilled = await t.run(async (ctx) => ctx.db.get(ids.aboutRevisionId));
		expect(backfilled).toHaveProperty(
			"payload.portraits.0.altText",
			"Bouquet of blush roses and eucalyptus leaves",
		);
		expect(backfilled).not.toHaveProperty("payload.portraits.0.decorative");
		expect(await t.mutation(
			internal.cmsMigrations.backfillRetiredContentImageAltText,
			{
				cursor: null,
				assetId: ids.assetId,
				altText: "Bouquet of blush roses and eucalyptus leaves",
			},
		)).toMatchObject({ isDone: true, changed: 0 });
	});

	test("strips legacy Portfolio flags and recalculates the revision checksum", async () => {
		const t = convexTest(schema, modules);
		const ids = await t.run(async (ctx) => {
			const assetId = await ctx.db.insert("mediaAssets", {
				siteUrl: "site.example",
				assetId: "123e4567-e89b-42d3-a456-426614174000",
				intent: "web",
				status: "ready",
				originalFilename: "image.jpg",
				source: { contentType: "image/jpeg", sizeBytes: 1, width: 1, height: 1 },
				master: { key: "master", contentType: "image/webp", sizeBytes: 1, width: 1, height: 1 },
				derivatives: {
					thumb: { key: "thumb", contentType: "image/webp", width: 1, height: 1 },
					card: { key: "card", contentType: "image/webp", width: 1, height: 1 },
					display1280: { key: "1280", contentType: "image/webp", width: 1, height: 1 },
					display2048: { key: "2048", contentType: "image/webp", width: 1, height: 1 },
					display2560: { key: "2560", contentType: "image/webp", width: 1, height: 1 },
				},
				createdAt: 1,
				createdBy: "test",
				updatedAt: 1,
				updatedBy: "test",
			});
			const galleryId = await ctx.db.insert("portfolioGalleries", {
				siteUrl: "site.example",
				slug: "work",
				portfolioOrder: 0,
				isPublished: false,
				createdAt: 1,
				createdBy: "test",
				updatedAt: 1,
				updatedBy: "test",
			});
			const revisionId = await ctx.db.insert("portfolioGalleryRevisions", {
				siteUrl: "site.example",
				galleryId,
				schemaVersion: 1,
				title: "Work",
				slug: "work",
				placementCount: 1,
				checksum: "legacy-portfolio",
				source: "admin",
				createdAt: 1,
				createdBy: "test",
			});
			const placementId = await ctx.db.insert("portfolioPlacements", {
				siteUrl: "site.example",
				galleryId,
				revisionId,
				assetId,
				placementKey: "image",
				order: 0,
				altText: "Portrait",
				decorative: false,
			});
			return { revisionId, placementId };
		});

		const result = await t.mutation(
			internal.cmsMigrations.stripRetiredPortfolioImageMetadata,
			{ cursor: null },
		);
		expect(result).toMatchObject({ isDone: true, changed: 1 });
		const migrated = await t.run(async (ctx) => ({
			revision: await ctx.db.get(ids.revisionId),
			placement: await ctx.db.get(ids.placementId),
		}));
		expect(migrated.placement).not.toHaveProperty("decorative");
		expect(migrated.revision?.checksum).not.toBe("legacy-portfolio");
		expect(await t.mutation(
			internal.cmsMigrations.stripRetiredPortfolioImageMetadata,
			{ cursor: null },
		)).toMatchObject({ isDone: true, changed: 0 });

		await t.run(async (ctx) => {
			const placement = await ctx.db.get(ids.placementId);
			if (!placement) throw new Error("Portfolio placement missing");
			await ctx.db.patch(ids.placementId, {
				altText: undefined,
				decorative: true,
			});
		});
		expect(await t.mutation(
			internal.cmsMigrations.stripRetiredPortfolioImageMetadata,
			{ cursor: null },
		)).toMatchObject({ isDone: true, changed: 0, blocked: 1 });
		expect(await t.run(async (ctx) =>
			ctx.db.get(ids.placementId)
		)).toHaveProperty("decorative", true);
	});
});
