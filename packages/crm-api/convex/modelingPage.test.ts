/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

import { SITE_A, ASSET_A, ASSET_C, setupWebMedia } from "../test/webMediaFixtures";

const modules = import.meta.glob("./**/*.ts");

function image(
	assetId: Id<"mediaAssets">,
	options: { key?: string; altText?: string } = {},
) {
	return {
		key: options.key ?? "image-primary",
		assetId,
		altText: options.altText,
	};
}

function completeModeling(assetId: Id<"mediaAssets">) {
	return {
		heading: "modeling & acting",
		intro: "Selected modeling, acting, and portrait work.",
		galleries: [
			{
				key: "fashion-editorial",
				title: "Fashion Editorial",
				slug: "fashion-editorial",
				description: "Selected editorial work.",
				isVisible: true,
				images: [image(assetId, { altText: "Margaret in an editorial portrait" })],
			},
		],
		seoDescription: "Modeling, acting, and portrait work by Margaret Helena.",
	};
}

describe("typed Modeling-page content", () => {
	test("uses a tenant-scoped singleton and protects editor state", async () => {
		const { t, adminA, adminB, assetA } = await setupWebMedia(modules);
		await adminA.mutation(api.content.saveAboutPageDraft, {
			siteUrl: SITE_A.siteUrl,
			payload: { heading: "about" },
		});
		await adminA.mutation(api.content.saveModelingPageDraft, {
			siteUrl: SITE_A.siteUrl,
			payload: completeModeling(assetA.id),
		});
		const kinds = await t.run(async (ctx) =>
			(await ctx.db.query("contentDocuments").collect())
				.map((document) => document.kind)
				.sort(),
		);
		expect(kinds).toEqual(["aboutPage", "modelingPage"]);
		await expect(
			adminB.query(api.content.getModelingPageEditorState, {
				siteUrl: SITE_A.siteUrl,
			}),
		).rejects.toThrow(/not authorized/i);
	});

	test("keeps autosave idempotent and rejects stale revisions", async () => {
		const { adminA, assetA } = await setupWebMedia(modules);
		const first = await adminA.mutation(api.content.saveModelingPageDraft, {
			siteUrl: SITE_A.siteUrl,
			payload: completeModeling(assetA.id),
		});
		const retry = await adminA.mutation(api.content.saveModelingPageDraft, {
			siteUrl: SITE_A.siteUrl,
			expectedDraftRevisionId: first.revisionId,
			payload: completeModeling(assetA.id),
		});
		expect(retry.revisionId).toBe(first.revisionId);
		const second = await adminA.mutation(api.content.saveModelingPageDraft, {
			siteUrl: SITE_A.siteUrl,
			expectedDraftRevisionId: first.revisionId,
			payload: { ...completeModeling(assetA.id), heading: "modeling" },
		});
		await expect(
			adminA.mutation(api.content.saveModelingPageDraft, {
				siteUrl: SITE_A.siteUrl,
				expectedDraftRevisionId: first.revisionId,
				payload: { ...completeModeling(assetA.id), heading: "stale" },
			}),
		).rejects.toThrow(/conflict/i);
		expect(second.revisionId).not.toBe(first.revisionId);
	});

	test("bounds drafts and gates only visible categories at publication", async () => {
		const { adminA, assetA } = await setupWebMedia(modules);
		await expect(
			adminA.mutation(api.content.saveModelingPageDraft, {
				siteUrl: SITE_A.siteUrl,
				payload: {
					galleries: Array.from({ length: 13 }, (_, index) => ({
						key: `category-${index}`,
						isVisible: false,
					})),
				},
			}),
		).rejects.toThrow(/more than 12 categories/i);
		await expect(
			adminA.mutation(api.content.saveModelingPageDraft, {
				siteUrl: SITE_A.siteUrl,
				payload: {
					galleries: [{
						key: "fashion",
						isVisible: false,
						images: Array.from({ length: 11 }, (_, index) =>
							image(assetA.id, { key: `image-${index}` })
						),
					}],
				},
			}),
		).rejects.toThrow(/more than 10 images/i);

		const incomplete = await adminA.mutation(api.content.saveModelingPageDraft, {
			siteUrl: SITE_A.siteUrl,
			payload: {
				heading: "modeling",
				galleries: [{ key: "later", isVisible: false }],
			},
		});
		await expect(
			adminA.mutation(api.content.publishModelingPage, {
				siteUrl: SITE_A.siteUrl,
				draftRevisionId: incomplete.revisionId,
			}),
		).rejects.toThrow(/visible Modeling category/i);

		const missingAlt = await adminA.mutation(api.content.saveModelingPageDraft, {
			siteUrl: SITE_A.siteUrl,
			expectedDraftRevisionId: incomplete.revisionId,
			payload: {
				...completeModeling(assetA.id),
				galleries: [{
					...completeModeling(assetA.id).galleries[0],
					images: [image(assetA.id)],
				}],
			},
		});
		await expect(
			adminA.mutation(api.content.publishModelingPage, {
				siteUrl: SITE_A.siteUrl,
				draftRevisionId: missingAlt.revisionId,
			}),
		).rejects.toThrow(/needs alt text before publishing/i);
		const publishable = await adminA.mutation(api.content.saveModelingPageDraft, {
			siteUrl: SITE_A.siteUrl,
			expectedDraftRevisionId: missingAlt.revisionId,
			payload: {
				...completeModeling(assetA.id),
				galleries: [
					...completeModeling(assetA.id).galleries,
					{ key: "unfinished", isVisible: false },
				],
			},
		});
		await expect(
			adminA.mutation(api.content.publishModelingPage, {
				siteUrl: SITE_A.siteUrl,
				draftRevisionId: publishable.revisionId,
			}),
		).resolves.toMatchObject({ publishedRevisionId: publishable.revisionId });
	});

	test("rejects cross-tenant media and protects active Modeling references", async () => {
		const { adminA, assetA, assetB } = await setupWebMedia(modules);
		await expect(
			adminA.mutation(api.content.saveModelingPageDraft, {
				siteUrl: SITE_A.siteUrl,
				payload: completeModeling(assetB.id),
			}),
		).rejects.toThrow(/same site/i);
		const draft = await adminA.mutation(api.content.saveModelingPageDraft, {
			siteUrl: SITE_A.siteUrl,
			payload: completeModeling(assetA.id),
		});
		await expect(
			adminA.mutation(api.mediaAssets.requestDeletion, {
				siteUrl: SITE_A.siteUrl,
				id: assetA.id,
			}),
		).rejects.toThrow(/in use by Modeling content/i);
		await adminA.mutation(api.content.publishModelingPage, {
			siteUrl: SITE_A.siteUrl,
			draftRevisionId: draft.revisionId,
		});
		await expect(
			adminA.mutation(api.mediaAssets.requestDeletion, {
				siteUrl: SITE_A.siteUrl,
				id: assetA.id,
			}),
		).rejects.toThrow(/in use by Modeling content/i);
	});

	test("projects deliberate order and public derivatives without hidden content", async () => {
		const { t, adminA, assetA, assetC } = await setupWebMedia(modules);
		const draft = await adminA.mutation(api.content.saveModelingPageDraft, {
			siteUrl: SITE_A.siteUrl,
			payload: {
				...completeModeling(assetA.id),
				heading: "  modeling & acting  ",
				galleries: [
					{
						...completeModeling(assetA.id).galleries[0],
						images: [
							image(assetC.id, { key: "second-asset-first", altText: "Editorial portrait two" }),
							image(assetA.id, { key: "first-asset-second", altText: "Editorial portrait one" }),
						],
					},
					{ key: "unfinished", isVisible: false },
				],
			},
		});
		await adminA.mutation(api.content.publishModelingPage, {
			siteUrl: SITE_A.siteUrl,
			draftRevisionId: draft.revisionId,
		});
		const published = await t.query(
			api.content.getPublishedModelingPageWithRevision,
			{ siteUrl: SITE_A.siteUrl },
		);
		expect(published).toMatchObject({
			revisionId: draft.revisionId,
			payload: {
				heading: "modeling & acting",
				galleries: [{
					order: 0,
					title: "Fashion Editorial",
					images: [
						{ order: 0, asset: { assetId: ASSET_C } },
						{ order: 1, asset: { assetId: ASSET_A } },
					],
				}],
			},
		});
		const serialized = JSON.stringify(published);
		expect(serialized).not.toContain("seoImage");
		expect(serialized).not.toContain("unfinished");
		expect(serialized).not.toContain("originalFilename");
		expect(serialized).not.toContain("master.webp");
		expect(serialized).not.toContain(assetA.id);
	});
});
