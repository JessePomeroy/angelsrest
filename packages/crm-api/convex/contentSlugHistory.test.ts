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
const SITE_A = { siteUrl: "site-a.example", email: "admin-a@example.com" };
const SITE_B = { siteUrl: "site-b.example", email: "admin-b@example.com" };

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
	return {
		t,
		adminA: t.withIdentity({ subject: SITE_A.email, email: SITE_A.email }),
		adminB: t.withIdentity({ subject: SITE_B.email, email: SITE_B.email }),
	};
}

type Admin = Awaited<ReturnType<typeof setup>>["adminA"];
type PublishedSlugChange = { fromSlug: string; toSlug: string };

function author(name: string, slug: string): BlogSupportingDraft {
	return {
		kind: "author",
		name,
		slug,
		bio: {
			version: 1,
			blocks: [{
				type: "paragraph",
				key: "bio",
				children: [{
					type: "text",
					key: "bio-text",
					text: `${name} writes about photography.`,
					marks: [],
				}],
			}],
		},
	};
}

function category(title: string, slug: string): BlogSupportingDraft {
	return { kind: "category", title, slug };
}

function postDraft(
	authorDocumentId: Id<"contentDocuments">,
	slug: string,
): PostDraft {
	return {
		kind: "post",
		title: `Post ${slug}`,
		slug,
		format: "essay",
		presentation: "standard",
		displayPublishedAt: 1_800_000_000_000,
		summary: `A concise summary for ${slug}.`,
		equipment: [],
		materials: [],
		authorDocumentId,
		categories: [],
		body: {
			version: 1,
			blocks: [{
				type: "paragraph",
				key: "body",
				children: [{
					type: "text",
					key: "body-text",
					text: "A complete post body.",
					marks: [],
				}],
			}],
		},
	};
}

async function createSupporting(
	admin: Admin,
	siteUrl: string,
	documentKey: string,
	draft: BlogSupportingDraft,
) {
	return await admin.mutation(api.blogContent.createDraft, {
		siteUrl,
		documentKey,
		draft,
	});
}

async function saveSupporting(
	admin: Admin,
	documentId: Id<"contentDocuments">,
	draft: BlogSupportingDraft,
) {
	return await admin.mutation(api.blogContent.saveDraft, { documentId, draft });
}

async function publishSupporting(
	admin: Admin,
	documentId: Id<"contentDocuments">,
	draftRevisionId: Id<"contentRevisions">,
	publishedSlugChange?: PublishedSlugChange,
) {
	return await admin.mutation(api.blogContent.publish, {
		documentId,
		draftRevisionId,
		...(publishedSlugChange ? { publishedSlugChange } : {}),
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
) {
	return await admin.mutation(api.postContent.saveDraft, { documentId, draft });
}

async function publishPost(
	admin: Admin,
	documentId: Id<"contentDocuments">,
	draftRevisionId: Id<"contentRevisions">,
	publishedSlugChange?: PublishedSlugChange,
) {
	return await admin.mutation(api.postContent.publish, {
		documentId,
		draftRevisionId,
		...(publishedSlugChange ? { publishedSlugChange } : {}),
	});
}

async function expectError(operation: Promise<unknown>, message: RegExp) {
	await expect(operation).rejects.toThrow(message);
}

describe("content slug history", () => {
	test("retains supporting slugs and resolves every old slug to the current public slug", async () => {
		const { t, adminA, adminB } = await setup();
		const created = await createSupporting(
			adminA,
			SITE_A.siteUrl,
			"author-a",
			author("Author A", "author-a"),
		);
		await publishSupporting(adminA, created.documentId, created.revisionId);

		const second = await saveSupporting(
			adminA,
			created.documentId,
			author("Author B", "author-b"),
		);
		expect(
			(await adminA.query(api.blogContent.getEditorState, {
				documentId: created.documentId,
			})).slug,
		).toBe("author-a");
		await expectError(
			publishSupporting(adminA, created.documentId, second.revisionId),
			/exact current and proposed slug acknowledgement/i,
		);
		await expectError(
			publishSupporting(adminA, created.documentId, second.revisionId, {
				fromSlug: "author-a",
				toSlug: "wrong",
			}),
			/exact current and proposed slug acknowledgement/i,
		);
		await publishSupporting(adminA, created.documentId, second.revisionId, {
			fromSlug: "author-a",
			toSlug: "author-b",
		});

		const third = await saveSupporting(
			adminA,
			created.documentId,
			author("Author C", "author-c"),
		);
		await publishSupporting(adminA, created.documentId, third.revisionId, {
			fromSlug: "author-b",
			toSlug: "author-c",
		});
		for (const slug of ["author-a", "author-b"]) {
			expect(
				await t.query(api.blogContent.resolvePublishedSlug, {
					siteUrl: SITE_A.siteUrl,
					kind: "author",
					slug,
				}),
			).toEqual({ status: "redirect", kind: "author", slug: "author-c" });
		}
		expect(
			await t.query(api.blogContent.getPublishedBySlug, {
				siteUrl: SITE_A.siteUrl,
				kind: "author",
				slug: "author-a",
			}),
		).toBeNull();
		await expectError(
			createSupporting(
				adminA,
				SITE_A.siteUrl,
				"author-squatter",
				author("Squatter", "author-a"),
			),
			/slug .* reserved/i,
		);
		await createSupporting(
			adminA,
			SITE_A.siteUrl,
			"category-author-a",
			category("Author A", "author-a"),
		);
		await createSupporting(
			adminB,
			SITE_B.siteUrl,
			"author-a",
			author("Tenant B Author", "author-a"),
		);

		const reverted = await saveSupporting(
			adminA,
			created.documentId,
			author("Author A Again", "author-a"),
		);
		await publishSupporting(adminA, created.documentId, reverted.revisionId, {
			fromSlug: "author-c",
			toSlug: "author-a",
		});
		for (const slug of ["author-b", "author-c"]) {
			expect(
				await t.query(api.blogContent.resolvePublishedSlug, {
					siteUrl: SITE_A.siteUrl,
					kind: "author",
					slug,
				}),
			).toEqual({ status: "redirect", kind: "author", slug: "author-a" });
		}
	});

	test("requires explicit post URL changes and keeps publish retries idempotent", async () => {
		const { t, adminA } = await setup();
		const authorDoc = await createSupporting(
			adminA,
			SITE_A.siteUrl,
			"post-author",
			author("Post Author", "post-author"),
		);
		await publishSupporting(adminA, authorDoc.documentId, authorDoc.revisionId);
		const post = await createPost(
			adminA,
			SITE_A.siteUrl,
			"post-a",
			postDraft(authorDoc.documentId, "post-a"),
		);
		await expectError(
			publishPost(adminA, post.documentId, post.revisionId, {
				fromSlug: "post-a",
				toSlug: "post-a",
			}),
			/not applicable/i,
		);
		await publishPost(adminA, post.documentId, post.revisionId);

		const changed = await savePost(
			adminA,
			post.documentId,
			postDraft(authorDoc.documentId, "post-b"),
		);
		await expectError(
			publishPost(adminA, post.documentId, changed.revisionId),
			/exact current and proposed slug acknowledgement/i,
		);
		await publishPost(adminA, post.documentId, changed.revisionId, {
			fromSlug: "post-a",
			toSlug: "post-b",
		});
		await expect(
			publishPost(adminA, post.documentId, changed.revisionId, {
				fromSlug: "post-a",
				toSlug: "post-b",
			}),
		).resolves.toEqual({ documentId: post.documentId, revisionId: changed.revisionId });
		expect(
			await t.query(api.postContent.resolvePublishedSlug, {
				siteUrl: SITE_A.siteUrl,
				slug: "post-a",
			}),
		).toEqual({ status: "redirect", kind: "post", slug: "post-b" });
		expect(
			await t.run(async (ctx) =>
				(await ctx.db
					.query("contentSlugHistory")
					.withIndex("by_documentId_and_createdAt", (q) =>
						q.eq("documentId", post.documentId),
					)
					.collect()).map(({ slug }) => slug),
			),
		).toEqual(["post-a"]);
		await expectError(
			createPost(
				adminA,
				SITE_A.siteUrl,
				"post-squatter",
				postDraft(authorDoc.documentId, "post-a"),
			),
			/slug .* reserved/i,
		);
	});

	test("checks competing proposed post slugs at publication and discards without history", async () => {
		const { t, adminA } = await setup();
		const authorDoc = await createSupporting(
			adminA,
			SITE_A.siteUrl,
			"competing-author",
			author("Competing Author", "competing-author"),
		);
		await publishSupporting(adminA, authorDoc.documentId, authorDoc.revisionId);
		const first = await createPost(
			adminA,
			SITE_A.siteUrl,
			"first-post",
			postDraft(authorDoc.documentId, "first-live"),
		);
		const second = await createPost(
			adminA,
			SITE_A.siteUrl,
			"second-post",
			postDraft(authorDoc.documentId, "second-live"),
		);
		await publishPost(adminA, first.documentId, first.revisionId);
		await publishPost(adminA, second.documentId, second.revisionId);

		const firstProposal = await savePost(
			adminA,
			first.documentId,
			postDraft(authorDoc.documentId, "shared-proposal"),
		);
		const secondProposal = await savePost(
			adminA,
			second.documentId,
			postDraft(authorDoc.documentId, "shared-proposal"),
		);
		await adminA.mutation(api.postContent.discardDraft, {
			documentId: first.documentId,
			draftRevisionId: firstProposal.revisionId,
		});
		expect(
			await t.query(api.postContent.resolvePublishedSlug, {
				siteUrl: SITE_A.siteUrl,
				slug: "shared-proposal",
			}),
		).toBeNull();
		expect(
			await t.run(async (ctx) =>
				await ctx.db
					.query("contentSlugHistory")
					.withIndex("by_documentId_and_createdAt", (q) =>
						q.eq("documentId", first.documentId),
					)
					.collect(),
			),
		).toEqual([]);

		const retriedFirstProposal = await savePost(
			adminA,
			first.documentId,
			postDraft(authorDoc.documentId, "shared-proposal"),
		);
		await publishPost(
			adminA,
			first.documentId,
			retriedFirstProposal.revisionId,
			{ fromSlug: "first-live", toSlug: "shared-proposal" },
		);
		await expectError(
			publishPost(adminA, second.documentId, secondProposal.revisionId, {
				fromSlug: "second-live",
				toSlug: "shared-proposal",
			}),
			/slug .* reserved/i,
		);
		expect(
			(await adminA.query(api.postContent.getEditorState, {
				documentId: second.documentId,
			})).slug,
		).toBe("second-live");
	});
});
