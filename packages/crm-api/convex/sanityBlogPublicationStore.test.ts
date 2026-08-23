/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import {
	checksumSanityBlogImportPlan,
	type SanityBlogImportPlan,
	type SanityBlogImportReleaseContract,
} from "./helpers/sanityBlogImportPlan";
import { importReleasedSanityBlogDrafts } from "./helpers/sanityBlogImportStore";
import { publishReconciledSanityBlogDrafts } from "./helpers/sanityBlogPublicationStore";
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
const POST_IDS = ["post-a", "post-b", "post-c", "post-d"] as const;
const POST_KEYS = POST_IDS.map((sourceId) => `sanity.post.${sourceId}`);

function paragraph(key: string, text: string) {
	return {
		type: "paragraph" as const,
		key,
		children: [
			{
				type: "text" as const,
				key: `${key}-text`,
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
	return {
		t,
		admin: t.withIdentity({ subject: EMAIL, email: EMAIL }),
	};
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
		posts: POST_IDS.map((sourceId, index) => ({
			sourceId,
			documentKey: POST_KEYS[index],
			authorDocumentKey: AUTHOR_KEY,
			categoryReferences: [{ key: "category-primary", documentKey: CATEGORY_KEY }],
			draft: {
				kind: "post" as const,
				title: `Imported Post ${index + 1}`,
				slug: `imported-post-${index + 1}`,
				format: "essay" as const,
				presentation: "standard" as const,
				displayPublishedAt: (index + 1) * 1_000,
				summary: `The source body for post ${index + 1}.`,
				equipment: [],
				materials: [],
				categories: [],
				body: {
					version: 1 as const,
					blocks: [paragraph(`opening-${index + 1}`, `The source body for post ${index + 1}.`)],
				},
			},
		})),
	};
	const digest = await checksumSanityBlogImportPlan(plan);
	const contract: SanityBlogImportReleaseContract = {
		version: 1,
		migrationId: plan.migrationId,
		siteUrl: SITE,
		source: SOURCE,
		counts: { authors: 1, categories: 1, posts: 4, assets: 0 },
		documentKeys: {
			authors: [AUTHOR_KEY],
			categories: [CATEGORY_KEY],
			posts: POST_KEYS,
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
		posts: POST_IDS.map((sourceId, index) => ({
			_id: sourceId,
			_rev: `${sourceId}-rev-2`,
			_type: "post" as const,
			title: `Imported Post ${index + 1}`,
			postType: "standard",
			slug: { current: `imported-post-${index + 1}` },
			author: { _type: "reference" as const, _ref: "author-one" },
			categories: [{ _type: "reference" as const, _ref: "category-one" }],
			publishedAt: new Date((index + 1) * 1_000).toISOString(),
			body: [
				{
					_type: "block" as const,
					_key: `opening-${index + 1}`,
					style: "normal",
					markDefs: [],
					children: [
						{
							_type: "span" as const,
							_key: `opening-${index + 1}-text`,
							text: `The source body for post ${index + 1}.`,
							marks: [],
						},
					],
				},
			],
		})),
	};
}

async function boundedSnapshot(t: Awaited<ReturnType<typeof setup>>["t"]) {
	return await t.run(async (ctx) => ({
		documents: await ctx.db.query("contentDocuments").take(20),
		revisions: await ctx.db.query("contentRevisions").take(30),
		slugHistory: await ctx.db.query("contentSlugHistory").take(20),
	}));
}

async function reconciledFixture() {
	const fixture = await setup();
	const v1 = await v1Release();
	const imported = await fixture.t.run(
		async (ctx) =>
			await importReleasedSanityBlogDrafts(ctx, {
				plan: v1.plan,
				digest: v1.digest,
				contract: v1.contract,
			}),
	);
	const targets = await fixture.t.run(async (ctx) => {
		const entries: Record<string, SanityBlogTargetBaseline> = {};
		for (const result of imported.documents) {
			const document = await ctx.db.get(result.documentId);
			const revision = await ctx.db.get(result.revisionId);
			if (!document || !revision || typeof document.rank !== "number") {
				throw new Error("Imported publication fixture target is missing");
			}
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
		migrationId: "R6-blog-publication-test",
		siteUrl: SITE,
		source: SOURCE,
		predecessor: v1.contract,
		imageAssetIds: {},
		targets,
		decisions: {
			id: "owner-decisions-publication-test",
			categorySlugs: { "category-one": "field-notes-approved" },
			postSummaries: Object.fromEntries(
				POST_IDS.map((sourceId, index) => [
					sourceId,
					`The owner-approved summary for post ${index + 1}.`,
				]),
			),
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
	const reconciled = await fixture.t.run(
		async (ctx) =>
			await reconcileSanityBlogDrafts(ctx, {
				plan,
				digest,
				predecessorContract: v1.contract,
			}),
	);
	return { ...fixture, plan, digest, reconciled };
}

describe("Sanity Blog fixed-manifest publication store", () => {
	test("publishes the exact six reconciled drafts atomically", async () => {
		const fixture = await reconciledFixture();
		const result = await fixture.t.run(
			async (ctx) =>
				await publishReconciledSanityBlogDrafts(ctx, {
					plan: fixture.plan,
					digest: fixture.digest,
				}),
		);

		expect(result).toMatchObject({
			status: "published",
			digest: fixture.digest,
			documents: fixture.reconciled.documents,
		});
		const state = await boundedSnapshot(fixture.t);
		expect(state.documents).toHaveLength(6);
		expect(state.revisions).toHaveLength(12);
		expect(state.slugHistory).toEqual([]);
		expect(new Set(state.documents.map(({ publishedAt }) => publishedAt))).toHaveProperty(
			"size",
			1,
		);
		for (const document of state.documents) {
			expect(document.draftRevisionId).toBeUndefined();
			expect(document.publishedRevisionId).toBeDefined();
			expect(document.publishedBy).toMatch(/^sanityPublish:/);
			expect(document.updatedBy).toBe(document.publishedBy);
			expect(document.updatedAt).toBe(document.publishedAt);
		}
	});

	test("returns an exact zero-write replay with the same identities and order", async () => {
		const fixture = await reconciledFixture();
		const first = await fixture.t.run(
			async (ctx) =>
				await publishReconciledSanityBlogDrafts(ctx, {
					plan: fixture.plan,
					digest: fixture.digest,
				}),
		);
		const before = await boundedSnapshot(fixture.t);

		const replay = await fixture.t.run(
			async (ctx) =>
				await publishReconciledSanityBlogDrafts(ctx, {
					plan: fixture.plan,
					digest: fixture.digest,
				}),
		);

		expect(replay).toEqual({
			status: "identical-replay",
			digest: fixture.digest,
			documents: first.documents,
		});
		expect(await boundedSnapshot(fixture.t)).toEqual(before);
	});

	test("rejects partial state without adding publication writes", async () => {
		const fixture = await reconciledFixture();
		const first = fixture.reconciled.documents[0];
		await fixture.t.run(
			async (ctx) =>
				await ctx.db.patch(first.documentId, {
					draftRevisionId: undefined,
					publishedRevisionId: first.revisionId,
					publishedAt: 42,
					publishedBy: "tampered",
				}),
		);
		const before = await boundedSnapshot(fixture.t);

		await expect(
			fixture.t.run(
				async (ctx) =>
					await publishReconciledSanityBlogDrafts(ctx, {
						plan: fixture.plan,
						digest: fixture.digest,
					}),
			),
		).rejects.toThrow(/partial or drifted/i);
		expect(await boundedSnapshot(fixture.t)).toEqual(before);
	});

	test("rejects an outside published Blog document", async () => {
		const fixture = await reconciledFixture();
		const extra = await fixture.admin.mutation(api.blogContent.createDraft, {
			siteUrl: SITE,
			documentKey: "outside-category",
			draft: {
				kind: "category",
				title: "Outside Category",
				slug: "outside-category",
			},
		});
		await fixture.admin.mutation(api.blogContent.publish, {
			documentId: extra.documentId,
			draftRevisionId: extra.revisionId,
		});
		const before = await boundedSnapshot(fixture.t);

		await expect(
			fixture.t.run(
				async (ctx) =>
					await publishReconciledSanityBlogDrafts(ctx, {
						plan: fixture.plan,
						digest: fixture.digest,
					}),
			),
		).rejects.toThrow(/outside published document/i);
		expect(await boundedSnapshot(fixture.t)).toEqual(before);
	});

	test("rejects a non-six-document plan before reading target state", async () => {
		const fixture = await reconciledFixture();
		const shortened = {
			...fixture.plan,
			decisionSet: {
				...fixture.plan.decisionSet,
				postSummaries: fixture.plan.decisionSet.postSummaries.slice(0, 3),
			},
			posts: fixture.plan.posts.slice(0, 3),
		};
		const digest = await checksumSanityBlogReconciliationPlan(shortened);

		await expect(
			fixture.t.run(
				async (ctx) =>
					await publishReconciledSanityBlogDrafts(ctx, { plan: shortened, digest }),
			),
		).rejects.toThrow(/exactly 1 Author, 1 Category, and 4 Posts/i);
	});
});
