/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { BlogSupportingDraft } from "./helpers/blogContentValidators";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const SITE_A = { siteUrl: "site-a.example", email: "admin-a@example.com" };
const SITE_B = { siteUrl: "site-b.example", email: "admin-b@example.com" };
const ASSET_A = "123e4567-e89b-42d3-a456-426614174000";
const ASSET_B = "223e4567-e89b-42d3-a456-426614174001";
const ASSET_C = "323e4567-e89b-42d3-a456-426614174002";

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
			thumb: { key: `${prefix}thumb.webp`, contentType: "image/webp" as const, width: 320, height: 213 },
			card: { key: `${prefix}card.webp`, contentType: "image/webp" as const, width: 768, height: 512 },
			display1280: { key: `${prefix}display-1280.webp`, contentType: "image/webp" as const, width: 1280, height: 853 },
			display2048: { key: `${prefix}display-2048.webp`, contentType: "image/webp" as const, width: 2048, height: 1365 },
			display2560: { key: `${prefix}display-2560.webp`, contentType: "image/webp" as const, width: 2560, height: 1707 },
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
			asset: readyAsset(SITE_A.siteUrl, ASSET_A),
		}),
		adminB.mutation(api.mediaAssets.registerReadyWebAsset, {
			siteUrl: SITE_B.siteUrl,
			asset: readyAsset(SITE_B.siteUrl, ASSET_B),
		}),
		adminA.mutation(api.mediaAssets.registerReadyWebAsset, {
			siteUrl: SITE_A.siteUrl,
			asset: readyAsset(SITE_A.siteUrl, ASSET_C),
		}),
	]);
	return { t, adminA, adminB, assetA, assetB, assetC };
}

function category(title: string, slug: string) {
	return { kind: "category" as const, title, slug };
}

function author(name: string, slug: string, assetId?: Id<"mediaAssets">) {
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
				},
			}
			: {}),
	};
}

async function expectError(operation: Promise<unknown>, message: RegExp) {
	await expect(operation).rejects.toThrow(message);
}

type Admin = Awaited<ReturnType<typeof setup>>["adminA"];

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

describe("tenant-scoped Blog supporting content", () => {
	test("requires authentication, tenant membership, and matching document kinds", async () => {
		const { t, adminA, adminB } = await setup();
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
		const { adminA, adminB } = await setup();
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
			/slug .* already exists/i,
		);
		expect(authors[0]?.documentId).toBe(first.documentId);
	});

	test("deduplicates create and save retries while rejecting stale changes", async () => {
		const { t, adminA } = await setup();
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
		const { adminA, assetA } = await setup();
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
		const { adminA } = await setup();
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
		await expectError(
			save(adminA, created.documentId, category("New Stories", "renamed-stories"), newer.revisionId),
			/redirect support/i,
		);
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

	test("keeps drafts private and returns only the public author projection", async () => {
		const { t, adminA, assetA } = await setup();
		const created = await create(
			adminA,
			SITE_A.siteUrl,
			"author-mara",
			author("Mara", "mara", assetA.id),
		);
		expect((await adminA.query(api.blogContent.getEditorState, {
			documentId: created.documentId,
		})).draft?.schemaVersion).toBe(1);
		expect(
			await t.query(api.blogContent.getPublishedBySlug, {
				siteUrl: SITE_A.siteUrl,
				kind: "author",
				slug: "mara",
			}),
		).toBeNull();
		expect(
			await t.query(api.blogContent.listPublished, {
				siteUrl: SITE_A.siteUrl,
				kind: "author",
			}),
		).toEqual([]);
		expect(await t.query(api.blogContent.getPublishedBySlug, {
			siteUrl: SITE_A.siteUrl,
			kind: "author",
			slug: " Not Canonical ",
		})).toBeNull();

		await publish(adminA, created.documentId, created.revisionId);
		await save(adminA, created.documentId, author("Private Draft Name", "mara", assetA.id));
		const result = await t.query(api.blogContent.getPublishedBySlug, {
			siteUrl: SITE_A.siteUrl,
			kind: "author",
			slug: "mara",
		});
		expect(result).not.toBeNull();
		if (!result || result.payload.kind !== "author") {
			throw new Error("Expected a published author");
		}
		expect(Object.keys(result).sort()).toEqual([
			"payload",
			"publishedAt",
			"revisionId",
		]);
		expect(Object.keys(result.payload).sort()).toEqual([
			"bio",
			"kind",
			"name",
			"portrait",
			"slug",
		]);
		expect(Object.keys(result.payload.portrait ?? {}).sort()).toEqual([
			"altText",
			"asset",
			"caption",
			"key",
		]);
		expect(Object.keys(result.payload.portrait?.asset ?? {}).sort()).toEqual([
			"assetId",
			"derivatives",
			"source",
		]);
		expect(result.payload.name).toBe("Mara");
		const serialized = JSON.stringify(result);
		expect(serialized).not.toContain("Private Draft Name");
		expect(serialized).not.toContain("originalFilename");
		expect(serialized).not.toContain("master.webp");
		expect(serialized).not.toContain(assetA.id);
		expect(
			await t.query(api.blogContent.getPublishedBySlug, {
				siteUrl: SITE_B.siteUrl,
				kind: "author",
				slug: "mara",
			}),
		).toBeNull();
		expect(
			await t.query(api.blogContent.getPublishedBySlug, {
				siteUrl: SITE_A.siteUrl,
				kind: "category",
				slug: "mara",
			}),
		).toBeNull();
	});

	test("enforces portrait tenant, readiness, and active-reference lifecycle", async () => {
		const { t, adminA, assetA, assetB, assetC } = await setup();
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
			adminA.mutation(api.mediaAssets.requestDeletion, { id: assetA.id }),
			/in use by Author content/i,
		);
		await adminA.mutation(api.blogContent.discardDraft, {
			documentId: draft.documentId,
			draftRevisionId: draft.revisionId,
		});
		expect(
			await adminA.mutation(api.mediaAssets.requestDeletion, { id: assetA.id }),
		).toMatchObject({ status: "deleting" });
		await adminA.mutation(api.mediaAssets.completeDeletion, { id: assetA.id });
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
			adminA.mutation(api.mediaAssets.requestDeletion, { id: assetC.id }),
			/in use by Author content/i,
		);
	});

	test("fails closed when revision pointers cross document ownership", async () => {
		const { t, adminA, adminB } = await setup();
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

		await t.run(async (ctx) => {
			await ctx.db.patch(local.documentId, {
				draftRevisionId: undefined,
				publishedRevisionId: foreign.revisionId,
				slug: "local",
				publishedAt: Date.now(),
			});
		});
		await expect(
			t.query(api.blogContent.getPublishedBySlug, {
				siteUrl: SITE_A.siteUrl,
				kind: "category",
				slug: "local",
			}),
		).rejects.toThrow(/ownership mismatch/i);
	});

	test("fails closed on published slug divergence and treats bad route slugs as absent", async () => {
		const { t, adminA } = await setup();
		const created = await create(
			adminA,
			SITE_A.siteUrl,
			"category-integrity",
			category("Integrity", "integrity"),
		);
		await publish(adminA, created.documentId, created.revisionId);
		expect(
			await t.query(api.blogContent.getPublishedBySlug, {
				siteUrl: SITE_A.siteUrl,
				kind: "category",
				slug: "Not Canonical",
			}),
		).toBeNull();

		await t.run(async (ctx) => {
			await ctx.db.patch(created.documentId, { slug: "different" });
		});
		await expect(
			t.query(api.blogContent.getPublishedBySlug, {
				siteUrl: SITE_A.siteUrl,
				kind: "category",
				slug: "different",
			}),
		).rejects.toThrow(/slug mismatch/i);
		await t.run(async (ctx) => {
			await ctx.db.patch(created.documentId, { slug: undefined });
		});
		await expect(
			t.query(api.blogContent.listPublished, {
				siteUrl: SITE_A.siteUrl,
				kind: "category",
			}),
		).rejects.toThrow(/slug mismatch/i);
	});
});
