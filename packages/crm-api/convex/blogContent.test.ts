/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
	type AuthorDraft,
	type BlogImageFraming,
	type BlogSupportingDraft,
	serializeAuthorDraft,
	validateAuthorDraft,
} from "./helpers/blogContentValidators";

import { SITE_A, SITE_B, ASSET_A, setupWebMedia } from "../test/webMediaFixtures";

const modules = import.meta.glob("./**/*.ts");
const EXACT_PORTRAIT_FRAMING = {
	crop: {
		top: 0.010927888941589192,
		right: 0.003421030847283818,
		bottom: 0.3786675624501119,
		left: 0,
	},
	focus: {
		x: 0.4982894845763581,
		y: 0.3095374222911859,
		width: 0.9965789691527162,
		height: 0.527364342876655,
	},
} satisfies BlogImageFraming;

function category(title: string, slug: string) {
	return { kind: "category" as const, title, slug };
}

function author(
	name: string,
	slug: string,
	assetId?: Id<"mediaAssets">,
	framing?: BlogImageFraming,
) {
	return {
		kind: "author" as const,
		name,
		slug,
		bio: {
			version: 1 as const,
			blocks: [{
				type: "paragraph" as const,
				key: "bio-paragraph",
				children: [{
					type: "text" as const,
					key: "bio-text",
					text: `${name} writes about photography.`,
					marks: [],
				}],
			}],
		},
		...(assetId
			? {
				portrait: {
					key: "portrait-primary",
					assetId,
					altText: `${name} looking toward the camera`,
					caption: "Portrait made at the studio",
					...(framing === undefined ? {} : { framing }),
				},
			}
			: {}),
	};
}

function authorWithFraming(framing: unknown): AuthorDraft {
	return {
		kind: "author",
		name: "Framing Test",
		slug: "framing-test",
		portrait: {
			key: "portrait",
			assetId: "media-framing" as Id<"mediaAssets">,
			altText: "Framing test portrait",
			framing,
		},
	} as unknown as AuthorDraft;
}

async function expectError(operation: Promise<unknown>, message: RegExp) {
	await expect(operation).rejects.toThrow(message);
}

type Admin = Awaited<ReturnType<typeof setupWebMedia>>["adminA"];

async function create(
	admin: Admin,
	siteUrl: string,
	documentKey: string,
	draft: BlogSupportingDraft,
) {
	return await admin.mutation(api.blogContent.createDraft, { siteUrl, documentKey, draft });
}

async function save(
	admin: Admin,
	documentId: Id<"contentDocuments">,
	draft: BlogSupportingDraft,
	expectedDraftRevisionId?: Id<"contentRevisions">,
) {
	return await admin.mutation(api.blogContent.saveDraft, {
		documentId,
		...(expectedDraftRevisionId ? { expectedDraftRevisionId } : {}),
		draft,
	});
}

async function publish(
	admin: Admin,
	documentId: Id<"contentDocuments">,
	draftRevisionId: Id<"contentRevisions">,
) {
	return await admin.mutation(api.blogContent.publish, { documentId, draftRevisionId });
}

describe("Author portrait framing contract", () => {
	test("preserves the legacy serialization bytes when framing is absent", () => {
		const legacy: AuthorDraft = {
			kind: "author",
			name: "Legacy Author",
			slug: "legacy-author",
			portrait: {
				key: "portrait",
				assetId: "media-legacy" as Id<"mediaAssets">,
				altText: "Legacy portrait",
			},
		};

		expect(serializeAuthorDraft(legacy)).toBe(
			'{"kind":"author","name":"Legacy Author","slug":"legacy-author","bio":null,"portrait":{"key":"portrait","assetId":"media-legacy","altText":"Legacy portrait","caption":null}}',
		);
	});

	test("fails closed on malformed or lossy framing geometry", () => {
		expect(() =>
			validateAuthorDraft(authorWithFraming({ crop: null, focus: null })),
		).toThrow(/must contain crop or focus/i);
		expect(() =>
			validateAuthorDraft(authorWithFraming({
				crop: { top: 0, right: 0.5, bottom: 0, left: 0.5 },
				focus: null,
			})),
		).toThrow(/positive width and height/i);
		expect(() =>
			validateAuthorDraft(authorWithFraming({
				crop: null,
				focus: { x: 0.1, y: 0.5, width: 0.4, height: 0.5 },
			})),
		).toThrow(/inside the image/i);
		expect(() =>
			validateAuthorDraft(authorWithFraming({
				crop: { top: 0, right: 0, bottom: 0, left: 0.2 },
				focus: { x: 0.25, y: 0.5, width: 0.2, height: 0.5 },
			})),
		).toThrow(/inside the surviving crop/i);
		expect(() =>
			validateAuthorDraft(authorWithFraming({
				crop: null,
				focus: { ...EXACT_PORTRAIT_FRAMING.focus, provider: "sanity" },
			})),
		).toThrow(/unsupported field/i);
		expect(() =>
			validateAuthorDraft(authorWithFraming({ crop: EXACT_PORTRAIT_FRAMING.crop })),
		).toThrow(/missing required field.*focus/i);
	});
});

describe("tenant-scoped Blog supporting content", () => {
	test("requires authentication, tenant membership, and matching document kinds", async () => {
		const { t, adminA, adminB } = await setupWebMedia(modules);
		await expectError(
			t.mutation(api.blogContent.createDraft, {
				siteUrl: SITE_A.siteUrl,
				documentKey: "author-jules",
				draft: author("Jules", "jules"),
			}),
			/not authenticated/i,
		);

		const created = await create(adminA, SITE_A.siteUrl, "author-jules", author("Jules", "jules"));
		await expectError(
			adminB.query(api.blogContent.getEditorState, {
				documentId: created.documentId,
			}),
			/not authorized/i,
		);
		await expectError(
			adminA.query(api.blogContent.listForEditor, {
				siteUrl: SITE_B.siteUrl,
				kind: "author",
			}),
			/not authorized/i,
		);
		await expectError(
			save(adminA, created.documentId, category("Jules", "jules"), created.revisionId),
			/kind mismatch/i,
		);
	});

	test("assigns stable ranks and scopes keys and slugs by tenant and kind", async () => {
		const { adminA, adminB } = await setupWebMedia(modules);
		const first = await create(adminA, SITE_A.siteUrl, "shared-key", author("First Author", "shared-slug"));
		await create(adminA, SITE_A.siteUrl, "second-author", author("Second Author", "second-author"));
		await create(adminA, SITE_A.siteUrl, "shared-key", category("Shared Category", "shared-slug"));
		await create(adminB, SITE_B.siteUrl, "shared-key", author("Tenant B Author", "shared-slug"));

		const authors = await adminA.query(api.blogContent.listForEditor, {
			siteUrl: SITE_A.siteUrl,
			kind: "author",
		});
		const categories = await adminA.query(api.blogContent.listForEditor, {
			siteUrl: SITE_A.siteUrl,
			kind: "category",
		});
		expect(authors.map(({ documentKey, rank }) => [documentKey, rank])).toEqual([
			["shared-key", 0],
			["second-author", 1],
		]);
		expect(categories.map(({ documentKey, rank }) => [documentKey, rank])).toEqual([
			["shared-key", 0],
		]);
		await expectError(
			create(adminA, SITE_A.siteUrl, "shared-key", author("Changed", "changed")),
			/key already exists/i,
		);
		await expectError(
			create(adminA, SITE_A.siteUrl, "different-key", author("Duplicate Slug", "shared-slug")),
			/slug .* reserved/i,
		);
		expect(authors[0]?.documentId).toBe(first.documentId);
	});

	test("deduplicates create and save retries while rejecting stale changes", async () => {
		const { t, adminA } = await setupWebMedia(modules);
		const initial = category("Journal", "journal");
		const first = await create(adminA, SITE_A.siteUrl, "category-journal", initial);
		expect(await create(adminA, SITE_A.siteUrl, "category-journal", initial)).toEqual(first);
		expect(await save(adminA, first.documentId, initial, first.revisionId)).toEqual(first);

		const changedDraft = category("Field Journal", "journal");
		const changed = await save(adminA, first.documentId, changedDraft, first.revisionId);
		expect(await save(adminA, first.documentId, changedDraft, first.revisionId)).toEqual(changed);
		await expectError(
			save(adminA, first.documentId, category("Stale Writer", "journal"), first.revisionId),
			/conflict/i,
		);
		const revisionCount = await t.run(async (ctx) =>
			(
				await ctx.db
					.query("contentRevisions")
					.withIndex("by_documentId_and_createdAt", (q) =>
						q.eq("documentId", first.documentId),
					)
					.collect()
			).length,
		);
		expect(revisionCount).toBe(2);
	});

	test("accepts incomplete drafts but enforces publication requirements", async () => {
		const { adminA, assetA } = await setupWebMedia(modules);
		const incomplete = await create(adminA, SITE_A.siteUrl, "category-incomplete", {
			kind: "category",
		});
		await expectError(publish(adminA, incomplete.documentId, incomplete.revisionId), /title is required/i);

		const invalidSlug = await save(
			adminA,
			incomplete.documentId,
			category("News", "Not Canonical"),
			incomplete.revisionId,
		);
		await expectError(
			publish(adminA, incomplete.documentId, invalidSlug.revisionId),
			/normalized lowercase words/i,
		);

		const missingAlt = await create(
			adminA,
			SITE_A.siteUrl,
			"author-missing-alt",
			{
				kind: "author",
				name: "No Alt",
				slug: "no-alt",
				portrait: { key: "portrait", assetId: assetA.id },
			},
		);
		await expectError(
			publish(adminA, missingAlt.documentId, missingAlt.revisionId),
			/portrait alt text is required/i,
		);

		const paddedHref = (index: number) =>
			`${" ".repeat(1700)}https://example.com/${index}${" ".repeat(10)}`;
		await expectError(
			create(adminA, SITE_A.siteUrl, "author-oversized-bio", {
				kind: "author",
				name: "Oversized Bio",
				slug: "oversized-bio",
				bio: {
					version: 1,
					blocks: [{
						type: "paragraph",
						key: "links",
						children: Array.from({ length: 20 }, (_, index) => ({
							type: "text" as const,
							key: `span-${index}`,
							text: "link",
							marks: [{ type: "link" as const, key: `link-${index}`, href: paddedHref(index) }],
						})),
					}],
				},
			}),
			/32768 serialized bytes/i,
		);
	});

	test("makes exact publish retries harmless without overwriting newer drafts", async () => {
		const { adminA } = await setupWebMedia(modules);
		const created = await create(
			adminA,
			SITE_A.siteUrl,
			"category-stories",
			category("Stories", "stories"),
		);
		const published = await publish(adminA, created.documentId, created.revisionId);
		expect(await publish(adminA, created.documentId, created.revisionId)).toEqual(published);

		const newer = await save(adminA, created.documentId, category("New Stories", "stories"));
		await expectError(publish(adminA, created.documentId, created.revisionId), /conflict/i);
		expect(
			(await adminA.query(api.blogContent.getEditorState, {
				documentId: created.documentId,
			})).draft?.revisionId,
		).toBe(newer.revisionId);
		await expect(publish(adminA, created.documentId, newer.revisionId)).resolves.toEqual({
			documentId: created.documentId,
			revisionId: newer.revisionId,
		});
	});

	test("stores and publishes exact provider-neutral portrait framing", async () => {
		const { adminA, assetA } = await setupWebMedia(modules);
		const draft = author(
			"Exact Framing",
			"exact-framing",
			assetA.id,
			EXACT_PORTRAIT_FRAMING,
		);
		const created = await create(
			adminA,
			SITE_A.siteUrl,
			"author-exact-framing",
			draft,
		);
		const editor = await adminA.query(api.blogContent.getEditorState, {
			documentId: created.documentId,
		});
		expect(
			editor.draft?.draft.kind === "author"
				? editor.draft.draft.portrait?.framing
				: undefined,
		).toEqual(EXACT_PORTRAIT_FRAMING);

		await publish(adminA, created.documentId, created.revisionId);
		const published = await adminA.query(api.blogContent.getEditorState, {
			documentId: created.documentId,
		});
		expect(
			published.published?.draft.kind === "author"
				? published.published.draft.portrait?.framing
				: undefined,
		).toEqual(EXACT_PORTRAIT_FRAMING);
	});

	test("enforces portrait tenant, readiness, and active-reference lifecycle", async () => {
		const { t, adminA, assetA, assetB, assetC } = await setupWebMedia(modules);
		await expectError(
			create(adminA, SITE_A.siteUrl, "author-cross-tenant", author("Cross Tenant", "cross-tenant", assetB.id)),
			/ready media asset from the same site/i,
		);

		const draft = await create(
			adminA,
			SITE_A.siteUrl,
			"author-discarded",
			author("Discarded", "discarded", assetA.id),
		);
		await expectError(
			adminA.mutation(api.mediaAssets.requestDeletion, {
				siteUrl: SITE_A.siteUrl,
				id: assetA.id,
			}),
			/in use by Author content/i,
		);
		await adminA.mutation(api.blogContent.discardDraft, {
			documentId: draft.documentId,
			draftRevisionId: draft.revisionId,
		});
		expect(
			await adminA.mutation(api.mediaAssets.requestDeletion, {
				siteUrl: SITE_A.siteUrl,
				id: assetA.id,
			}),
		).toMatchObject({ status: "deleting" });
		await t.mutation(internal.mediaAssets.completeDeletion, {
			siteUrl: SITE_A.siteUrl,
			id: assetA.id,
			assetId: ASSET_A,
		});
		await expectError(
			create(adminA, SITE_A.siteUrl, "author-deleted-portrait", author("Deleted Portrait", "deleted-portrait", assetA.id)),
			/ready media asset from the same site/i,
		);

		const publishable = await create(
			adminA,
			SITE_A.siteUrl,
			"author-publishable",
			author("Publishable", "publishable", assetC.id),
		);
		await t.run(async (ctx) => {
			await ctx.db.patch(assetC.id, { status: "deleting" });
		});
		await expectError(
			publish(adminA, publishable.documentId, publishable.revisionId),
			/ready media asset from the same site/i,
		);
		await t.run(async (ctx) => {
			await ctx.db.patch(assetC.id, { status: "ready" });
		});
		await publish(adminA, publishable.documentId, publishable.revisionId);
		await expectError(
			adminA.mutation(api.mediaAssets.requestDeletion, {
				siteUrl: SITE_A.siteUrl,
				id: assetC.id,
			}),
			/in use by Author content/i,
		);
	});

	test("fails closed when revision pointers cross document ownership", async () => {
		const { t, adminA, adminB } = await setupWebMedia(modules);
		const local = await adminA.mutation(api.blogContent.createDraft, {
			siteUrl: SITE_A.siteUrl,
			documentKey: "category-local",
			draft: category("Local", "local"),
		});
		const foreign = await adminB.mutation(api.blogContent.createDraft, {
			siteUrl: SITE_B.siteUrl,
			documentKey: "category-foreign",
			draft: category("Foreign", "foreign"),
		});
		await t.run(async (ctx) => {
			await ctx.db.patch(local.documentId, {
				draftRevisionId: foreign.revisionId,
			});
		});
		await expect(
			adminA.query(api.blogContent.getEditorState, {
				documentId: local.documentId,
			}),
		).rejects.toThrow(/ownership mismatch/i);
	});
});
