/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { BlogSupportingDraft } from "./helpers/blogContentValidators";
import type { PostDraft } from "./helpers/postContentValidators";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const SITE = { siteUrl: "site.example", email: "admin@example.com" };

async function setup() {
	const t = convexTest(schema, modules);
	await t.mutation(internal.platform.seedClient, {
		name: SITE.siteUrl,
		email: SITE.email,
		siteUrl: SITE.siteUrl,
		tier: "full",
		subscriptionStatus: "active",
		adminEmails: [SITE.email],
		role: "client",
	});
	return {
		t,
		admin: t.withIdentity({ subject: SITE.email, email: SITE.email }),
	};
}

type Admin = Awaited<ReturnType<typeof setup>>["admin"];

function author(slug: string): BlogSupportingDraft {
	return {
		kind: "author",
		name: `Author ${slug}`,
		slug,
		bio: {
			version: 1,
			blocks: [{
				type: "paragraph",
				key: "bio",
				children: [{
					type: "text",
					key: "bio-text",
					text: "Writes about image making.",
					marks: [],
				}],
			}],
		},
	};
}

function category(slug: string): BlogSupportingDraft {
	return { kind: "category", title: `Category ${slug}`, slug };
}

function postDraft(
	authorDocumentId: Id<"contentDocuments">,
	slug: string,
	categoryDocumentId?: Id<"contentDocuments">,
): PostDraft {
	return {
		kind: "post",
		title: `Post ${slug}`,
		slug,
		format: "essay",
		presentation: "standard",
		displayPublishedAt: 1_800_000_000_000,
		summary: `Summary for ${slug}.`,
		equipment: [],
		materials: [],
		authorDocumentId,
		categories: categoryDocumentId
			? [{ key: "category", documentId: categoryDocumentId }]
			: [],
		body: {
			version: 1,
			blocks: [{
				type: "paragraph",
				key: "body",
				children: [{
					type: "text",
					key: "body-text",
					text: "A complete public post body.",
					marks: [],
				}],
			}],
		},
	};
}

async function createSupporting(
	admin: Admin,
	documentKey: string,
	draft: BlogSupportingDraft,
) {
	return await admin.mutation(api.blogContent.createDraft, {
		siteUrl: SITE.siteUrl,
		documentKey,
		draft,
	});
}

async function publishSupporting(
	admin: Admin,
	documentId: Id<"contentDocuments">,
	draftRevisionId: Id<"contentRevisions">,
) {
	return await admin.mutation(api.blogContent.publish, {
		documentId,
		draftRevisionId,
	});
}

async function createPublishedAuthor(admin: Admin, slug: string) {
	const created = await createSupporting(admin, slug, author(slug));
	await publishSupporting(admin, created.documentId, created.revisionId);
	return created;
}

async function createPost(
	admin: Admin,
	documentKey: string,
	draft: PostDraft,
) {
	return await admin.mutation(api.postContent.createDraft, {
		siteUrl: SITE.siteUrl,
		documentKey,
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

async function expectError(operation: Promise<unknown>, message: RegExp) {
	await expect(operation).rejects.toThrow(message);
}

describe("content lifecycle", () => {
	test("archives and restores Posts without deleting their revision pointers", async () => {
		const { t, admin } = await setup();
		const authorDoc = await createPublishedAuthor(admin, "post-author");
		const post = await createPost(
			admin,
			"archivable-post",
			postDraft(authorDoc.documentId, "archivable-post"),
		);
		await publishPost(admin, post.documentId, post.revisionId);

		await admin.mutation(api.postContent.archive, { documentId: post.documentId });
		expect(
			await admin.query(api.postContent.listForEditor, { siteUrl: SITE.siteUrl }),
		).toEqual([]);
		expect(
			await t.query(api.postContent.getPublishedBySlug, {
				siteUrl: SITE.siteUrl,
				slug: "archivable-post",
			}),
		).toBeNull();
		const archived = await admin.query(api.postContent.getEditorState, {
			documentId: post.documentId,
		});
		expect(archived.archivedAt).not.toBeNull();
		expect(archived.published?.revisionId).toBe(post.revisionId);
		await expectError(
			admin.mutation(api.postContent.saveDraft, {
				documentId: post.documentId,
				draft: postDraft(authorDoc.documentId, "changed-while-archived"),
			}),
			/archived/i,
		);

		await admin.mutation(api.postContent.restore, { documentId: post.documentId });
		expect(
			await t.query(api.postContent.getPublishedBySlug, {
				siteUrl: SITE.siteUrl,
				slug: "archivable-post",
			}),
		).not.toBeNull();
		expect(
			await admin.query(api.postContent.listForEditor, { siteUrl: SITE.siteUrl }),
		).toHaveLength(1);
	});

	test("unpublishes Posts without hiding their editor identity", async () => {
		const { t, admin } = await setup();
		const authorDoc = await createPublishedAuthor(admin, "unpublish-author");
		const post = await createPost(
			admin,
			"unpublish-post",
			postDraft(authorDoc.documentId, "unpublish-post"),
		);
		await publishPost(admin, post.documentId, post.revisionId);
		await admin.mutation(api.postContent.unpublish, { documentId: post.documentId });

		expect(
			await t.query(api.postContent.getPublishedBySlug, {
				siteUrl: SITE.siteUrl,
				slug: "unpublish-post",
			}),
		).toBeNull();
		const editor = await admin.query(api.postContent.getEditorState, {
			documentId: post.documentId,
		});
		expect(editor.published).toBeNull();
		expect(editor.slug).toBe("unpublish-post");
		expect(
			await admin.query(api.postContent.listForEditor, { siteUrl: SITE.siteUrl }),
		).toHaveLength(1);
	});

	test("blocks supporting lifecycle changes while active Posts reference them", async () => {
		const { admin } = await setup();
		const authorDoc = await createPublishedAuthor(admin, "active-author");
		const categoryDoc = await createSupporting(
			admin,
			"active-category",
			category("active-category"),
		);
		await publishSupporting(admin, categoryDoc.documentId, categoryDoc.revisionId);
		const post = await createPost(
			admin,
			"active-reference-post",
			postDraft(authorDoc.documentId, "active-reference-post", categoryDoc.documentId),
		);
		await publishPost(admin, post.documentId, post.revisionId);

		await expectError(
			admin.mutation(api.blogContent.unpublish, {
				documentId: authorDoc.documentId,
			}),
			/referenced by active Post content/i,
		);
		await expectError(
			admin.mutation(api.blogContent.archive, {
				documentId: categoryDoc.documentId,
			}),
			/referenced by active Post content/i,
		);

		await admin.mutation(api.postContent.unpublish, { documentId: post.documentId });
		await expect(
			admin.mutation(api.blogContent.unpublish, {
				documentId: authorDoc.documentId,
			}),
		).resolves.toEqual({
			documentId: authorDoc.documentId,
			publishedRevisionId: null,
		});
		await expect(
			admin.mutation(api.blogContent.archive, {
				documentId: categoryDoc.documentId,
			}),
		).resolves.toMatchObject({ documentId: categoryDoc.documentId });
	});
});
