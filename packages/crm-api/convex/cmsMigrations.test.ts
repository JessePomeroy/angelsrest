/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

describe("CMS data migrations", () => {
	test("strips historical About focal points and is idempotent", async () => {
		const t = convexTest(schema, modules);
		const revisionId = await t.run(async (ctx) => {
			const assetId = await ctx.db.insert("mediaAssets", {
				siteUrl: "zippymiggy.com",
				assetId: "legacy-asset",
				intent: "web",
				status: "ready",
				originalFilename: "portrait.jpg",
				source: {
					contentType: "image/jpeg",
					sizeBytes: 1_000,
					width: 1200,
					height: 1800,
				},
				master: {
					key: "master.webp",
					contentType: "image/webp",
					sizeBytes: 900,
					width: 1200,
					height: 1800,
				},
				derivatives: {
					thumb: { key: "thumb.webp", contentType: "image/webp", width: 320, height: 480 },
					card: { key: "card.webp", contentType: "image/webp", width: 768, height: 1152 },
					display1280: { key: "1280.webp", contentType: "image/webp", width: 1200, height: 1800 },
					display2048: { key: "2048.webp", contentType: "image/webp", width: 1200, height: 1800 },
					display2560: { key: "2560.webp", contentType: "image/webp", width: 1200, height: 1800 },
				},
				createdAt: 1,
				createdBy: "legacy",
				updatedAt: 1,
				updatedBy: "legacy",
			});
			const documentId = await ctx.db.insert("contentDocuments", {
				siteUrl: "zippymiggy.com",
				kind: "aboutPage",
				createdAt: 1,
				createdBy: "legacy",
				updatedAt: 1,
				updatedBy: "legacy",
			});
			return await ctx.db.insert("contentRevisions", {
				siteUrl: "zippymiggy.com",
				documentId,
				kind: "aboutPage",
				schemaVersion: 1,
				payload: {
					heading: "about",
					portraits: [
						{
							key: "portrait-1",
							assetId,
							decorative: true,
							focalPoint: { x: 0.5, y: 0.5 },
						},
					],
				},
				source: "admin",
				checksum: "legacy-checksum",
				createdAt: 1,
				createdBy: "legacy",
			});
		});

		await expect(
			t.mutation(internal.cmsMigrations.stripAboutPortraitFocalPoints, {}),
		).resolves.toMatchObject({ changed: 1, changedRevisionIds: [revisionId] });
		const migrated = await t.run(async (ctx) => await ctx.db.get(revisionId));
		expect(JSON.stringify(migrated?.payload)).not.toContain("focalPoint");
		expect(migrated?.checksum).toMatch(/^[a-f0-9]{64}$/);

		await expect(
			t.mutation(internal.cmsMigrations.stripAboutPortraitFocalPoints, {}),
		).resolves.toMatchObject({ changed: 0, changedRevisionIds: [] });
	});
});
