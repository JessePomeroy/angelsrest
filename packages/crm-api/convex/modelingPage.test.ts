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
		const { t, adminA, adminB, assetA } = await setup();
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
		const { adminA, assetA } = await setup();
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
		const { adminA, assetA } = await setup();
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
		const { adminA, assetA, assetB } = await setup();
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
		const { t, adminA, assetA, assetC } = await setup();
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
