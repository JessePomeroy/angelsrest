/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { PostDraft } from "./helpers/postContentValidators";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const SITE_A = { siteUrl: "site-a.example", email: "admin-a@example.com" };
const SITE_B = { siteUrl: "site-b.example", email: "admin-b@example.com" };
const ASSET_A = "123e4567-e89b-42d3-a456-426614174000";
const ASSET_B = "223e4567-e89b-42d3-a456-426614174001";
const ASSET_C = "323e4567-e89b-42d3-a456-426614174002";

function readyAsset(siteUrl: string, assetId: string, filename: string) {
	const prefix = `sites/${siteUrl}/web/${assetId}/`;
	return {
		assetId,
		originalFilename: filename,
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
	const [assetA, assetB, assetC] = await Promise.all([
		adminA.mutation(api.mediaAssets.registerReadyWebAsset, {
			siteUrl: SITE_A.siteUrl,
			asset: readyAsset(SITE_A.siteUrl, ASSET_A, "secret-original-a.jpg"),
		}),
		adminB.mutation(api.mediaAssets.registerReadyWebAsset, {
			siteUrl: SITE_B.siteUrl,
			asset: readyAsset(SITE_B.siteUrl, ASSET_B, "secret-original-b.jpg"),
		}),
		adminA.mutation(api.mediaAssets.registerReadyWebAsset, {
			siteUrl: SITE_A.siteUrl,
			asset: readyAsset(SITE_A.siteUrl, ASSET_C, "secret-original-c.jpg"),
		}),
	]);
	return { t, adminA, adminB, assetA, assetB, assetC };
}

type Setup = Awaited<ReturnType<typeof setup>>;
type Admin = Setup["adminA"];

function paragraph(key: string, text: string) {
	return {
		type: "paragraph" as const,
		key,
		children: [{ type: "text" as const, key: `${key}-text`, text, marks: [] }],
	};
}

function imageBlock(
	key: string,
	assetId: Id<"mediaAssets">,
	altText = `Image ${key}`,
) {
	return {
		type: "image" as const,
		key,
		assetId,
		altText,
	};
}

function emptyPost(overrides: Omit<Partial<PostDraft>, "kind"> = {}): PostDraft {
	return {
		kind: "post",
		equipment: [],
		materials: [],
		categories: [],
		body: { version: 1, blocks: [] },
		...overrides,
	};
}

function completePost(
	authorDocumentId: Id<"contentDocuments">,
	overrides: Omit<Partial<PostDraft>, "kind" | "authorDocumentId"> = {},
): PostDraft {
	return emptyPost({
		title: "A Field Note",
		slug: "a-field-note",
		format: "essay",
		presentation: "standard",
		displayPublishedAt: 1_000,
		summary: "A concise public summary.",
		authorDocumentId,
		body: { version: 1, blocks: [paragraph("opening", "First paragraph.")] },
		...overrides,
	});
}

async function createAuthor(
	admin: Admin,
	siteUrl: string,
	documentKey: string,
	slug: string,
	publish = true,
) {
	const created = await admin.mutation(api.blogContent.createDraft, {
		siteUrl,
		documentKey,
		draft: {
			kind: "author",
			name: `Author ${slug}`,
			slug,
			bio: { version: 1, blocks: [paragraph("bio", "An author biography.")] },
		},
	});
	if (publish) {
		await admin.mutation(api.blogContent.publish, {
			documentId: created.documentId,
			draftRevisionId: created.revisionId,
		});
	}
	return created;
}

async function createCategory(
	admin: Admin,
	siteUrl: string,
	documentKey: string,
	title: string,
	slug: string,
	publish = true,
) {
	const created = await admin.mutation(api.blogContent.createDraft, {
		siteUrl,
		documentKey,
		draft: { kind: "category", title, slug },
	});
	if (publish) {
		await admin.mutation(api.blogContent.publish, {
			documentId: created.documentId,
			draftRevisionId: created.revisionId,
		});
	}
	return created;
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

async function expectError(operation: Promise<unknown>, message: RegExp) {
	await expect(operation).rejects.toThrow(message);
}

describe("tenant-scoped Post content graphs", () => {
	test("requires authentication and keeps editor operations inside one tenant", async () => {
		const { t, adminA, adminB } = await setup();
		await expectError(
			t.mutation(api.postContent.createDraft, {
				siteUrl: SITE_A.siteUrl,
				documentKey: "unauthenticated",
				draft: emptyPost(),
			}),
			/not authenticated/i,
		);
		const local = await createPost(
			adminA,
			SITE_A.siteUrl,
			"local-post",
			emptyPost(),
		);
		await expectError(
			adminB.query(api.postContent.getEditorState, {
				documentId: local.documentId,
			}),
			/not authorized/i,
		);
		await expectError(
			adminA.query(api.postContent.listForEditor, {
				siteUrl: SITE_B.siteUrl,
			}),
			/not authorized/i,
		);
	});

	test("deduplicates exact create and save retries while rejecting stale changes", async () => {
		const { t, adminA } = await setup();
		const author = await createAuthor(
			adminA,
			SITE_A.siteUrl,
			"author-idempotency",
			"author-idempotency",
		);
		const initial = completePost(author.documentId);
		const created = await createPost(
			adminA,
			SITE_A.siteUrl,
			"post-idempotency",
			initial,
		);
		expect(
			await createPost(
				adminA,
				SITE_A.siteUrl,
				"post-idempotency",
				initial,
			),
		).toEqual(created);
		expect(
			await savePost(adminA, created.documentId, initial, created.revisionId),
		).toEqual(created);

		const changedDraft = completePost(author.documentId, {
			title: "A Changed Field Note",
		});
		const changed = await savePost(
			adminA,
			created.documentId,
			changedDraft,
			created.revisionId,
		);
		expect(
			await savePost(
				adminA,
				created.documentId,
				changedDraft,
				created.revisionId,
			),
		).toEqual(changed);
		await expectError(
			savePost(
				adminA,
				created.documentId,
				completePost(author.documentId, { title: "Stale change" }),
				created.revisionId,
			),
			/conflict/i,
		);
		const revisionCount = await t.run(async (ctx) =>
			(
				await ctx.db
					.query("contentRevisions")
					.withIndex("by_documentId_and_createdAt", (q) =>
						q.eq("documentId", created.documentId),
					)
					.collect()
			).length,
		);
		expect(revisionCount).toBe(2);
	});

	test("stores incomplete drafts but applies semantic gates only at publish", async () => {
		const { adminA } = await setup();
		const incomplete = await createPost(
			adminA,
			SITE_A.siteUrl,
			"incomplete-post",
			emptyPost(),
		);
		await expectError(
			publishPost(adminA, incomplete.documentId, incomplete.revisionId),
			/format is required/i,
		);

		const author = await createAuthor(
			adminA,
			SITE_A.siteUrl,
			"author-gates",
			"author-gates",
		);
		const project = await savePost(
			adminA,
			incomplete.documentId,
			completePost(author.documentId, {
				slug: "incomplete-post",
				format: "projectStory",
				presentation: "caseStudy",
			}),
			incomplete.revisionId,
		);
		await expectError(
			publishPost(adminA, incomplete.documentId, project.revisionId),
			/brief is required/i,
		);
	});

	test("supports the three registered formats and rejects incompatible presentations", async () => {
		const { adminA } = await setup();
		const author = await createAuthor(
			adminA,
			SITE_A.siteUrl,
			"author-formats",
			"author-formats",
		);
		const drafts: Array<[string, PostDraft]> = [
			[
				"essay",
				completePost(author.documentId, {
					slug: "essay",
					format: "essay",
					presentation: "behindTheScenes",
				}),
			],
			[
				"project-story",
				completePost(author.documentId, {
					slug: "project-story",
					format: "projectStory",
					presentation: "clientStory",
					brief: "The assignment.",
					approach: "The process.",
					outcome: "The result.",
				}),
			],
			[
				"technical-note",
				completePost(author.documentId, {
					slug: "technical-note",
					format: "technicalNote",
					presentation: "technical",
					equipment: [{ key: "camera", label: "Camera", details: "35mm" }],
				}),
			],
		];
		for (const [documentKey, draft] of drafts) {
			const created = await createPost(
				adminA,
				SITE_A.siteUrl,
				documentKey,
				draft,
			);
			await expect(
				publishPost(adminA, created.documentId, created.revisionId),
			).resolves.toMatchObject({ documentId: created.documentId });
		}

		const incompatible = await createPost(
			adminA,
			SITE_A.siteUrl,
			"incompatible-format",
			completePost(author.documentId, {
				slug: "incompatible-format",
				format: "essay",
				presentation: "caseStudy",
			}),
		);
		await expectError(
			publishPost(
				adminA,
				incompatible.documentId,
				incompatible.revisionId,
			),
			/presentation does not match/i,
		);

		const technicalWithCredits = await createPost(
			adminA,
			SITE_A.siteUrl,
			"technical-with-project-fields",
			completePost(author.documentId, {
				slug: "technical-with-project-fields",
				format: "technicalNote",
				presentation: "technical",
				credits: "A Project Story-only credit line.",
				equipment: [{ key: "camera", label: "Camera" }],
			}),
		);
		await expectError(
			publishPost(
				adminA,
				technicalWithCredits.documentId,
				technicalWithCredits.revisionId,
			),
			/Technical Notes cannot publish Project Story/i,
		);
	});

	test("reconstructs ordered body, media, and category rows exactly", async () => {
		const { t, adminA, assetA, assetC } = await setup();
		const author = await createAuthor(
			adminA,
			SITE_A.siteUrl,
			"author-ordered",
			"author-ordered",
		);
		const firstCategory = await createCategory(
			adminA,
			SITE_A.siteUrl,
			"category-first",
			"First Category",
			"first-category",
		);
		const secondCategory = await createCategory(
			adminA,
			SITE_A.siteUrl,
			"category-second",
			"Second Category",
			"second-category",
		);
		const draft = completePost(author.documentId, {
			slug: "ordered-graph",
			categories: [
				{ key: "second", documentId: secondCategory.documentId },
				{ key: "first", documentId: firstCategory.documentId },
			],
			mainImage: {
				key: "hero",
				assetId: assetC.id,
				altText: "A public hero",
			},
			body: {
				version: 1,
				blocks: [
					paragraph("opening", "Opening paragraph."),
					{
						type: "image",
						key: "inline-image",
						assetId: assetA.id,
						altText: "An inline photograph",
						caption: "Second in the sequence",
					},
					{
						type: "heading",
						key: "closing",
						level: 2,
						children: [
							{
								type: "text",
								key: "closing-text",
								text: "Closing",
								marks: [],
							},
						],
					},
				],
			},
		});
		const created = await createPost(
			adminA,
			SITE_A.siteUrl,
			"ordered-graph",
			draft,
		);
		const editor = await adminA.query(api.postContent.getEditorState, {
			documentId: created.documentId,
		});
		expect(editor.draft?.draft.body.blocks.map((block) => block.key)).toEqual([
			"opening",
			"inline-image",
			"closing",
		]);
		expect(editor.draft?.draft.categories.map(({ key }) => key)).toEqual([
			"second",
			"first",
		]);
		await publishPost(adminA, created.documentId, created.revisionId);
		const detail = await t.query(api.postContent.getPublishedBySlug, {
			siteUrl: SITE_A.siteUrl,
			slug: "ordered-graph",
		});
		expect(detail?.payload.body.blocks.map((block) => block.key)).toEqual([
			"opening",
			"inline-image",
			"closing",
		]);
		expect(detail?.payload.categories.map(({ slug }) => slug)).toEqual([
			"second-category",
			"first-category",
		]);
		expect(detail?.payload.mainImage?.asset.assetId).toBe(ASSET_C);
		const image = detail?.payload.body.blocks[1];
		expect(image?.type).toBe("image");
		if (image?.type === "image") expect(image.asset.assetId).toBe(ASSET_A);
	});

	test("requires same-tenant ready assets and published supporting records", async () => {
		const { t, adminA, assetA, assetB } = await setup();
		const author = await createAuthor(
			adminA,
			SITE_A.siteUrl,
			"author-unpublished",
			"author-unpublished",
			false,
		);
		const category = await createCategory(
			adminA,
			SITE_A.siteUrl,
			"category-unpublished",
			"Unpublished",
			"unpublished",
			false,
		);
		await expectError(
			createPost(
				adminA,
				SITE_A.siteUrl,
				"foreign-asset",
				completePost(author.documentId, {
					slug: "foreign-asset",
					mainImage: {
						key: "hero",
						assetId: assetB.id,
						altText: "Foreign",
					},
				}),
			),
			/ready media assets? from the same site/i,
		);
		await t.run(async (ctx) => {
			await ctx.db.patch(assetA.id, { status: "deleting" });
		});
		await expectError(
			createPost(
				adminA,
				SITE_A.siteUrl,
				"not-ready-asset",
				completePost(author.documentId, {
					slug: "not-ready-asset",
					mainImage: {
						key: "hero",
						assetId: assetA.id,
						altText: "Not ready",
					},
				}),
			),
			/ready media assets? from the same site/i,
		);
		await t.run(async (ctx) => {
			await ctx.db.patch(assetA.id, { status: "ready" });
		});

		const post = await createPost(
			adminA,
			SITE_A.siteUrl,
			"unpublished-relations",
			completePost(author.documentId, {
				slug: "unpublished-relations",
				categories: [{ key: "category", documentId: category.documentId }],
			}),
		);
		await expectError(
			publishPost(adminA, post.documentId, post.revisionId),
			/author references must be published/i,
		);
		await adminA.mutation(api.blogContent.publish, {
			documentId: author.documentId,
			draftRevisionId: author.revisionId,
		});
		await expectError(
			publishPost(adminA, post.documentId, post.revisionId),
			/category references must be published/i,
		);
		await adminA.mutation(api.blogContent.publish, {
			documentId: category.documentId,
			draftRevisionId: category.revisionId,
		});
		await expect(
			publishPost(adminA, post.documentId, post.revisionId),
		).resolves.toMatchObject({ documentId: post.documentId });
	});

	test("keeps drafts private and strips internal graph and media fields from public reads", async () => {
		const { t, adminA, assetA, assetC } = await setup();
		const author = await createAuthor(
			adminA,
			SITE_A.siteUrl,
			"author-public",
			"author-public",
		);
		const category = await createCategory(
			adminA,
			SITE_A.siteUrl,
			"category-public",
			"Public Category",
			"public-category",
		);
		const draft = completePost(author.documentId, {
			slug: "public-post",
			categories: [{ key: "public", documentId: category.documentId }],
			mainImage: {
				key: "hero",
				assetId: assetC.id,
				altText: "Hero image",
			},
			body: {
				version: 1,
				blocks: [
					paragraph("public-copy", "Published copy."),
					{
						type: "image",
						key: "public-image",
						assetId: assetA.id,
						altText: "Public image",
					},
				],
			},
		});
		const post = await createPost(
			adminA,
			SITE_A.siteUrl,
			"public-post",
			draft,
		);
		expect(
			await t.query(api.postContent.getPublishedBySlug, {
				siteUrl: SITE_A.siteUrl,
				slug: "public-post",
			}),
		).toBeNull();
		await publishPost(adminA, post.documentId, post.revisionId);
		await savePost(
			adminA,
			post.documentId,
			{ ...draft, title: "PRIVATE DRAFT TITLE" },
		);

		const detail = await t.query(api.postContent.getPublishedBySlug, {
			siteUrl: SITE_A.siteUrl,
			slug: "public-post",
		});
		const list = await t.query(api.postContent.listPublished, {
			siteUrl: SITE_A.siteUrl,
			limit: 10,
		});
		expect(detail?.payload.title).toBe("A Field Note");
		expect(list).toHaveLength(1);
		expect("body" in (list[0]?.payload ?? {})).toBe(false);
		const serialized = JSON.stringify({ detail, list });
		for (const forbidden of [
			post.documentId,
			author.documentId,
			category.documentId,
			assetA.id,
			assetC.id,
			"PRIVATE DRAFT TITLE",
			"secret-original-a.jpg",
			"secret-original-c.jpg",
			"master.webp",
			"createdBy",
			"updatedBy",
			"checksum",
		]) {
			expect(serialized).not.toContain(forbidden);
		}
	});

	test("treats invalid and missing slugs as absent and reserves immutable published slugs", async () => {
		const { t, adminA } = await setup();
		const author = await createAuthor(
			adminA,
			SITE_A.siteUrl,
			"author-slugs",
			"author-slugs",
		);
		expect(
			await t.query(api.postContent.getPublishedBySlug, {
				siteUrl: SITE_A.siteUrl,
				slug: " Not Canonical ",
			}),
		).toBeNull();
		expect(
			await t.query(api.postContent.getPublishedBySlug, {
				siteUrl: SITE_A.siteUrl,
				slug: "missing",
			}),
		).toBeNull();
		const first = await createPost(
			adminA,
			SITE_A.siteUrl,
			"first-slug",
			completePost(author.documentId, { slug: "reserved-slug" }),
		);
		await expectError(
			createPost(
				adminA,
				SITE_A.siteUrl,
				"second-slug",
				completePost(author.documentId, { slug: "reserved-slug" }),
			),
			/slug .* already exists/i,
		);
		await publishPost(adminA, first.documentId, first.revisionId);
		await expectError(
			savePost(
				adminA,
				first.documentId,
				completePost(author.documentId, { slug: "changed-slug" }),
			),
			/redirect support/i,
		);
	});

	test("makes exact publish retries harmless without overwriting a newer draft", async () => {
		const { adminA } = await setup();
		const author = await createAuthor(
			adminA,
			SITE_A.siteUrl,
			"author-retries",
			"author-retries",
		);
		const draft = completePost(author.documentId, { slug: "retry-post" });
		const post = await createPost(
			adminA,
			SITE_A.siteUrl,
			"retry-post",
			draft,
		);
		const published = await publishPost(
			adminA,
			post.documentId,
			post.revisionId,
		);
		expect(
			await publishPost(adminA, post.documentId, post.revisionId),
		).toEqual(published);
		const newer = await savePost(adminA, post.documentId, {
			...draft,
			title: "Newer private draft",
		});
		await expectError(
			publishPost(adminA, post.documentId, post.revisionId),
			/conflict/i,
		);
		expect(
			(
				await adminA.query(api.postContent.getEditorState, {
					documentId: post.documentId,
				})
			).draft?.revisionId,
		).toBe(newer.revisionId);
		await expect(
			publishPost(adminA, post.documentId, newer.revisionId),
		).resolves.toEqual({ documentId: post.documentId, revisionId: newer.revisionId });
	});

	test("fails closed on cross-owned revisions and missing, orphaned, or mismatched graph rows", async () => {
		const { t, adminA, adminB, assetA } = await setup();
		const authorA = await createAuthor(
			adminA,
			SITE_A.siteUrl,
			"author-corruption-a",
			"author-corruption-a",
		);
		const authorB = await createAuthor(
			adminB,
			SITE_B.siteUrl,
			"author-corruption-b",
			"author-corruption-b",
		);
		const local = await createPost(
			adminA,
			SITE_A.siteUrl,
			"cross-owned-local",
			completePost(authorA.documentId, { slug: "cross-owned-local" }),
		);
		const foreign = await createPost(
			adminB,
			SITE_B.siteUrl,
			"cross-owned-foreign",
			completePost(authorB.documentId, { slug: "cross-owned-foreign" }),
		);
		await t.run(async (ctx) => {
			await ctx.db.patch(local.documentId, { draftRevisionId: foreign.revisionId });
		});
		await expectError(
			adminA.query(api.postContent.getEditorState, {
				documentId: local.documentId,
			}),
			/ownership mismatch/i,
		);

		const missing = await createPost(
			adminA,
			SITE_A.siteUrl,
			"missing-row",
			completePost(authorA.documentId, { slug: "missing-row" }),
		);
		await t.run(async (ctx) => {
			const row = await ctx.db
				.query("contentBlocks")
				.withIndex("by_revisionId_and_order", (q) =>
					q.eq("revisionId", missing.revisionId),
				)
				.first();
			if (!row) throw new Error("Expected a body row");
			await ctx.db.delete(row._id);
		});
		await expectError(
			adminA.query(api.postContent.getEditorState, {
				documentId: missing.documentId,
			}),
			/(payload does not match its graph|summary checksum mismatch)/i,
		);

		const orphaned = await createPost(
			adminA,
			SITE_A.siteUrl,
			"orphaned-row",
			completePost(authorA.documentId, { slug: "orphaned-row" }),
		);
		await t.run(async (ctx) => {
			await ctx.db.insert("contentMediaPlacements", {
				siteUrl: SITE_A.siteUrl,
				documentId: orphaned.documentId,
				revisionId: orphaned.revisionId,
				assetId: assetA.id,
				placementKey: "orphan",
				role: "body",
				order: 0,
				altText: "Orphaned placement",
			});
		});
		await expectError(
			adminA.query(api.postContent.getEditorState, {
				documentId: orphaned.documentId,
			}),
			/orphan placement/i,
		);

		const mismatched = await createPost(
			adminA,
			SITE_A.siteUrl,
			"mismatched-count",
			completePost(authorA.documentId, { slug: "mismatched-count" }),
		);
		await t.run(async (ctx) => {
			const revision = await ctx.db.get(mismatched.revisionId);
			if (
				!revision
				|| !("kind" in revision.payload)
				|| revision.payload.kind !== "post"
			) throw new Error("Expected a Post revision");
			await ctx.db.patch(revision._id, {
				payload: {
					...revision.payload,
					bodyBlockCount: revision.payload.bodyBlockCount + 1,
				},
			});
		});
		await expectError(
			adminA.query(api.postContent.getEditorState, {
				documentId: mismatched.documentId,
			}),
			/(payload does not match its graph|summary checksum mismatch)/i,
		);
	});

	test("blocks active Post media deletion but releases discarded-only history", async () => {
		const { adminA, assetA, assetC } = await setup();
		const author = await createAuthor(
			adminA,
			SITE_A.siteUrl,
			"author-deletion",
			"author-deletion",
		);
		const draftOnly = await createPost(
			adminA,
			SITE_A.siteUrl,
			"draft-media",
			completePost(author.documentId, {
				slug: "draft-media",
				mainImage: {
					key: "hero",
					assetId: assetA.id,
					altText: "Draft hero",
				},
			}),
		);
		await expectError(
			adminA.mutation(api.mediaAssets.requestDeletion, { id: assetA.id }),
			/in use by Post content/i,
		);
		await adminA.mutation(api.postContent.discardDraft, {
			documentId: draftOnly.documentId,
			draftRevisionId: draftOnly.revisionId,
		});
		await expect(
			adminA.mutation(api.mediaAssets.requestDeletion, { id: assetA.id }),
		).resolves.toMatchObject({ status: "deleting" });

		const published = await createPost(
			adminA,
			SITE_A.siteUrl,
			"published-media",
			completePost(author.documentId, {
				slug: "published-media",
				mainImage: {
					key: "hero",
					assetId: assetC.id,
					altText: "Published hero",
				},
			}),
		);
		await publishPost(adminA, published.documentId, published.revisionId);
		await expectError(
			adminA.mutation(api.mediaAssets.requestDeletion, { id: assetC.id }),
			/in use by Post content/i,
		);
	});

	test("keeps supporting drafts private and resolves republished identities dynamically", async () => {
		const { adminA } = await setup();
		const author = await createAuthor(
			adminA,
			SITE_A.siteUrl,
			"author-dynamic",
			"author-dynamic",
		);
		const category = await createCategory(
			adminA,
			SITE_A.siteUrl,
			"category-dynamic",
			"Original category",
			"category-dynamic",
		);
		const post = await createPost(
			adminA,
			SITE_A.siteUrl,
			"dynamic-supporting-content",
			completePost(author.documentId, {
				slug: "dynamic-supporting-content",
				seoTitle: "An intentional search title",
				seoDescription: "An intentional search description.",
				categories: [{ key: "category", documentId: category.documentId }],
			}),
		);
		await publishPost(adminA, post.documentId, post.revisionId);

		const authorDraft = await adminA.mutation(api.blogContent.saveDraft, {
			documentId: author.documentId,
			draft: {
				kind: "author",
				name: "Updated author",
				slug: "author-dynamic",
			},
		});
		const categoryDraft = await adminA.mutation(api.blogContent.saveDraft, {
			documentId: category.documentId,
			draft: {
				kind: "category",
				title: "Updated category",
				slug: "category-dynamic",
			},
		});
		const beforeRepublish = await adminA.query(
			api.postContent.getPublishedBySlug,
			{ siteUrl: SITE_A.siteUrl, slug: "dynamic-supporting-content" },
		);
		expect(beforeRepublish).toMatchObject({
			revisionId: post.revisionId,
			payload: {
				seoTitle: "An intentional search title",
				seoDescription: "An intentional search description.",
				author: { name: "Author author-dynamic" },
				categories: [{ title: "Original category" }],
			},
		});

		await adminA.mutation(api.blogContent.publish, {
			documentId: author.documentId,
			draftRevisionId: authorDraft.revisionId,
		});
		await adminA.mutation(api.blogContent.publish, {
			documentId: category.documentId,
			draftRevisionId: categoryDraft.revisionId,
		});
		const afterRepublish = await adminA.query(
			api.postContent.getPublishedBySlug,
			{ siteUrl: SITE_A.siteUrl, slug: "dynamic-supporting-content" },
		);
		expect(afterRepublish).toMatchObject({
			revisionId: post.revisionId,
			payload: {
				author: { name: "Updated author" },
				categories: [{ title: "Updated category" }],
			},
		});
	});

	test("fails closed when compact public-summary or ordered-row integrity is corrupted", async () => {
		const summarySetup = await setup();
		const summaryAuthor = await createAuthor(
			summarySetup.adminA,
			SITE_A.siteUrl,
			"author-summary-integrity",
			"author-summary-integrity",
		);
		const summaryPost = await createPost(
			summarySetup.adminA,
			SITE_A.siteUrl,
			"summary-integrity",
			completePost(summaryAuthor.documentId, { slug: "summary-integrity" }),
		);
		await publishPost(
			summarySetup.adminA,
			summaryPost.documentId,
			summaryPost.revisionId,
		);
		await summarySetup.t.run(async (ctx) => {
			const revision = await ctx.db.get(summaryPost.revisionId);
			if (
				!revision
				|| !("kind" in revision.payload)
				|| revision.payload.kind !== "post"
			) {
				throw new Error("Expected a Post revision");
			}
			await ctx.db.patch(revision._id, {
				payload: { ...revision.payload, title: "Corrupted title" },
			});
		});
		await expectError(
			summarySetup.adminA.query(api.postContent.listPublished, {
				siteUrl: SITE_A.siteUrl,
				limit: 12,
			}),
			/summary checksum mismatch/i,
		);

		const orderSetup = await setup();
		const orderAuthor = await createAuthor(
			orderSetup.adminA,
			SITE_A.siteUrl,
			"author-row-integrity",
			"author-row-integrity",
		);
		const ordered = await createPost(
			orderSetup.adminA,
			SITE_A.siteUrl,
			"row-integrity",
			completePost(orderAuthor.documentId, {
				slug: "row-integrity",
				body: {
					version: 1,
					blocks: [
						imageBlock("first", orderSetup.assetA.id),
						imageBlock("second", orderSetup.assetC.id),
					],
				},
			}),
		);
		await publishPost(orderSetup.adminA, ordered.documentId, ordered.revisionId);
		let authorReferenceId: Id<"contentReferences"> | undefined;
		await orderSetup.t.run(async (ctx) => {
			const authorReference = await ctx.db
				.query("contentReferences")
				.withIndex("by_fromRevisionId_and_field_and_order", (q) =>
					q.eq("fromRevisionId", ordered.revisionId).eq("field", "author"),
				)
				.unique();
			if (!authorReference) throw new Error("Expected an author reference");
			authorReferenceId = authorReference._id;
			await ctx.db.patch(authorReference._id, { referenceKey: "wrong" });
		});
		await expectError(
			orderSetup.adminA.query(api.postContent.listPublished, {
				siteUrl: SITE_A.siteUrl,
				limit: 12,
			}),
			/author reference key mismatch/i,
		);
		await orderSetup.t.run(async (ctx) => {
			if (!authorReferenceId) throw new Error("Expected an author reference ID");
			await ctx.db.patch(authorReferenceId, { referenceKey: "author" });
			const placements = await ctx.db
				.query("contentMediaPlacements")
				.withIndex("by_revisionId_and_role_and_order", (q) =>
					q.eq("revisionId", ordered.revisionId).eq("role", "body"),
				)
				.collect();
			if (placements.length !== 2) throw new Error("Expected two body images");
			await ctx.db.patch(placements[0]._id, { order: 1 });
			await ctx.db.patch(placements[1]._id, { order: 0 });
		});
		await expectError(
			orderSetup.adminA.query(api.postContent.getPublishedBySlug, {
				siteUrl: SITE_A.siteUrl,
				slug: "row-integrity",
			}),
			/body media order does not match image block order/i,
		);
	});

	test("keeps maximum-size Post list reads comfortably bounded", async () => {
		const { t, adminA } = await setup();
		const author = await createAuthor(
			adminA,
			SITE_A.siteUrl,
			"author-bounded-list",
			"author-bounded-list",
		);
		const technicalItems = Array.from({ length: 50 }, (_, index) => ({
			key: `item-${index}`,
			label: `Item ${index}`,
			details: "x".repeat(1_000),
		}));
		let maximumTechnicalRevisionId: Id<"contentRevisions"> | undefined;
		let maximumProjectRevisionId: Id<"contentRevisions"> | undefined;
		for (let index = 0; index < 100; index += 1) {
			const boundedFormat: Omit<Partial<PostDraft>, "kind"> =
				index === 0
					? {
						format: "technicalNote",
						presentation: "technical",
						equipment: technicalItems,
						materials: technicalItems.map((item) => ({
							...item,
							key: `material-${item.key}`,
						})),
					}
					: index === 1
						? {
							format: "projectStory",
							presentation: "caseStudy",
							brief: "b".repeat(5_000),
							approach: "a".repeat(5_000),
							outcome: "o".repeat(5_000),
							credits: "c".repeat(5_000),
						}
						: {};
			const created = await createPost(
				adminA,
				SITE_A.siteUrl,
				`bounded-${index}`,
				completePost(author.documentId, {
					title: `Bounded Post ${index}`,
					slug: `bounded-${index}`,
					...boundedFormat,
				}),
			);
			await publishPost(adminA, created.documentId, created.revisionId);
			if (index === 0) maximumTechnicalRevisionId = created.revisionId;
			if (index === 1) maximumProjectRevisionId = created.revisionId;
		}
		const payloadBytes = await t.run(async (ctx) => {
			if (!maximumTechnicalRevisionId || !maximumProjectRevisionId) {
				throw new Error("Expected maximum-size Post revisions");
			}
			const technical = await ctx.db.get(maximumTechnicalRevisionId);
			const project = await ctx.db.get(maximumProjectRevisionId);
			if (
				!technical
				|| !("kind" in technical.payload)
				|| technical.payload.kind !== "post"
				|| !project
				|| !("kind" in project.payload)
				|| project.payload.kind !== "post"
			) throw new Error("Expected Post revision payloads");
			if (
				"equipment" in technical.payload
				|| "materials" in technical.payload
			) throw new Error("Technical item arrays leaked into a revision payload");
			return {
				technical: new TextEncoder().encode(JSON.stringify(technical.payload)).length,
				project: new TextEncoder().encode(JSON.stringify(project.payload)).length,
			};
		});
		expect(Math.max(payloadBytes.technical, payloadBytes.project) * 200).toBeLessThan(
			8_000_000,
		);
		await expect(
			adminA.query(api.postContent.listPublished, {
				siteUrl: SITE_A.siteUrl,
				limit: 12,
			}),
		).resolves.toHaveLength(12);
		await expect(
			adminA.query(api.postContent.listForEditor, {
				siteUrl: SITE_A.siteUrl,
			}),
		).resolves.toHaveLength(100);
	}, 15_000);

	test("releases media after more than 500 placements become historical", async () => {
		const { adminA, assetA } = await setup();
		const author = await createAuthor(
			adminA,
			SITE_A.siteUrl,
			"author-deep-history",
			"author-deep-history",
		);
		const imageBlocks = Array.from({ length: 100 }, (_, index) =>
			imageBlock(`history-${index}`, assetA.id),
		);
		let current = await createPost(
			adminA,
			SITE_A.siteUrl,
			"deep-media-history",
			completePost(author.documentId, {
				slug: "deep-media-history",
				mainImage: {
					key: "hero",
					assetId: assetA.id,
					altText: "Historical hero",
				},
				body: { version: 1, blocks: imageBlocks },
			}),
		);
		for (let index = 1; index <= 5; index += 1) {
			current = await savePost(
				adminA,
				current.documentId,
				completePost(author.documentId, {
					slug: "deep-media-history",
					summary: `Historical revision ${index}.`,
					mainImage: {
						key: "hero",
						assetId: assetA.id,
						altText: "Historical hero",
					},
					body: { version: 1, blocks: imageBlocks },
				}),
				current.revisionId,
			);
		}
		await adminA.mutation(api.postContent.discardDraft, {
			documentId: current.documentId,
			draftRevisionId: current.revisionId,
		});
		await expect(
			adminA.mutation(api.mediaAssets.requestDeletion, { id: assetA.id }),
		).resolves.toMatchObject({ status: "deleting" });
	});
});
