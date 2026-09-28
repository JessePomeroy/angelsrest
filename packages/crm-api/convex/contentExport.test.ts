/// <reference types="vite/client" />
// @vitest-environment edge-runtime
import type { FunctionReturnType } from "convex/server";
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
const modules = import.meta.glob("./**/*.ts");
async function fixture() {
	const t = convexTest(schema, modules);
	for (const name of ["a", "b"])
		await t.mutation(internal.platform.seedClient, {
			name,
			email: `${name}@example.com`,
			siteUrl: `${name}.example`,
			tier: "full",
			subscriptionStatus: "active",
			adminEmails: [`${name}@example.com`],
			role: "client",
		});
	const a = t.withIdentity({ subject: "a", email: "a@example.com", emailVerified: true });
	return { t, a };
}
const args = {
	siteUrl: "a.example",
	family: "content" as const,
	paginationOpts: { cursor: null, numItems: 10 },
};
test("all export families require stored tenant membership", async () => {
	const { t, a } = await fixture();
	for (const family of [
		"content",
		"portfolio",
		"products",
		"web",
		"print",
		"digital",
		"uploads",
	] as const) {
		await expect(t.query(api.contentExport.page, { ...args, family })).rejects.toThrow(
			"Not authenticated",
		);
		await expect(
			a.query(api.contentExport.page, { ...args, family, siteUrl: "b.example" }),
		).rejects.toThrow("Not authorized");
		expect((await a.query(api.contentExport.page, { ...args, family })).page).toEqual([]);
	}
});
test("current published and draft revisions survive pagination without actor or other tenant data", async () => {
	const { t, a } = await fixture();
	await t.run(async (ctx) => {
		for (const siteUrl of ["a.example", "b.example"])
			for (let i = 0; i < 3; i++) {
				const documentId = await ctx.db.insert("contentDocuments", {
					siteUrl,
					kind: "homepageQuote",
					documentKey: `quote-${i}`,
					createdAt: 1,
					updatedAt: 2,
					createdBy: "PRIVATE-ACTOR",
					updatedBy: "PRIVATE-ACTOR",
				});
				const revision = async (text: string) =>
					ctx.db.insert("contentRevisions", {
						siteUrl,
						documentId,
						kind: "homepageQuote",
						schemaVersion: 1,
						payload: { text },
						checksum: text,
						source: "admin",
						createdAt: 1,
						createdBy: "PRIVATE-ACTOR",
					});
				await revision("HISTORICAL");
				await ctx.db.patch(documentId, {
					draftRevisionId: await revision(`${siteUrl}-draft`),
					publishedRevisionId: await revision(`${siteUrl}-published`),
				});
			}
	});
	const output = [];
	let cursor: string | null = null;
	while (true) {
		const result: FunctionReturnType<typeof api.contentExport.page> = await a.query(
			api.contentExport.page,
			{ ...args, paginationOpts: { cursor, numItems: 10 } },
		);
		expect(result.page).toHaveLength(1);
		output.push(...result.page);
		if (result.isDone) break;
		cursor = result.continueCursor;
	}
	expect(output).toHaveLength(3);
	const json = JSON.stringify(output);
	expect(json).toContain("a.example-draft");
	expect(json).toContain("a.example-published");
	expect(json).not.toMatch(/b.example|PRIVATE-ACTOR|HISTORICAL/);
});
test("foreign immutable revisions are rejected instead of leaking their payload", async () => {
	const { t, a } = await fixture();
	await t.run(async (ctx) => {
		const documentId = await ctx.db.insert("contentDocuments", {
			siteUrl: "a.example",
			kind: "homepageQuote",
			createdAt: 1,
			updatedAt: 1,
			createdBy: "a",
			updatedBy: "a",
		});
		const revisionId = await ctx.db.insert("contentRevisions", {
			siteUrl: "b.example",
			documentId,
			kind: "homepageQuote",
			schemaVersion: 1,
			payload: { text: "FOREIGN" },
			checksum: "x",
			source: "admin",
			createdAt: 1,
			createdBy: "b",
		});
		await ctx.db.patch(documentId, { draftRevisionId: revisionId });
	});
	await expect(a.query(api.contentExport.page, args)).rejects.toThrow("missing or mismatched");
});
test("private artwork export omits storage and actor details and records deletion exclusions", async () => {
	const { t, a } = await fixture();
	await t.run(async (ctx) => {
		for (const siteUrl of ["a.example", "b.example"])
			for (const assetKey of ["retained", "deleted"]) {
				const privateObjectKey = `sites/${siteUrl}/catalog/print-sources/${assetKey}/original`;
				const assetId = await ctx.db.insert("catalogPrintSourceAssets", {
					siteUrl,
					assetKey,
					privateObjectKey,
					status: "verified",
					originalFilename: "art.jpg",
					mimeType: "image/jpeg",
					sizeBytes: 100,
					widthPixels: 10,
					heightPixels: 10,
					sha256: "a".repeat(64),
					provenance: { provider: "editor_upload", sourceId: "private-operation" },
					createdAt: 1,
					verifiedAt: 1,
					createdBy: "SECRET-ACTOR",
					verifiedBy: "SECRET-ACTOR",
				});
				if (assetKey === "deleted")
					await ctx.db.insert("catalogPrivateAssetDeletions", {
						siteUrl,
						kind: "print_source",
						assetId,
						assetKey,
						privateObjectKey,
						sha256: "a".repeat(64),
						status: "deleted",
						requestedAt: 2,
						requestedBy: "a",
					});
			}
	});
	const first = await a.query(api.contentExport.page, { ...args, family: "print" });
	const next = await a.query(api.contentExport.page, {
		...args,
		family: "print",
		paginationOpts: { cursor: first.continueCursor, numItems: 1 },
	});
	expect(
		[...first.page, ...next.page].map((row) => ("status" in row ? row.status : undefined)).sort(),
	).toEqual(["deleted", "ready"]);
	expect(JSON.stringify([first.page, next.page])).not.toMatch(
		/privateObjectKey|SECRET-ACTOR|private-operation|b.example/,
	);
});

test("portfolio, product graphs, ready web media, digital files and uploads stay tenant scoped", async () => {
	const { t, a } = await fixture();
	await t.run(async (ctx) => {
		for (const siteUrl of ["a.example", "b.example"]) {
			const actor = {
				createdAt: 1,
				createdBy: "PRIVATE-ACTOR",
				updatedAt: 1,
				updatedBy: "PRIVATE-ACTOR",
			};
			const assetKey = "123e4567-e89b-42d3-a456-426614174000";
			const prefix = `sites/${siteUrl}/web/${assetKey}/`;
			const derivative = (name: string) => ({
				key: `${prefix}${name}.webp`,
				contentType: "image/webp" as const,
				width: 10,
				height: 10,
			});
			const assetId = await ctx.db.insert("mediaAssets", {
				siteUrl,
				assetId: assetKey,
				intent: "web",
				status: "ready",
				originalFilename: "source.jpg",
				source: { contentType: "image/jpeg", sizeBytes: 100, width: 10, height: 10 },
				master: {
					key: `${prefix}master.webp`,
					contentType: "image/webp",
					sizeBytes: 80,
					width: 10,
					height: 10,
				},
				derivatives: {
					thumb: derivative("thumb"),
					card: derivative("card"),
					display1280: derivative("display-1280"),
					display2048: derivative("display-2048"),
					display2560: derivative("display-2560"),
				},
				...actor,
			});
			const galleryId = await ctx.db.insert("portfolioGalleries", {
				siteUrl,
				slug: "work",
				portfolioOrder: 0,
				isPublished: false,
				isVisible: false,
				...actor,
			});
			const galleryRevision = await ctx.db.insert("portfolioGalleryRevisions", {
				siteUrl,
				galleryId,
				schemaVersion: 1,
				title: `${siteUrl}-portfolio`,
				slug: "work",
				placementCount: 1,
				checksum: "gallery",
				source: "admin",
				createdAt: 1,
				createdBy: "PRIVATE-ACTOR",
			});
			await ctx.db.insert("portfolioPlacements", {
				siteUrl,
				galleryId,
				revisionId: galleryRevision,
				assetId,
				placementKey: "photo",
				order: 0,
				altText: "A landscape",
				caption: "Photograph credit",
			});
			await ctx.db.patch(galleryId, { draftRevisionId: galleryRevision });
			const productId = await ctx.db.insert("catalogProducts", {
				siteUrl,
				productKey: "product",
				productKind: "print",
				...actor,
			});
			const revisionId = await ctx.db.insert("catalogProductRevisions", {
				siteUrl,
				productId,
				productKind: "print",
				schemaVersion: 1,
				title: `${siteUrl}-product`,
				currency: "usd",
				fulfillmentMode: "merchant_fulfilled",
				saleAvailability: "unavailable",
				borderOptionsEnabled: false,
				frameOptionsEnabled: false,
				framePriceMultiplierBasisPoints: 10000,
				variantCount: 1,
				checksum: "product",
				source: "admin",
				createdAt: 1,
				createdBy: "PRIVATE-ACTOR",
			});
			await ctx.db.insert("catalogProductVariants", {
				siteUrl,
				productId,
				revisionId,
				variantKey: "small",
				order: 0,
				sizeOptionKey: "8x10",
				retailPriceCents: 4000,
				status: "enabled",
			});
			await ctx.db.patch(productId, { draftRevisionId: revisionId });
			await ctx.db.insert("catalogDigitalFileAssets", {
				siteUrl,
				assetKey: "digital",
				privateObjectKey: `sites/${siteUrl}/catalog/paid-digital-files/digital/original`,
				status: "verified",
				originalFilename: "work.zip",
				mimeType: "application/zip",
				sizeBytes: 100,
				sha256: "b".repeat(64),
				provenance: { provider: "editor_upload", sourceId: "PRIVATE-OPERATION" },
				createdAt: 1,
				verifiedAt: 1,
				createdBy: "PRIVATE-ACTOR",
				verifiedBy: "PRIVATE-ACTOR",
			});
			await ctx.db.insert("catalogPrivateAssetEditorOperations", {
				siteUrl,
				operationId: "private-operation",
				sourceId: "PRIVATE-OPERATION",
				kind: "print_source",
				assetKey: "unfinished",
				privateObjectKey: "PRIVATE-KEY",
				createdAt: 1,
				lifecycle: "expired",
			});
		}
	});
	for (const family of ["portfolio", "products", "web", "digital", "uploads"] as const) {
		const result = await a.query(api.contentExport.page, { ...args, family });
		expect(result.page).toHaveLength(1);
		const json = JSON.stringify(result.page);
		expect(json).not.toMatch(
			/b.example|PRIVATE-ACTOR|PRIVATE-OPERATION|PRIVATE-KEY|privateObjectKey/,
		);
		if (family === "products") expect(json).toMatch(/4000/);
		if (family === "portfolio") expect(json).toMatch(/Photograph credit/);
	}
});
