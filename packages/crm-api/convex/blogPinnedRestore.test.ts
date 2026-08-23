/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
	type BlogPinnedRestoreEntry,
	restorePinnedBlogRevisions,
} from "./helpers/blogPinnedRestore";
import { contentRevisionProvenanceFields } from "./helpers/contentRevisionProvenance";
import type { PostDraft } from "./helpers/postContentValidators";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const SITE_A = { siteUrl: "site-a.example", email: "admin-a@example.com" };
const SITE_B = { siteUrl: "site-b.example", email: "admin-b@example.com" };
const ASSET_A = "123e4567-e89b-42d3-a456-426614174000";
const ASSET_B = "223e4567-e89b-42d3-a456-426614174001";
const PORTRAIT_FRAMING = {
	crop: { top: 0.01, right: 0.02, bottom: 0.2, left: 0.03 },
	focus: { x: 0.5, y: 0.4, width: 0.8, height: 0.6 },
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
	const adminA = t.withIdentity({ subject: SITE_A.email, email: SITE_A.email });
	const adminB = t.withIdentity({ subject: SITE_B.email, email: SITE_B.email });
	const [assetA, assetB] = await Promise.all([
		adminA.mutation(api.mediaAssets.registerReadyWebAsset, {
			siteUrl: SITE_A.siteUrl,
			asset: readyAsset(SITE_A.siteUrl, ASSET_A),
		}),
		adminB.mutation(api.mediaAssets.registerReadyWebAsset, {
			siteUrl: SITE_B.siteUrl,
			asset: readyAsset(SITE_B.siteUrl, ASSET_B),
		}),
	]);
	return { t, adminA, adminB, assetA, assetB };
}

type Fixture = Awaited<ReturnType<typeof setup>>;
type Admin = Fixture["adminA"];
type RestorePinnedArgs = Parameters<typeof restorePinnedBlogRevisions>[1];

async function runPinnedRestore(
	fixture: Fixture,
	args: RestorePinnedArgs,
) {
	return await fixture.t.run(
		async (ctx) => await restorePinnedBlogRevisions(ctx, args),
	);
}

function paragraph(key: string, text: string) {
	return {
		type: "paragraph" as const,
		key,
		children: [{ type: "text" as const, key: `${key}-text`, text, marks: [] }],
	};
}

function authorDraft(
	name: string,
	slug: string,
	assetId: Id<"mediaAssets">,
) {
	return {
		kind: "author" as const,
		name,
		slug,
		bio: { version: 1 as const, blocks: [paragraph("bio", `${name} biography.`)] },
		portrait: {
			key: "portrait",
			assetId,
			altText: `${name} portrait`,
			framing: PORTRAIT_FRAMING,
		},
	};
}

function categoryDraft(title: string, slug: string) {
	return { kind: "category" as const, title, slug };
}

function postDraft(args: {
	title: string;
	slug: string;
	authorDocumentId: Id<"contentDocuments">;
	categoryDocumentId: Id<"contentDocuments">;
	assetId: Id<"mediaAssets">;
}): PostDraft {
	return {
		kind: "post",
		title: args.title,
		slug: args.slug,
		format: "essay",
		presentation: "standard",
		displayPublishedAt: 1_000,
		summary: `${args.title} summary.`,
		equipment: [],
		materials: [],
		authorDocumentId: args.authorDocumentId,
		categories: [{ key: "category", documentId: args.categoryDocumentId }],
		mainImage: {
			key: "main",
			assetId: args.assetId,
			altText: `${args.title} main image`,
		},
		body: {
			version: 1,
			blocks: [
				paragraph("opening", `${args.title} opening paragraph.`),
				{
					type: "image",
					key: "body-image",
					assetId: args.assetId,
					altText: `${args.title} body image`,
				},
			],
		},
	};
}

async function createSupporting(
	admin: Admin,
	args: {
		siteUrl: string;
		documentKey: string;
		draft: ReturnType<typeof authorDraft> | ReturnType<typeof categoryDraft>;
		publish?: boolean;
	},
) {
	const created = await admin.mutation(api.blogContent.createDraft, {
		siteUrl: args.siteUrl,
		documentKey: args.documentKey,
		draft: args.draft,
	});
	if (args.publish !== false) {
		await admin.mutation(api.blogContent.publish, {
			documentId: created.documentId,
			draftRevisionId: created.revisionId,
		});
	}
	return created;
}

async function saveAndPublishSupporting(
	admin: Admin,
	documentId: Id<"contentDocuments">,
	draft: ReturnType<typeof authorDraft> | ReturnType<typeof categoryDraft>,
) {
	const saved = await admin.mutation(api.blogContent.saveDraft, {
		documentId,
		draft,
	});
	await admin.mutation(api.blogContent.publish, {
		documentId,
		draftRevisionId: saved.revisionId,
	});
	return saved;
}

async function savePrivateSupportingDraft(
	admin: Admin,
	documentId: Id<"contentDocuments">,
	draft: ReturnType<typeof authorDraft> | ReturnType<typeof categoryDraft>,
	expectedDraftRevisionId?: Id<"contentRevisions">,
) {
	return await admin.mutation(api.blogContent.saveDraft, {
		documentId,
		draft,
		...(expectedDraftRevisionId ? { expectedDraftRevisionId } : {}),
	});
}

async function createPost(
	admin: Admin,
	siteUrl: string,
	documentKey: string,
	draft: PostDraft,
) {
	return await admin.mutation(api.postContent.createDraft, {
		siteUrl,
		documentKey,
		draft,
	});
}

async function savePost(
	admin: Admin,
	documentId: Id<"contentDocuments">,
	draft: PostDraft,
	expectedDraftRevisionId?: Id<"contentRevisions">,
) {
	return await admin.mutation(api.postContent.saveDraft, {
		documentId,
		...(expectedDraftRevisionId ? { expectedDraftRevisionId } : {}),
		draft,
	});
}

async function publishPost(
	admin: Admin,
	documentId: Id<"contentDocuments">,
	draftRevisionId: Id<"contentRevisions">,
) {
	return await admin.mutation(api.postContent.publish, {
		documentId,
		draftRevisionId,
	});
}

async function readDocument(
	fixture: Fixture,
	documentId: Id<"contentDocuments">,
) {
	const document = await fixture.t.run(
		async (ctx) => await ctx.db.get(documentId),
	);
	if (!document) throw new Error("Content document fixture is missing");
	return document;
}

async function restoreEntry(
	fixture: Fixture,
	documentId: Id<"contentDocuments">,
	sourceRevisionId: Id<"contentRevisions">,
): Promise<BlogPinnedRestoreEntry> {
	const document = await readDocument(fixture, documentId);
	if (
		!document.slug
		|| !document.publishedRevisionId
		|| document.publishedAt === undefined
		|| !document.publishedBy
	) throw new Error("Published content fixture is incomplete");
	return {
		documentId,
		sourceRevisionId,
		expected: {
			slug: document.slug,
			draftRevisionId: document.draftRevisionId ?? null,
			published: {
				revisionId: document.publishedRevisionId,
				at: document.publishedAt,
				by: document.publishedBy,
			},
			archived: document.archivedAt === undefined
				? null
				: {
					at: document.archivedAt,
					by: document.archivedBy ?? "missing-archive-actor",
				},
			updated: { at: document.updatedAt, by: document.updatedBy },
		},
	};
}

async function revisionCount(fixture: Fixture) {
	return await fixture.t.run(
		async (ctx) => (await ctx.db.query("contentRevisions").take(500)).length,
	);
}

async function restoreRows(fixture: Fixture, operationId: string) {
	return await fixture.t.run(
		async (ctx) =>
			await ctx.db
				.query("contentRevisions")
				.withIndex("by_siteUrl_and_restoreOperationId", (q) =>
					q
						.eq("siteUrl", SITE_A.siteUrl)
						.eq("restoreOperationId", operationId),
				)
				.take(13),
	);
}

async function buildPublishedModule(fixture: Fixture) {
	const authorV1 = await createSupporting(fixture.adminA, {
		siteUrl: SITE_A.siteUrl,
		documentKey: "author-primary",
		draft: authorDraft("Original Author", "primary-author", fixture.assetA.id),
	});
	const categoryV1 = await createSupporting(fixture.adminA, {
		siteUrl: SITE_A.siteUrl,
		documentKey: "category-journal",
		draft: categoryDraft("Original Journal", "journal"),
	});
	const postV1 = await createPost(
		fixture.adminA,
		SITE_A.siteUrl,
		"post-field-note",
		postDraft({
			title: "Original Field Note",
			slug: "field-note",
			authorDocumentId: authorV1.documentId,
			categoryDocumentId: categoryV1.documentId,
			assetId: fixture.assetA.id,
		}),
	);
	await publishPost(fixture.adminA, postV1.documentId, postV1.revisionId);

	await saveAndPublishSupporting(
		fixture.adminA,
		authorV1.documentId,
		authorDraft("Current Author", "primary-author", fixture.assetA.id),
	);
	await saveAndPublishSupporting(
		fixture.adminA,
		categoryV1.documentId,
		categoryDraft("Current Journal", "journal"),
	);
	const postV2 = await savePost(
		fixture.adminA,
		postV1.documentId,
		postDraft({
			title: "Current Field Note",
			slug: "field-note",
			authorDocumentId: authorV1.documentId,
			categoryDocumentId: categoryV1.documentId,
			assetId: fixture.assetA.id,
		}),
	);
	await publishPost(fixture.adminA, postV1.documentId, postV2.revisionId);

	const authorDraftRevision = await savePrivateSupportingDraft(
		fixture.adminA,
		authorV1.documentId,
		authorDraft("Private Author Draft", "primary-author", fixture.assetA.id),
	);
	const categoryDraftRevision = await savePrivateSupportingDraft(
		fixture.adminA,
		categoryV1.documentId,
		categoryDraft("Private Category Draft", "journal"),
	);
	const postDraftRevision = await savePost(
		fixture.adminA,
		postV1.documentId,
		postDraft({
			title: "Private Post Draft",
			slug: "field-note",
			authorDocumentId: authorV1.documentId,
			categoryDocumentId: categoryV1.documentId,
			assetId: fixture.assetA.id,
		}),
	);
	return {
		author: authorV1,
		category: categoryV1,
		post: postV1,
		privateDrafts: [
			authorDraftRevision.revisionId,
			categoryDraftRevision.revisionId,
			postDraftRevision.revisionId,
		],
	};
}

async function moduleEntries(
	fixture: Fixture,
	module: Awaited<ReturnType<typeof buildPublishedModule>>,
) {
	return await Promise.all([
		restoreEntry(fixture, module.author.documentId, module.author.revisionId),
		restoreEntry(
			fixture,
			module.category.documentId,
			module.category.revisionId,
		),
		restoreEntry(fixture, module.post.documentId, module.post.revisionId),
	]);
}

describe("Blog pinned revision restore", () => {
	test("keeps the deployed operator wrapper disabled before storage access", async () => {
		const t = convexTest(schema, modules);
		await expect(
			t.mutation(internal.blogContent.restorePinnedPublishedRevisions, {
				siteUrl: "unregistered.example",
				operationId: "dormant-restore",
				entries: [],
			}),
		).rejects.toThrow(/capability is disabled/i);
		expect(
			await t.run(async (ctx) => await ctx.db.query("contentRevisions").take(1)),
		).toEqual([]);
	});

	test("requires complete restore provenance and rejects it on ordinary revisions", () => {
		const sourceRevisionId = "source-revision" as Id<"contentRevisions">;
		expect(contentRevisionProvenanceFields({ source: "admin" })).toEqual({});
		expect(() =>
			contentRevisionProvenanceFields({
				source: "sanityImport",
				restoredFromRevisionId: sourceRevisionId,
			}),
		).toThrow(/cannot carry restore provenance/i);
		expect(() =>
			contentRevisionProvenanceFields({ source: "restore" }),
		).toThrow(/complete valid provenance/i);
		expect(() =>
			contentRevisionProvenanceFields({
				source: "restore",
				restoredFromRevisionId: sourceRevisionId,
				restoreOperationId: "restore-v1",
				restoreRequestDigest: "not-a-digest",
			}),
		).toThrow(/complete valid provenance/i);
		expect(
			contentRevisionProvenanceFields({
				source: "restore",
				restoredFromRevisionId: sourceRevisionId,
				restoreOperationId: "restore-v1",
				restoreRequestDigest: "a".repeat(64),
			}),
		).toEqual({
			restoredFromRevisionId: sourceRevisionId,
			restoreOperationId: "restore-v1",
			restoreRequestDigest: "a".repeat(64),
		});
	});

	test("uses internal operator authority and rejects a cross-tenant site pin", async () => {
		const fixture = await setup();
		const module = await buildPublishedModule(fixture);
		const entries = await moduleEntries(fixture, module);
		await expect(
			runPinnedRestore(fixture, {
				siteUrl: SITE_A.siteUrl,
				operationId: "operator-restore",
				entries,
			}),
		).resolves.toMatchObject({ operationId: "operator-restore" });

		const crossTenant = await setup();
		const crossTenantModule = await buildPublishedModule(crossTenant);
		const crossTenantEntries = await moduleEntries(
			crossTenant,
			crossTenantModule,
		);
		await expect(
			runPinnedRestore(crossTenant, {
				siteUrl: SITE_B.siteUrl,
				operationId: "cross-tenant-restore",
				entries: crossTenantEntries,
			}),
		).rejects.toThrow(/pinned site/i);
		expect(await restoreRows(fixture, "operator-restore")).toHaveLength(3);
		expect(await restoreRows(crossTenant, "cross-tenant-restore")).toEqual([]);
	});

	test("rejects subset and extra-document manifests before restoring", async () => {
		const fixture = await setup();
		const module = await buildPublishedModule(fixture);
		const entries = await moduleEntries(fixture, module);
		const before = await revisionCount(fixture);
		await expect(
			runPinnedRestore(fixture, {
				siteUrl: SITE_A.siteUrl,
				operationId: "subset-manifest",
				entries: entries.slice(0, 2),
			}),
		).rejects.toThrow(/complete published module/i);

		const extra = await createSupporting(fixture.adminA, {
			siteUrl: SITE_A.siteUrl,
			documentKey: "category-private-extra",
			draft: categoryDraft("Private Extra", "private-extra"),
			publish: false,
		});
		const extraDocument = await readDocument(fixture, extra.documentId);
		if (!extraDocument.slug) throw new Error("Extra document slug is missing");
		const extraEntry: BlogPinnedRestoreEntry = {
			documentId: extra.documentId,
			sourceRevisionId: extra.revisionId,
			expected: {
				slug: extraDocument.slug,
				draftRevisionId: extraDocument.draftRevisionId ?? null,
				published: {
					revisionId: extra.revisionId,
					at: extraDocument.updatedAt,
					by: extraDocument.updatedBy,
				},
				archived: null,
				updated: {
					at: extraDocument.updatedAt,
					by: extraDocument.updatedBy,
				},
			},
		};
		await expect(
			runPinnedRestore(fixture, {
				siteUrl: SITE_A.siteUrl,
				operationId: "extra-document-manifest",
				entries: [...entries, extraEntry],
			}),
		).rejects.toThrow(/complete published module/i);
		expect(await revisionCount(fixture)).toBe(before + 1);
		expect(await restoreRows(fixture, "subset-manifest")).toEqual([]);
		expect(await restoreRows(fixture, "extra-document-manifest")).toEqual([]);
	});

	test("rejects duplicate future slugs across one atomic restore", async () => {
		const fixture = await setup();
		const module = await buildPublishedModule(fixture);
		const categoryTwo = await createSupporting(fixture.adminA, {
			siteUrl: SITE_A.siteUrl,
			documentKey: "category-second",
			draft: categoryDraft("Second Category", "second-category"),
		});
		const categoryOneSource = await savePrivateSupportingDraft(
			fixture.adminA,
			module.category.documentId,
			categoryDraft("Shared One", "shared-future-slug"),
			module.privateDrafts[1],
		);
		const categoryTwoSource = await savePrivateSupportingDraft(
			fixture.adminA,
			categoryTwo.documentId,
			categoryDraft("Shared Two", "shared-future-slug"),
		);
		const entries = await Promise.all([
			restoreEntry(fixture, module.author.documentId, module.author.revisionId),
			restoreEntry(fixture, module.category.documentId, categoryOneSource.revisionId),
			restoreEntry(fixture, categoryTwo.documentId, categoryTwoSource.revisionId),
			restoreEntry(fixture, module.post.documentId, module.post.revisionId),
		]);
		const before = await revisionCount(fixture);

		await expect(
			runPinnedRestore(fixture, {
				siteUrl: SITE_A.siteUrl,
				operationId: "duplicate-future-slugs",
				entries,
			}),
		).rejects.toThrow(/final slugs must be unique/i);
		expect(await revisionCount(fixture)).toBe(before);
		expect(await restoreRows(fixture, "duplicate-future-slugs")).toEqual([]);
	});

	test("rejects a source revision owned by another document", async () => {
		const fixture = await setup();
		const module = await buildPublishedModule(fixture);
		const entries = await moduleEntries(fixture, module);
		entries[0] = {
			...entries[0]!,
			sourceRevisionId: module.category.revisionId,
		};
		const before = await revisionCount(fixture);
		await expect(
			runPinnedRestore(fixture, {
				siteUrl: SITE_A.siteUrl,
				operationId: "cross-document-source",
				entries,
			}),
		).rejects.toThrow(/ownership mismatch/i);
		expect(await revisionCount(fixture)).toBe(before);
	});

	test("binds the exact slug, draft, publication, archive, and update state", async () => {
		const fixture = await setup();
		const module = await buildPublishedModule(fixture);
		const entries = await moduleEntries(fixture, module);
		const base = entries[0]!;
		const staleEntries: BlogPinnedRestoreEntry[] = [
			{ ...base, expected: { ...base.expected, slug: "stale-slug" } },
			{
				...base,
				expected: { ...base.expected, draftRevisionId: base.sourceRevisionId },
			},
			{
				...base,
				expected: {
					...base.expected,
					published: {
						...base.expected.published,
						at: base.expected.published.at + 1,
					},
				},
			},
			{
				...base,
				expected: {
					...base.expected,
					archived: { at: base.expected.updated.at, by: "stale-actor" },
				},
			},
			{
				...base,
				expected: {
					...base.expected,
					updated: { ...base.expected.updated, by: "stale-actor" },
				},
			},
		];
		const before = await revisionCount(fixture);
		for (const [index, entry] of staleEntries.entries()) {
			const staleManifest = [...entries];
			staleManifest[0] = entry;
			await expect(
				runPinnedRestore(fixture, {
					siteUrl: SITE_A.siteUrl,
					operationId: `stale-cas-${index}`,
					entries: staleManifest,
				}),
			).rejects.toThrow(/pinned restore conflict/i);
		}
		expect(await revisionCount(fixture)).toBe(before);
	});

	test("rejects a manifest that is not closed over source Post relationships", async () => {
		const fixture = await setup();
		const module = await buildPublishedModule(fixture);
		const unpublishedCategory = await createSupporting(fixture.adminA, {
			siteUrl: SITE_A.siteUrl,
			documentKey: "category-unpublished",
			draft: categoryDraft("Unpublished", "unpublished"),
			publish: false,
		});
		const badSource = await savePost(
			fixture.adminA,
			module.post.documentId,
			postDraft({
				title: "Bad Historical Relationship",
				slug: "field-note",
				authorDocumentId: module.author.documentId,
				categoryDocumentId: unpublishedCategory.documentId,
				assetId: fixture.assetA.id,
			}),
			module.privateDrafts[2],
		);
		const post = await readDocument(fixture, module.post.documentId);
		if (!post.draftRevisionId) throw new Error("Bad source draft is missing");
		await fixture.adminA.mutation(api.postContent.discardDraft, {
			documentId: post._id,
			draftRevisionId: post.draftRevisionId,
		});
		const entries = await moduleEntries(fixture, module);
		entries[2] = { ...entries[2]!, sourceRevisionId: badSource.revisionId };
		const authorBefore = await readDocument(fixture, module.author.documentId);
		const before = await revisionCount(fixture);
		await expect(
			runPinnedRestore(fixture, {
				siteUrl: SITE_A.siteUrl,
				operationId: "bad-relationship-atomic",
				entries,
			}),
		).rejects.toThrow(/not closed over Post relationships/i);
		expect(await readDocument(fixture, module.author.documentId)).toEqual(
			authorBefore,
		);
		expect(await revisionCount(fixture)).toBe(before);
		expect(await restoreRows(fixture, "bad-relationship-atomic")).toEqual([]);
	});

	test("atomically clones a complete pinned module and makes only its exact replay idempotent", async () => {
		const fixture = await setup();
		const module = await buildPublishedModule(fixture);
		const entries = await moduleEntries(fixture, module);
		const sourceRows = await fixture.t.run(async (ctx) =>
			await Promise.all(
				entries.map(({ sourceRevisionId }) => ctx.db.get(sourceRevisionId)),
			),
		);
		const before = await revisionCount(fixture);
		const args = {
			siteUrl: SITE_A.siteUrl,
			operationId: "restore-module-v1",
			entries,
		};
		const restored = await runPinnedRestore(fixture, args);
		expect(restored.documents).toHaveLength(3);
		expect(new Set(restored.documents.map(({ restoredRevisionId }) => restoredRevisionId)).size).toBe(3);
		for (const [index, result] of restored.documents.entries()) {
			expect(result.restoredRevisionId).not.toBe(result.sourceRevisionId);
			const document = await readDocument(fixture, result.documentId);
			expect(document.draftRevisionId).toBeUndefined();
			expect(document).toMatchObject({
				publishedRevisionId: result.restoredRevisionId,
				publishedAt: restored.restoredAt,
				publishedBy: "operator:blog-pinned-restore",
				updatedAt: restored.restoredAt,
				updatedBy: "operator:blog-pinned-restore",
			});
			const row = await fixture.t.run(
				async (ctx) => await ctx.db.get(result.restoredRevisionId),
			);
			expect(row).toMatchObject({
				source: "restore",
				restoredFromRevisionId: result.sourceRevisionId,
				restoreOperationId: args.operationId,
				createdAt: restored.restoredAt,
				createdBy: "operator:blog-pinned-restore",
			});
			expect(row?.restoreRequestDigest).toMatch(/^[a-f0-9]{64}$/);
			expect(row?.payload).toEqual(sourceRows[index]?.payload);
			expect(
				await fixture.t.run(
					async (ctx) => await ctx.db.get(entries[index]?.sourceRevisionId),
				),
			).toEqual(sourceRows[index]);
		}
		expect(await revisionCount(fixture)).toBe(before + 3);
		expect(
			await fixture.t.query(api.postContent.getPublishedBySlug, {
				siteUrl: SITE_A.siteUrl,
				slug: "field-note",
			}),
		).toMatchObject({ payload: { title: "Original Field Note" } });
		expect(
			await fixture.t.query(api.blogContent.getPublishedBySlug, {
				siteUrl: SITE_A.siteUrl,
				kind: "author",
				slug: "primary-author",
			}),
		).toMatchObject({
			payload: {
				name: "Original Author",
				portrait: { framing: PORTRAIT_FRAMING },
			},
		});

		const replay = await runPinnedRestore(fixture, args);
		expect(replay).toEqual(restored);
		expect(await revisionCount(fixture)).toBe(before + 3);

		const changedRequest = structuredClone(entries);
		changedRequest[0]!.expected.updated.by = "not-the-original-request";
		await expect(
			runPinnedRestore(fixture, {
				siteUrl: SITE_A.siteUrl,
				operationId: args.operationId,
				entries: changedRequest,
			}),
		).rejects.toThrow(/pinned restore conflict/i);
		expect(await revisionCount(fixture)).toBe(before + 3);
	});

	test("rejects replay when the fixed restore actor drifts consistently", async () => {
		const fixture = await setup();
		const module = await buildPublishedModule(fixture);
		const entries = await moduleEntries(fixture, module);
		const args = {
			siteUrl: SITE_A.siteUrl,
			operationId: "restore-actor-drift",
			entries,
		};
		const restored = await runPinnedRestore(fixture, args);
		const first = restored.documents[0];
		await fixture.t.run(async (ctx) => {
			await ctx.db.patch(first.restoredRevisionId, { createdBy: "forged-restore-actor" });
			await ctx.db.patch(first.documentId, {
				publishedBy: "forged-restore-actor",
				updatedBy: "forged-restore-actor",
			});
		});

		await expect(
			runPinnedRestore(fixture, args),
		).rejects.toThrow(/pinned restore conflict/i);
	});
});
