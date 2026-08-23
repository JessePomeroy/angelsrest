/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { internal } from "./_generated/api";
import {
	checksumSanityBlogImportPlan,
	type SanityBlogImportPlan,
	type SanityBlogImportReleaseContract,
} from "./helpers/sanityBlogImportPlan";
import { importReleasedSanityBlogDrafts } from "./helpers/sanityBlogImportStore";
import {
	checksumSanityBlogReconciliationPlan,
	createSanityBlogReconciliationPlan,
	type SanityBlogReconciliationSource,
	type SanityBlogTargetBaseline,
} from "./helpers/sanityBlogReconciliationPlan";
import { reconcileSanityBlogDrafts } from "./helpers/sanityBlogReconciliationStore";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const SITE = "site-a.example";
const EMAIL = "admin-a@example.com";
const SOURCE = {
	projectId: "test-project",
	dataset: "test-dataset",
	perspective: "published" as const,
};
const AUTHOR_KEY = "sanity.author.author-one";
const CATEGORY_KEY = "sanity.category.category-one";
const POST_KEY = "sanity.post.post-one";

function paragraph(text: string) {
	return {
		type: "paragraph" as const,
		key: "opening",
		children: [
			{
				type: "text" as const,
				key: "opening-text",
				text,
				marks: [],
			},
		],
	};
}

async function setup() {
	const t = convexTest(schema, modules);
	await t.mutation(internal.platform.seedClient, {
		name: SITE,
		email: EMAIL,
		siteUrl: SITE,
		tier: "full",
		subscriptionStatus: "active",
		adminEmails: [EMAIL],
		role: "client",
	});
	return t;
}

async function v1Release() {
	const plan: SanityBlogImportPlan = {
		version: 1,
		migrationId: "TEST-CMS-4.4p",
		siteUrl: SITE,
		source: SOURCE,
		assetMappings: [],
		authors: [
			{
				sourceId: "author-one",
				documentKey: AUTHOR_KEY,
				draft: { kind: "author", name: "Import Author", slug: "import-author" },
			},
		],
		categories: [
			{
				sourceId: "category-one",
				documentKey: CATEGORY_KEY,
				draft: {
					kind: "category",
					title: "Field Notes",
					slug: "field-notes",
					description: "Stories from the field.",
				},
			},
		],
		posts: [
			{
				sourceId: "post-one",
				documentKey: POST_KEY,
				authorDocumentKey: AUTHOR_KEY,
				categoryReferences: [{ key: "category-1", documentKey: CATEGORY_KEY }],
				draft: {
					kind: "post",
					title: "First Light",
					slug: "first-light",
					format: "essay",
					presentation: "standard",
					displayPublishedAt: 1_000,
					summary: "The source body.",
					equipment: [],
					materials: [],
					categories: [],
					body: { version: 1, blocks: [paragraph("The source body.")] },
				},
			},
		],
	};
	const digest = await checksumSanityBlogImportPlan(plan);
	const contract: SanityBlogImportReleaseContract = {
		version: 1,
		migrationId: plan.migrationId,
		siteUrl: SITE,
		source: SOURCE,
		counts: { authors: 1, categories: 1, posts: 1, assets: 0 },
		documentKeys: {
			authors: [AUTHOR_KEY],
			categories: [CATEGORY_KEY],
			posts: [POST_KEY],
		},
		expectedDigest: digest,
	};
	return { plan, digest, contract };
}

function sourceFixture(): SanityBlogReconciliationSource {
	return {
		authors: [
			{
				_id: "author-one",
				_rev: "author-rev-2",
				_type: "author",
				name: "Import Author",
				slug: { current: "import-author" },
			},
		],
		categories: [
			{
				_id: "category-one",
				_rev: "category-rev-2",
				_type: "category",
				title: "Field Notes",
				description: "Stories from the field.",
			},
		],
		posts: [
			{
				_id: "post-one",
				_rev: "post-rev-2",
				_type: "post",
				title: "First Light",
				postType: "standard",
				slug: { current: "first-light" },
				author: { _type: "reference", _ref: "author-one" },
				categories: [{ _type: "reference", _ref: "category-one" }],
				publishedAt: "1970-01-01T00:00:01.000Z",
				body: [
					{
						_type: "block",
						_key: "opening",
						style: "normal",
						markDefs: [],
						children: [
							{
								_type: "span",
								_key: "opening-text",
								text: "The source body.",
								marks: [],
							},
						],
					},
				],
			},
		],
	};
}

async function boundedSnapshot(t: Awaited<ReturnType<typeof setup>>) {
	return await t.run(async (ctx) => ({
		documents: await ctx.db.query("contentDocuments").collect(),
		revisions: await ctx.db.query("contentRevisions").collect(),
		blocks: await ctx.db.query("contentBlocks").collect(),
		media: await ctx.db.query("contentMediaPlacements").collect(),
		references: await ctx.db.query("contentReferences").collect(),
		technical: await ctx.db.query("contentPostTechnicalItems").collect(),
	}));
}

async function importedFixture() {
	const t = await setup();
	const v1 = await v1Release();
	const imported = await t.run(
		async (ctx) =>
			await importReleasedSanityBlogDrafts(ctx, {
				plan: v1.plan,
				digest: v1.digest,
				contract: v1.contract,
			}),
	);
	const targets = await t.run(async (ctx) => {
		const entries: Record<string, SanityBlogTargetBaseline> = {};
		for (const result of imported.documents) {
			const document = await ctx.db.get(result.documentId);
			const revision = await ctx.db.get(result.revisionId);
			if (!document || !revision) throw new Error("Imported fixture target is missing");
			if (typeof document.rank !== "number") throw new Error("Imported fixture rank is missing");
			entries[result.documentKey] = {
				documentId: document._id,
				draftRevisionId: revision._id,
				draftChecksum: revision.checksum,
				documentSlug: document.slug,
				rank: document.rank,
			};
		}
		return entries;
	});
	const plan = createSanityBlogReconciliationPlan(sourceFixture(), {
		migrationId: "R6-blog-test",
		siteUrl: SITE,
		source: SOURCE,
		predecessor: v1.contract,
		imageAssetIds: {},
		targets,
		decisions: {
			id: "owner-decisions-test",
			categorySlugs: { "category-one": "field-notes-approved" },
			postSummaries: { "post-one": "The owner-approved summary." },
			imagePlacements: {},
			gearMappings: {},
			unsupportedFields: [],
			absentTargetFields: [
				{ field: "credits", action: "keep-absent-owner-approved" },
				{ field: "materials", action: "keep-absent-owner-approved" },
				{ field: "seoDescription", action: "keep-absent-owner-approved" },
				{ field: "seoTitle", action: "keep-absent-owner-approved" },
			],
		},
	});
	const digest = await checksumSanityBlogReconciliationPlan(plan);
	return { t, v1, imported, plan, digest };
}

describe("Sanity Blog reconciliation store", () => {
	test("atomically advances the exact v1 drafts without changing document identities", async () => {
		const fixture = await importedFixture();
		const result = await fixture.t.run(
			async (ctx) =>
				await reconcileSanityBlogDrafts(ctx, {
					plan: fixture.plan,
					digest: fixture.digest,
					predecessorContract: fixture.v1.contract,
				}),
		);

		expect(result.status).toBe("reconciled");
		expect(result.documents.map(({ documentId }) => documentId)).toEqual(
			fixture.imported.documents.map(({ documentId }) => documentId),
		);
		expect(result.documents.map(({ revisionId }) => revisionId)).not.toEqual(
			fixture.imported.documents.map(({ revisionId }) => revisionId),
		);
		const state = await boundedSnapshot(fixture.t);
		expect(state.documents).toHaveLength(3);
		expect(state.revisions).toHaveLength(6);
		for (const document of state.documents) {
			expect(document.publishedRevisionId).toBeUndefined();
			expect(document.createdBy).toMatch(/^sanityImport:/);
			expect(document.updatedBy).toMatch(/^sanityReconcile:/);
			expect(document.updatedAt).toBeGreaterThan(document.createdAt);
		}
		expect(state.documents.find(({ documentKey }) => documentKey === CATEGORY_KEY)?.slug).toBe(
			"field-notes-approved",
		);
		expect(
			state.revisions.filter(({ source }) => source === "sanityImport"),
		).toHaveLength(6);
	});

	test("returns an exact zero-write replay with the same current revision IDs", async () => {
		const fixture = await importedFixture();
		const first = await fixture.t.run(
			async (ctx) =>
				await reconcileSanityBlogDrafts(ctx, {
					plan: fixture.plan,
					digest: fixture.digest,
					predecessorContract: fixture.v1.contract,
				}),
		);
		const before = await boundedSnapshot(fixture.t);

		const replay = await fixture.t.run(
			async (ctx) =>
				await reconcileSanityBlogDrafts(ctx, {
					plan: fixture.plan,
					digest: fixture.digest,
					predecessorContract: fixture.v1.contract,
				}),
		);

		expect(replay).toEqual({
			status: "identical-replay",
			digest: fixture.digest,
			documents: first.documents,
		});
		expect(await boundedSnapshot(fixture.t)).toEqual(before);
	});

	test("rejects baseline drift before any reconciliation write", async () => {
		const fixture = await importedFixture();
		const author = fixture.imported.documents[0];
		await fixture.t.run(
			async (ctx) => await ctx.db.patch(author.documentId, { updatedBy: "tampered" }),
		);
		const before = await boundedSnapshot(fixture.t);

		await expect(
			fixture.t.run(
				async (ctx) =>
					await reconcileSanityBlogDrafts(ctx, {
						plan: fixture.plan,
						digest: fixture.digest,
						predecessorContract: fixture.v1.contract,
					}),
			),
		).rejects.toThrow(/no longer untouched/i);
		expect(await boundedSnapshot(fixture.t)).toEqual(before);
	});

	test("rejects unexpected restore provenance on baseline and replay revisions", async () => {
		const baselineFixture = await importedFixture();
		const baseline = baselineFixture.imported.documents[0];
		await baselineFixture.t.run(
			async (ctx) =>
				await ctx.db.patch(baseline.revisionId, {
					restoredFromRevisionId: baseline.revisionId,
					restoreOperationId: "unexpected-restore",
					restoreRequestDigest: "f".repeat(64),
				}),
		);
		await expect(
			baselineFixture.t.run(
				async (ctx) =>
					await reconcileSanityBlogDrafts(ctx, {
						plan: baselineFixture.plan,
						digest: baselineFixture.digest,
						predecessorContract: baselineFixture.v1.contract,
					}),
			),
		).rejects.toThrow(/v1 Blog revision provenance drifted/i);

		const replayFixture = await importedFixture();
		const reconciled = await replayFixture.t.run(
			async (ctx) =>
				await reconcileSanityBlogDrafts(ctx, {
					plan: replayFixture.plan,
					digest: replayFixture.digest,
					predecessorContract: replayFixture.v1.contract,
				}),
		);
		const current = reconciled.documents[0];
		await replayFixture.t.run(
			async (ctx) =>
				await ctx.db.patch(current.revisionId, {
					restoredFromRevisionId: current.revisionId,
					restoreOperationId: "unexpected-restore",
					restoreRequestDigest: "f".repeat(64),
				}),
		);
		await expect(
			replayFixture.t.run(
				async (ctx) =>
					await reconcileSanityBlogDrafts(ctx, {
						plan: replayFixture.plan,
						digest: replayFixture.digest,
						predecessorContract: replayFixture.v1.contract,
					}),
			),
		).rejects.toThrow(/replay provenance drifted/i);
	});

	test("rejects replay drift and a stale digest without adding writes", async () => {
		const fixture = await importedFixture();
		const reconciled = await fixture.t.run(
			async (ctx) =>
				await reconcileSanityBlogDrafts(ctx, {
					plan: fixture.plan,
					digest: fixture.digest,
					predecessorContract: fixture.v1.contract,
				}),
		);
		const post = reconciled.documents.find(({ kind }) => kind === "post");
		if (!post) throw new Error("Reconciled Post is missing");
		await fixture.t.run(
			async (ctx) => await ctx.db.patch(post.revisionId, { source: "admin" }),
		);
		const before = await boundedSnapshot(fixture.t);
		await expect(
			fixture.t.run(
				async (ctx) =>
					await reconcileSanityBlogDrafts(ctx, {
						plan: fixture.plan,
						digest: fixture.digest,
						predecessorContract: fixture.v1.contract,
					}),
			),
		).rejects.toThrow(/replay provenance drifted/i);
		expect(await boundedSnapshot(fixture.t)).toEqual(before);

		await expect(
			fixture.t.run(
				async (ctx) =>
					await reconcileSanityBlogDrafts(ctx, {
						plan: fixture.plan,
						digest: "0".repeat(64),
						predecessorContract: fixture.v1.contract,
					}),
			),
		).rejects.toThrow(/canonical bytes/i);
		expect(await boundedSnapshot(fixture.t)).toEqual(before);

		await expect(
			fixture.t.run(
				async (ctx) =>
					await reconcileSanityBlogDrafts(ctx, {
						plan: fixture.plan,
						digest: fixture.digest,
						predecessorContract: {
							...fixture.v1.contract,
							expectedDigest: "f".repeat(64),
						},
					}),
			),
		).rejects.toThrow(/accepted v1 release/i);
		expect(await boundedSnapshot(fixture.t)).toEqual(before);
	});
});
