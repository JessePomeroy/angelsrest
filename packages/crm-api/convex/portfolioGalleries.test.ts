/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const SITE_A = { siteUrl: "site-a.example", email: "admin-a@example.com" };
const SITE_B = { siteUrl: "site-b.example", email: "admin-b@example.com" };
const ASSET_A = "123e4567-e89b-42d3-a456-426614174000";
const ASSET_B = "223e4567-e89b-42d3-a456-426614174001";
const ASSET_OTHER_SITE = "323e4567-e89b-42d3-a456-426614174002";

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
	const [assetA, assetB, assetOtherSite] = await Promise.all([
		adminA.mutation(api.mediaAssets.registerReadyWebAsset, {
			siteUrl: SITE_A.siteUrl,
			asset: readyAsset(SITE_A.siteUrl, ASSET_A),
		}),
		adminA.mutation(api.mediaAssets.registerReadyWebAsset, {
			siteUrl: SITE_A.siteUrl,
			asset: readyAsset(SITE_A.siteUrl, ASSET_B),
		}),
		adminB.mutation(api.mediaAssets.registerReadyWebAsset, {
			siteUrl: SITE_B.siteUrl,
			asset: readyAsset(SITE_B.siteUrl, ASSET_OTHER_SITE),
		}),
	]);
	return { t, adminA, adminB, assetA, assetB, assetOtherSite };
}

function placement(
	key: string,
	assetId: string,
	options: { altText?: string } = {},
) {
	return {
		key,
		assetId: assetId as Id<"mediaAssets">,
		altText: options.altText,
		caption: `${key} caption`,
		focalPoint: { x: 0.5, y: 0.4 },
	};
}

describe("tenant-scoped portfolio gallery revisions", () => {
	test("requires authentication, site membership, and same-tenant ready assets", async () => {
		const { t, adminA, adminB, assetA, assetOtherSite } = await setup();
		await expect(t.mutation(api.portfolioGalleries.saveDraft, {
			siteUrl: SITE_A.siteUrl,
			draft: { slug: "work", placements: [] },
		})).rejects.toThrow(/Not authenticated/);
		await expect(adminB.mutation(api.portfolioGalleries.saveDraft, {
			siteUrl: SITE_A.siteUrl,
			draft: { slug: "work", placements: [] },
		})).rejects.toThrow(/Not authorized/);
		await expect(adminA.mutation(api.portfolioGalleries.saveDraft, {
			siteUrl: SITE_A.siteUrl,
			draft: {
				slug: "work",
				placements: [placement("other-site", assetOtherSite.id)],
			},
		})).rejects.toThrow(/same site/);

		const created = await adminA.mutation(api.portfolioGalleries.saveDraft, {
			siteUrl: SITE_A.siteUrl,
			draft: { slug: "work", placements: [placement("local", assetA.id)] },
		});
		await expect(adminB.query(api.portfolioGalleries.getEditorState, {
			galleryId: created.galleryId,
		})).rejects.toThrow(/Not authorized/);
	});

	test("stores immutable ordered placement rows and deduplicates identical autosave retries", async () => {
		const { t, adminA, assetA, assetB } = await setup();
		const first = await adminA.mutation(api.portfolioGalleries.saveDraft, {
			siteUrl: SITE_A.siteUrl,
			draft: {
				title: "First draft",
				slug: "work",
				placements: [
					placement("one", assetA.id),
					placement("two", assetB.id),
				],
			},
		});
		const secondDraft = {
			title: "Second draft",
			slug: "work",
			placements: [
				placement("two", assetB.id),
				placement("one", assetA.id),
			],
		};
		const second = await adminA.mutation(api.portfolioGalleries.saveDraft, {
			siteUrl: SITE_A.siteUrl,
			galleryId: first.galleryId,
			expectedDraftRevisionId: first.revisionId,
			draft: secondDraft,
		});
		const retry = await adminA.mutation(api.portfolioGalleries.saveDraft, {
			siteUrl: SITE_A.siteUrl,
			galleryId: first.galleryId,
			expectedDraftRevisionId: first.revisionId,
			draft: secondDraft,
		});
		expect(retry).toEqual(second);
		await expect(adminA.mutation(api.portfolioGalleries.saveDraft, {
			siteUrl: SITE_A.siteUrl,
			galleryId: first.galleryId,
			expectedDraftRevisionId: first.revisionId,
			draft: { ...secondDraft, title: "Stale overwrite" },
		})).rejects.toThrow(/draft conflict/);

		const stored = await t.run(async (ctx) => ({
			revisions: await ctx.db.query("portfolioGalleryRevisions").take(3),
			placements: await ctx.db.query("portfolioPlacements").take(5),
		}));
		expect(stored.revisions).toHaveLength(2);
		expect(stored.placements).toHaveLength(4);
		const secondPlacements = stored.placements
			.filter((item) => item.revisionId === second.revisionId)
			.sort((a, b) => a.order - b.order);
		expect(secondPlacements.map((item) => item.placementKey)).toEqual(["two", "one"]);
	});

	test("keeps drafts private and requires accessibility review before publication", async () => {
		const { adminA, assetA } = await setup();
		const incomplete = await adminA.mutation(api.portfolioGalleries.saveDraft, {
			siteUrl: SITE_A.siteUrl,
			draft: {
				title: "Selected work",
				description: "A deliberate sequence.",
				slug: "selected-work",
				placements: [placement("hero", assetA.id)],
			},
		});
		expect(await adminA.query(api.portfolioGalleries.getPublishedBySlug, {
			siteUrl: SITE_A.siteUrl,
			slug: "selected-work",
		})).toBeNull();
		await expect(adminA.mutation(api.portfolioGalleries.publish, {
			galleryId: incomplete.galleryId,
			draftRevisionId: incomplete.revisionId,
		})).rejects.toThrow(/needs alt text/);

		const complete = await adminA.mutation(api.portfolioGalleries.saveDraft, {
			siteUrl: SITE_A.siteUrl,
			galleryId: incomplete.galleryId,
			expectedDraftRevisionId: incomplete.revisionId,
			draft: {
				title: " Selected work ",
				description: " A deliberate sequence. ",
				slug: "selected-work",
				placements: [placement("hero", assetA.id, { altText: "Portrait in window light" })],
			},
		});
		await adminA.mutation(api.portfolioGalleries.publish, {
			galleryId: complete.galleryId,
			draftRevisionId: complete.revisionId,
		});
		const published = await adminA.query(api.portfolioGalleries.getPublishedBySlug, {
			siteUrl: SITE_A.siteUrl,
			slug: "selected-work",
		});
		expect(published).toMatchObject({
			title: "Selected work",
			description: "A deliberate sequence.",
			placements: [{
				key: "hero",
				order: 0,
				altText: "Portrait in window light",
				asset: { assetId: ASSET_A },
			}],
		});
		const serialized = JSON.stringify(published);
		expect(serialized).not.toContain("master.webp");
		expect(serialized).not.toContain("originalFilename");
		expect(serialized).not.toContain("createdBy");
		const portfolio = await adminA.query(
			api.portfolioGalleries.listPublishedWithPlacements,
			{ siteUrl: SITE_A.siteUrl },
		);
		expect(portfolio).toEqual([published]);
		expect(
			await adminA.query(api.portfolioGalleries.listPublishedWithPlacements, {
				siteUrl: SITE_B.siteUrl,
			}),
		).toEqual([]);
	});

	test("keeps the published revision live until a newer accessible draft is published", async () => {
		const { adminA, assetA } = await setup();
		const first = await adminA.mutation(api.portfolioGalleries.saveDraft, {
			siteUrl: SITE_A.siteUrl,
			draft: {
				title: "Published title",
				slug: "work",
				placements: [placement("one", assetA.id, { altText: "First image" })],
			},
		});
		await adminA.mutation(api.portfolioGalleries.publish, {
			galleryId: first.galleryId,
			draftRevisionId: first.revisionId,
		});
		await adminA.mutation(api.portfolioGalleries.saveDraft, {
			siteUrl: SITE_A.siteUrl,
			galleryId: first.galleryId,
			expectedDraftRevisionId: first.revisionId,
			draft: {
				title: "Unpublished title",
				slug: "work",
				placements: [placement("one", assetA.id, { altText: "First image" })],
			},
		});
		const published = await adminA.query(api.portfolioGalleries.getPublishedBySlug, {
			siteUrl: SITE_A.siteUrl,
			slug: "work",
		});
		expect(published?.title).toBe("Published title");
	});

	test("bounds the aggregate public projection before another gallery can publish", async () => {
		const { t, adminA, assetA, assetB } = await setup();
		const first = await adminA.mutation(api.portfolioGalleries.saveDraft, {
			siteUrl: SITE_A.siteUrl,
			draft: {
				title: "First",
				slug: "first",
				placements: [placement("first", assetA.id, { altText: "First image" })],
			},
		});
		await adminA.mutation(api.portfolioGalleries.publish, {
			galleryId: first.galleryId,
			draftRevisionId: first.revisionId,
		});
		const second = await adminA.mutation(api.portfolioGalleries.saveDraft, {
			siteUrl: SITE_A.siteUrl,
			draft: {
				title: "Second",
				slug: "second",
				placements: [placement("second", assetB.id, { altText: "Second image" })],
			},
		});
		await t.run(async (ctx) => {
			await ctx.db.patch(first.revisionId, { placementCount: 500 });
		});
		await expect(adminA.mutation(api.portfolioGalleries.publish, {
			galleryId: second.galleryId,
			draftRevisionId: second.revisionId,
		})).rejects.toThrow(/cannot exceed 500 images/);

		await t.run(async (ctx) => {
			await ctx.db.patch(first.revisionId, { placementCount: 501 });
		});
		await expect(adminA.query(api.portfolioGalleries.listPublishedWithPlacements, {
			siteUrl: SITE_A.siteUrl,
		})).rejects.toThrow(/image limit exceeded/);
	});

	test("locks a published slug until redirect history is implemented", async () => {
		const { adminA, assetA } = await setup();
		const draft = await adminA.mutation(api.portfolioGalleries.saveDraft, {
			siteUrl: SITE_A.siteUrl,
			draft: {
				title: "Work",
				slug: "work",
				placements: [placement("one", assetA.id, { altText: "First image" })],
			},
		});
		await adminA.mutation(api.portfolioGalleries.publish, {
			galleryId: draft.galleryId,
			draftRevisionId: draft.revisionId,
		});
		await expect(adminA.mutation(api.portfolioGalleries.saveDraft, {
			siteUrl: SITE_A.siteUrl,
			galleryId: draft.galleryId,
			expectedDraftRevisionId: draft.revisionId,
			draft: {
				title: "Work",
				slug: "new-work",
				placements: [placement("one", assetA.id, { altText: "First image" })],
			},
		})).rejects.toThrow(/redirect support/);
	});

	test("requires and preserves one deliberate whole-site gallery order", async () => {
		const { adminA, assetA, assetB } = await setup();
		const first = await adminA.mutation(api.portfolioGalleries.saveDraft, {
			siteUrl: SITE_A.siteUrl,
			draft: {
				title: "First",
				slug: "first",
				placements: [placement("first", assetA.id, { altText: "First image" })],
			},
		});
		const second = await adminA.mutation(api.portfolioGalleries.saveDraft, {
			siteUrl: SITE_A.siteUrl,
			draft: {
				title: "Second",
				slug: "second",
				placements: [placement("second", assetB.id, { altText: "Second image" })],
			},
		});
		await adminA.mutation(api.portfolioGalleries.publish, {
			galleryId: first.galleryId,
			draftRevisionId: first.revisionId,
		});
		await adminA.mutation(api.portfolioGalleries.publish, {
			galleryId: second.galleryId,
			draftRevisionId: second.revisionId,
		});
		await expect(adminA.mutation(api.portfolioGalleries.reorder, {
			siteUrl: SITE_A.siteUrl,
			galleryIds: [second.galleryId],
		})).rejects.toThrow(/every site gallery/);
		await adminA.mutation(api.portfolioGalleries.reorder, {
			siteUrl: SITE_A.siteUrl,
			galleryIds: [second.galleryId, first.galleryId],
		});
		const galleries = await adminA.query(api.portfolioGalleries.listForEditor, {
			siteUrl: SITE_A.siteUrl,
		});
		expect(galleries.map((gallery) => gallery.galleryId)).toEqual([
			second.galleryId,
			first.galleryId,
		]);
		const published = await adminA.query(
			api.portfolioGalleries.listPublishedWithPlacements,
			{ siteUrl: SITE_A.siteUrl },
		);
		expect(published.map((gallery) => gallery.galleryId)).toEqual([
			second.galleryId,
			first.galleryId,
		]);
	});
});
