/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
	checksumSanityBlogImportPlan,
	type SanityBlogImportPlan,
	type SanityBlogImportReleaseContract,
} from "./helpers/sanityBlogImportPlan";
import { importReleasedSanityBlogDrafts } from "./helpers/sanityBlogImportStore";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const SITE_A = { siteUrl: "site-a.example", email: "admin-a@example.com" };
const SITE_B = { siteUrl: "site-b.example", email: "admin-b@example.com" };
const PORTRAIT_ASSET_UUID = "123e4567-e89b-42d3-a456-426614174000";
const BODY_ASSET_UUID = "223e4567-e89b-42d3-a456-426614174001";
const MAIN_ASSET_UUID = "323e4567-e89b-42d3-a456-426614174002";
const AUTHOR_KEY = "sanity.author.author-one";
const CATEGORY_KEY = "sanity.category.category-one";
const POST_KEYS = [
	"sanity.post.post-a",
	"sanity.post.post-b",
	"sanity.post.post-c",
	"sanity.post.post-d",
] as const;
const MIGRATION_ID = "TEST-CMS-4.4p";
const SOURCE = {
	projectId: "test-project",
	dataset: "test-dataset",
	perspective: "published" as const,
};

function readyAsset(siteUrl: string, assetId: string) {
	const prefix = `sites/${siteUrl}/web/${assetId}/`;
	return {
		assetId,
		originalFilename: `${assetId}.jpg`,
		source: {
			contentType: "image/jpeg" as const,
			sizeBytes: 1_000_000,
			width: 3000,
			height: 2000,
		},
		master: {
			key: `${prefix}master.webp`,
			contentType: "image/webp" as const,
			sizeBytes: 700_000,
			width: 3000,
			height: 2000,
		},
		derivatives: {
			thumb: {
				key: `${prefix}thumb.webp`,
				contentType: "image/webp" as const,
				width: 320,
				height: 213,
			},
			card: {
				key: `${prefix}card.webp`,
				contentType: "image/webp" as const,
				width: 768,
				height: 512,
			},
			display1280: {
				key: `${prefix}display-1280.webp`,
				contentType: "image/webp" as const,
				width: 1280,
				height: 853,
			},
			display2048: {
				key: `${prefix}display-2048.webp`,
				contentType: "image/webp" as const,
				width: 2048,
				height: 1365,
			},
			display2560: {
				key: `${prefix}display-2560.webp`,
				contentType: "image/webp" as const,
				width: 2560,
				height: 1707,
			},
		},
	};
}

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
	for (const site of [SITE_A, SITE_B]) {
		await t.mutation(internal.platform.seedClient, {
			name: site.siteUrl,
			email: site.email,
			siteUrl: site.siteUrl,
			tier: "full",
			subscriptionStatus: "active",
			adminEmails: [site.email],
			role: "client",
		});
	}
	const adminA = t.withIdentity({
		subject: SITE_A.email,
		email: SITE_A.email,
	});
	const [portraitAsset, bodyAsset, mainAsset] = await Promise.all([
		adminA.mutation(api.mediaAssets.registerReadyWebAsset, {
			siteUrl: SITE_A.siteUrl,
			asset: readyAsset(SITE_A.siteUrl, PORTRAIT_ASSET_UUID),
		}),
		adminA.mutation(api.mediaAssets.registerReadyWebAsset, {
			siteUrl: SITE_A.siteUrl,
			asset: readyAsset(SITE_A.siteUrl, BODY_ASSET_UUID),
		}),
		adminA.mutation(api.mediaAssets.registerReadyWebAsset, {
			siteUrl: SITE_A.siteUrl,
			asset: readyAsset(SITE_A.siteUrl, MAIN_ASSET_UUID),
		}),
	]);
	return { t, adminA, portraitAsset, bodyAsset, mainAsset };
}

type Setup = Awaited<ReturnType<typeof setup>>;

async function createTestRelease(assets: Pick<Setup, "portraitAsset" | "bodyAsset" | "mainAsset">) {
	const plan: SanityBlogImportPlan = {
		version: 1,
		migrationId: MIGRATION_ID,
		siteUrl: SITE_A.siteUrl,
		source: SOURCE,
		assetMappings: [
			{
				sourceAssetRef: "image-author-600x600-jpg",
				mediaAssetId: assets.portraitAsset.id,
			},
			{
				sourceAssetRef: "image-body-1200x800-jpg",
				mediaAssetId: assets.bodyAsset.id,
			},
			{
				sourceAssetRef: "image-main-1600x1200-jpg",
				mediaAssetId: assets.mainAsset.id,
			},
		],
		authors: [
			{
				sourceId: "author-one",
				documentKey: AUTHOR_KEY,
				draft: {
					kind: "author",
					name: "Import Author",
					slug: "import-author",
					bio: {
						version: 1,
						blocks: [
							paragraph(
								"author-bio",
								"A provider-neutral biography imported from the test source.",
							),
						],
					},
					portrait: {
						key: "author-portrait",
						assetId: assets.portraitAsset.id,
						altText: "Import Author holding a camera.",
					},
				},
			},
		],
		categories: [
			{
				sourceId: "category-one",
				documentKey: CATEGORY_KEY,
				draft: {
					kind: "category",
					title: "Import Category",
					slug: "import-category",
					description: "A category supplied by the injected test release.",
				},
			},
		],
		posts: [
			{
				sourceId: "post-a",
				documentKey: POST_KEYS[0],
				authorDocumentKey: AUTHOR_KEY,
				categoryReferences: [{ key: "category-primary", documentKey: CATEGORY_KEY }],
				draft: {
					kind: "post",
					title: "Imported Post A",
					slug: "imported-post-a",
					format: "essay",
					presentation: "standard",
					displayPublishedAt: 1_000,
					summary: "The first imported test post.",
					equipment: [],
					materials: [],
					categories: [],
					mainImage: {
						key: "post-a-main",
						assetId: assets.mainAsset.id,
						altText: "The main image for imported post A.",
					},
					body: {
						version: 1,
						blocks: [
							paragraph("post-a-opening", "The imported story begins here."),
							{
								type: "image",
								key: "post-a-body-image",
								assetId: assets.bodyAsset.id,
								altText: "The body image for imported post A.",
							},
						],
					},
				},
			},
			{
				sourceId: "post-b",
				documentKey: POST_KEYS[1],
				authorDocumentKey: AUTHOR_KEY,
				categoryReferences: [{ key: "category-primary", documentKey: CATEGORY_KEY }],
				draft: {
					kind: "post",
					title: "Imported Post B",
					slug: "imported-post-b",
					format: "essay",
					presentation: "behindTheScenes",
					displayPublishedAt: 2_000,
					summary: "The second imported test post.",
					equipment: [],
					materials: [],
					categories: [],
					body: {
						version: 1,
						blocks: [paragraph("post-b-opening", "A second imported story.")],
					},
				},
			},
			{
				sourceId: "post-c",
				documentKey: POST_KEYS[2],
				authorDocumentKey: AUTHOR_KEY,
				categoryReferences: [{ key: "category-primary", documentKey: CATEGORY_KEY }],
				draft: {
					kind: "post",
					title: "Imported Post C",
					slug: "imported-post-c",
					format: "technicalNote",
					presentation: "technical",
					displayPublishedAt: 3_000,
					summary: "The technical imported test post.",
					equipment: [{ key: "camera", label: "Camera", details: "Test camera" }],
					materials: [{ key: "film", label: "Film", details: "Test film" }],
					categories: [],
					body: {
						version: 1,
						blocks: [paragraph("post-c-opening", "A technical imported story.")],
					},
				},
			},
			{
				sourceId: "post-d",
				documentKey: POST_KEYS[3],
				authorDocumentKey: AUTHOR_KEY,
				categoryReferences: [{ key: "category-primary", documentKey: CATEGORY_KEY }],
				draft: {
					kind: "post",
					title: "Imported Post D",
					slug: "imported-post-d",
					format: "essay",
					presentation: "standard",
					displayPublishedAt: 4_000,
					summary: "The final imported test post.",
					equipment: [],
					materials: [],
					categories: [],
					body: {
						version: 1,
						blocks: [paragraph("post-d-opening", "The final imported story.")],
					},
				},
			},
		],
	};
	const digest = await checksumSanityBlogImportPlan(plan);
	const contract: SanityBlogImportReleaseContract = {
		version: 1,
		migrationId: MIGRATION_ID,
		siteUrl: SITE_A.siteUrl,
		source: SOURCE,
		counts: { authors: 1, categories: 1, posts: 4, assets: 3 },
		documentKeys: {
			authors: [AUTHOR_KEY],
			categories: [CATEGORY_KEY],
			posts: [...POST_KEYS],
		},
		expectedDigest: digest,
	};
	return { plan, digest, contract };
}

function sortRows<T extends { _id: string }>(rows: T[]) {
	return rows.sort((left, right) => left._id.localeCompare(right._id));
}

async function boundedContentSnapshot(t: Setup["t"]) {
	return await t.run(async (ctx) => ({
		clients: sortRows(await ctx.db.query("platformClients").take(4)),
		assets: sortRows(await ctx.db.query("mediaAssets").take(8)),
		documents: sortRows(await ctx.db.query("contentDocuments").take(16)),
		revisions: sortRows(await ctx.db.query("contentRevisions").take(16)),
		blocks: sortRows(await ctx.db.query("contentBlocks").take(64)),
		mediaPlacements: sortRows(await ctx.db.query("contentMediaPlacements").take(16)),
		technicalItems: sortRows(await ctx.db.query("contentPostTechnicalItems").take(16)),
		references: sortRows(await ctx.db.query("contentReferences").take(32)),
		slugHistory: sortRows(await ctx.db.query("contentSlugHistory").take(16)),
	}));
}

async function runImport(t: Setup["t"], release: Awaited<ReturnType<typeof createTestRelease>>) {
	return await t.run(
		async (ctx) =>
			await importReleasedSanityBlogDrafts(ctx, {
				plan: release.plan,
				digest: release.digest,
				contract: release.contract,
			}),
	);
}

function tamperFirstPostTitle(plan: SanityBlogImportPlan, title: string) {
	const [first, ...remaining] = plan.posts;
	if (!first) throw new Error("Test release has no Post");
	return {
		...plan,
		posts: [{ ...first, draft: { ...first.draft, title } }, ...remaining],
	} satisfies SanityBlogImportPlan;
}

const INVALID_MEDIA_CASES: Array<{
	label: string;
	corrupt: (fixture: Setup) => Promise<void>;
}> = [
	{
		label: "missing",
		corrupt: async ({ t, bodyAsset }) => {
			await t.run(async (ctx) => await ctx.db.delete(bodyAsset.id));
		},
	},
	{
		label: "foreign",
		corrupt: async ({ t, mainAsset }) => {
			await t.run(async (ctx) => await ctx.db.patch(mainAsset.id, { siteUrl: SITE_B.siteUrl }));
		},
	},
	{
		label: "unready",
		corrupt: async ({ t, portraitAsset }) => {
			await t.run(async (ctx) => await ctx.db.patch(portraitAsset.id, { status: "deleting" }));
		},
	},
];

type TestRelease = Awaited<ReturnType<typeof createTestRelease>>;
type ImportResult = Awaited<ReturnType<typeof runImport>>;
type ReplayDocumentState = "admin-edited" | "published" | "archived";

const REPLAY_DOCUMENT_STATE_CASES: Array<{
	label: string;
	state: ReplayDocumentState;
	corrupt: (
		fixture: Setup,
		release: TestRelease,
		imported: ImportResult,
	) => Promise<Id<"contentDocuments">>;
}> = [
	{
		label: "an admin edit changes updatedBy",
		state: "admin-edited",
		corrupt: async (fixture, release, imported) => {
			const target = imported.documents[0];
			const draft = release.plan.authors[0].draft;
			if (draft.kind !== "author") throw new Error("Test release Author kind mismatch");
			await fixture.adminA.mutation(api.blogContent.saveDraft, {
				documentId: target.documentId,
				expectedDraftRevisionId: target.revisionId,
				draft: {
					...draft,
					name: "Admin-edited Import Author",
				},
			});
			return target.documentId;
		},
	},
	{
		label: "the target has been published",
		state: "published",
		corrupt: async (fixture, _release, imported) => {
			const target = imported.documents[0];
			await fixture.adminA.mutation(api.blogContent.publish, {
				documentId: target.documentId,
				draftRevisionId: target.revisionId,
			});
			return target.documentId;
		},
	},
	{
		label: "the target has been archived",
		state: "archived",
		corrupt: async (fixture, _release, imported) => {
			const target = imported.documents[2];
			await fixture.adminA.mutation(api.postContent.archive, {
				documentId: target.documentId,
			});
			return target.documentId;
		},
	},
];

describe("released Sanity Blog import store", () => {
	test("imports the fixed unpublished batch with Sanity provenance and complete graph rows", async () => {
		const fixture = await setup();
		const release = await createTestRelease(fixture);

		const result = await runImport(fixture.t, release);

		expect(result).toMatchObject({ status: "imported", digest: release.digest });
		expect(result.documents.map(({ kind, documentKey }) => [kind, documentKey])).toEqual([
			["author", AUTHOR_KEY],
			["category", CATEGORY_KEY],
			["post", POST_KEYS[0]],
			["post", POST_KEYS[1]],
			["post", POST_KEYS[2]],
			["post", POST_KEYS[3]],
		]);
		expect(new Set(result.documents.map(({ documentId }) => documentId)).size).toBe(6);

		const state = await boundedContentSnapshot(fixture.t);
		const actor = `sanityImport:${MIGRATION_ID}:${SOURCE.projectId}/${SOURCE.dataset}`;
		expect(state.documents).toHaveLength(6);
		expect(state.revisions).toHaveLength(6);
		for (const document of state.documents) {
			expect(document).toMatchObject({
				siteUrl: SITE_A.siteUrl,
				createdBy: actor,
				updatedBy: actor,
			});
			expect(document.draftRevisionId).toBeDefined();
			expect(document.publishedRevisionId).toBeUndefined();
			expect(document.publishedAt).toBeUndefined();
			expect(document.createdAt).toBe(document.updatedAt);
		}
		for (const revision of state.revisions) {
			expect(revision).toMatchObject({
				siteUrl: SITE_A.siteUrl,
				source: "sanityImport",
				createdBy: actor,
			});
		}
		expect(
			state.documents
				.filter(({ kind }) => kind === "post")
				.map(({ documentKey, rank }) => [documentKey, rank]),
		).toEqual(POST_KEYS.map((documentKey, rank) => [documentKey, rank]));
		expect(state.blocks).toHaveLength(5);
		expect(state.blocks.map(({ order }) => order)).toEqual([0, 1, 0, 0, 0]);
		expect(state.mediaPlacements).toHaveLength(2);
		expect(
			state.mediaPlacements.map(({ role, placementKey, assetId }) => [role, placementKey, assetId]),
		).toEqual(
			expect.arrayContaining([
				["main", "post-a-main", fixture.mainAsset.id],
				["body", "post-a-body-image", fixture.bodyAsset.id],
			]),
		);
		expect(state.technicalItems).toHaveLength(2);
		expect(state.technicalItems.map(({ field, itemKey }) => [field, itemKey])).toEqual(
			expect.arrayContaining([
				["equipment", "camera"],
				["material", "film"],
			]),
		);
		expect(state.references).toHaveLength(8);
		const authorDocumentId = result.documents.find(({ kind }) => kind === "author")?.documentId;
		const categoryDocumentId = result.documents.find(({ kind }) => kind === "category")?.documentId;
		expect(
			state.references
				.filter(({ field }) => field === "author")
				.map(({ toDocumentId }) => toDocumentId),
		).toEqual(Array.from({ length: 4 }, () => authorDocumentId));
		expect(
			state.references
				.filter(({ field }) => field === "category")
				.map(({ toDocumentId }) => toDocumentId),
		).toEqual(Array.from({ length: 4 }, () => categoryDocumentId));
		expect(state.slugHistory).toEqual([]);

		await expect(
			fixture.t.query(api.blogContent.listPublished, {
				siteUrl: SITE_A.siteUrl,
				kind: "author",
			}),
		).resolves.toEqual([]);
		await expect(
			fixture.t.query(api.blogContent.listPublished, {
				siteUrl: SITE_A.siteUrl,
				kind: "category",
			}),
		).resolves.toEqual([]);
		await expect(
			fixture.t.query(api.postContent.listPublished, {
				siteUrl: SITE_A.siteUrl,
				limit: 10,
			}),
		).resolves.toEqual([]);
		await expect(
			fixture.t.query(api.postContent.getPublishedBySlug, {
				siteUrl: SITE_A.siteUrl,
				slug: "imported-post-a",
			}),
		).resolves.toBeNull();
	});

	test("accepts an identical replay with the same IDs and no database changes", async () => {
		const fixture = await setup();
		const release = await createTestRelease(fixture);
		const first = await runImport(fixture.t, release);
		const beforeReplay = await boundedContentSnapshot(fixture.t);

		const replay = await runImport(fixture.t, release);

		expect(replay).toEqual({
			status: "identical-replay",
			digest: release.digest,
			documents: first.documents,
		});
		expect(await boundedContentSnapshot(fixture.t)).toEqual(beforeReplay);
	});

	test("rejects both stale and caller-recomputed tampered digests before writes", async () => {
		const fixture = await setup();
		const release = await createTestRelease(fixture);
		const before = await boundedContentSnapshot(fixture.t);
		const staleDigestPlan = tamperFirstPostTitle(release.plan, "Tampered with the old digest");

		await expect(
			fixture.t.run(
				async (ctx) =>
					await importReleasedSanityBlogDrafts(ctx, {
						plan: staleDigestPlan,
						digest: release.digest,
						contract: release.contract,
					}),
			),
		).rejects.toThrow(/digest does not match the released batch/i);
		expect(await boundedContentSnapshot(fixture.t)).toEqual(before);

		const recomputedPlan = tamperFirstPostTitle(release.plan, "Tampered with a recomputed digest");
		const recomputedDigest = await checksumSanityBlogImportPlan(recomputedPlan);
		await expect(
			fixture.t.run(
				async (ctx) =>
					await importReleasedSanityBlogDrafts(ctx, {
						plan: recomputedPlan,
						digest: recomputedDigest,
						contract: release.contract,
					}),
			),
		).rejects.toThrow(/digest does not match the released batch/i);
		expect(await boundedContentSnapshot(fixture.t)).toEqual(before);
	});

	test("rejects a partial target-key state without adding rows", async () => {
		const fixture = await setup();
		const release = await createTestRelease(fixture);
		await fixture.adminA.mutation(api.blogContent.createDraft, {
			siteUrl: SITE_A.siteUrl,
			documentKey: AUTHOR_KEY,
			draft: release.plan.authors[0].draft,
		});
		const before = await boundedContentSnapshot(fixture.t);

		await expect(runImport(fixture.t, release)).rejects.toThrow(/partial state/i);

		expect(await boundedContentSnapshot(fixture.t)).toEqual(before);
	});

	test("rejects an exact-checksum replay whose revision source is admin", async () => {
		const fixture = await setup();
		const release = await createTestRelease(fixture);
		const imported = await runImport(fixture.t, release);
		const authorRevisionId = imported.documents[0].revisionId;
		const original = await boundedContentSnapshot(fixture.t);
		const originalChecksum = original.revisions.find(
			({ _id }) => _id === authorRevisionId,
		)?.checksum;
		await fixture.t.run(async (ctx) => await ctx.db.patch(authorRevisionId, { source: "admin" }));
		const beforeReplay = await boundedContentSnapshot(fixture.t);
		const changedRevision = beforeReplay.revisions.find(({ _id }) => _id === authorRevisionId);
		expect(changedRevision).toMatchObject({
			source: "admin",
			checksum: originalChecksum,
		});

		await expect(runImport(fixture.t, release)).rejects.toThrow(
			/revision provenance is not an exact replay/i,
		);

		expect(await boundedContentSnapshot(fixture.t)).toEqual(beforeReplay);
	});

	test.each(
		REPLAY_DOCUMENT_STATE_CASES,
	)("rejects replay after $label without adding changes", async ({ state, corrupt }) => {
		const fixture = await setup();
		const release = await createTestRelease(fixture);
		const imported = await runImport(fixture.t, release);
		const targetDocumentId = await corrupt(fixture, release, imported);
		const beforeReplay = await boundedContentSnapshot(fixture.t);
		const target = beforeReplay.documents.find(({ _id }) => _id === targetDocumentId);
		if (!target) throw new Error("Corrupted replay target is missing");

		if (state === "admin-edited") {
			expect(target.updatedBy).not.toContain("sanityImport:");
			expect(
				beforeReplay.revisions.filter(({ documentId }) => documentId === targetDocumentId),
			).toHaveLength(2);
		} else if (state === "published") {
			expect(target.publishedRevisionId).toBeDefined();
			expect(target.publishedAt).toBeDefined();
			expect(target.publishedBy).toBeDefined();
			expect(target.draftRevisionId).toBeUndefined();
		} else {
			expect(target.archivedAt).toBeDefined();
			expect(target.archivedBy).toBeDefined();
		}

		await expect(runImport(fixture.t, release)).rejects.toThrow(
			/not an untouched unpublished draft/i,
		);
		expect(await boundedContentSnapshot(fixture.t)).toEqual(beforeReplay);
	});

	test("rejects a supporting payload tamper even when its stored checksum is unchanged", async () => {
		const fixture = await setup();
		const release = await createTestRelease(fixture);
		const imported = await runImport(fixture.t, release);
		const authorRevisionId = imported.documents[0].revisionId;
		const originalChecksum = await fixture.t.run(
			async (ctx) => (await ctx.db.get(authorRevisionId))?.checksum,
		);
		if (!originalChecksum) throw new Error("Imported Author checksum is missing");
		await fixture.t.run(async (ctx) => {
			const revision = await ctx.db.get(authorRevisionId);
			if (!revision || !("kind" in revision.payload) || revision.payload.kind !== "author") {
				throw new Error("Imported Author revision is missing");
			}
			await ctx.db.patch(authorRevisionId, {
				payload: { ...revision.payload, name: "Tampered stored Author" },
			});
		});
		const beforeReplay = await boundedContentSnapshot(fixture.t);
		const tampered = beforeReplay.revisions.find(({ _id }) => _id === authorRevisionId);
		expect(tampered).toMatchObject({
			checksum: originalChecksum,
			payload: { kind: "author", name: "Tampered stored Author" },
		});

		await expect(runImport(fixture.t, release)).rejects.toThrow(/supporting revision changed/i);
		expect(await boundedContentSnapshot(fixture.t)).toEqual(beforeReplay);
	});

	test.each(INVALID_MEDIA_CASES)("rejects $label import media without writing content", async ({
		corrupt,
	}) => {
		const fixture = await setup();
		const release = await createTestRelease(fixture);
		await corrupt(fixture);
		const before = await boundedContentSnapshot(fixture.t);

		await expect(runImport(fixture.t, release)).rejects.toThrow(/missing, foreign, or not ready/i);

		expect(before.documents).toEqual([]);
		expect(await boundedContentSnapshot(fixture.t)).toEqual(before);
	});

	test("rolls back every target row when the final Post slug is already reserved", async () => {
		const fixture = await setup();
		const release = await createTestRelease(fixture);
		const finalSlug = release.plan.posts.at(-1)?.draft.slug;
		if (!finalSlug) throw new Error("Test release final Post has no slug");
		await fixture.adminA.mutation(api.postContent.createDraft, {
			siteUrl: SITE_A.siteUrl,
			documentKey: "unrelated-reserved-slug-owner",
			draft: {
				kind: "post",
				title: "Unrelated reserved slug owner",
				slug: finalSlug,
				equipment: [],
				materials: [],
				categories: [],
				body: { version: 1, blocks: [] },
			},
		});
		const before = await boundedContentSnapshot(fixture.t);
		const targetKeys = new Set([AUTHOR_KEY, CATEGORY_KEY, ...POST_KEYS]);

		await expect(runImport(fixture.t, release)).rejects.toThrow(/Post slug .* is reserved/i);

		const after = await boundedContentSnapshot(fixture.t);
		expect(after).toEqual(before);
		expect(
			after.documents.some(({ documentKey }) =>
				documentKey ? targetKeys.has(documentKey) : false,
			),
		).toBe(false);
	});
});
