/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

import { SITE_A, ASSET_A, ASSET_C, setupWebMedia } from "../test/webMediaFixtures";

const modules = import.meta.glob("./**/*.ts");

function portrait(
	assetId: Id<"mediaAssets">,
	options: { key?: string; altText?: string } = {},
) {
	return {
		key: options.key ?? "portrait-primary",
		assetId,
		altText: options.altText,
	};
}

function completeAbout(assetId: Id<"mediaAssets">) {
	return {
		heading: "about",
		displayName: "Margaret Helena",
		role: "Photographer and multidisciplinary artist",
		introduction: "Chicago-raised creative working across image, sound, and performance.",
		biography: "I approach collaboration through timing, observation, and care.",
		portraits: [portrait(assetId, { altText: "Margaret standing beside lake water" })],
		sections: [
			{
				key: "background",
				title: "background",
				items: ["BA in Journalism and Media Art", "Chicago-based"],
			},
		],
		highlights: [
			{ key: "practice", label: "practice", value: "photography · direction · music" },
		],
		seoDescription: "Margaret Helena is a Chicago-based photographer and artist.",
	};
}

describe("typed About-page content", () => {
	test("keeps About content in its own tenant singleton and protects editor state", async () => {
		const { t, adminA, adminB, assetA } = await setupWebMedia(modules);
		await adminA.mutation(api.content.saveSiteSettingsDraft, {
			siteUrl: SITE_A.siteUrl,
			payload: { artistName: "Maggie" },
		});
		await adminA.mutation(api.content.saveAboutPageDraft, {
			siteUrl: SITE_A.siteUrl,
			payload: completeAbout(assetA.id),
		});
		const kinds = await t.run(async (ctx) =>
			(await ctx.db.query("contentDocuments").collect())
				.map((document) => document.kind)
				.sort(),
		);
		expect(kinds).toEqual(["aboutPage", "siteSettings"]);
		await expect(
			adminB.query(api.content.getAboutPageEditorState, { siteUrl: SITE_A.siteUrl }),
		).rejects.toThrow(/not authorized/i);
		await expect(
			adminB.mutation(api.content.saveAboutPageDraft, {
				siteUrl: SITE_A.siteUrl,
				payload: completeAbout(assetA.id),
			}),
		).rejects.toThrow(/not authorized/i);
	});

	test("keeps autosave retries idempotent and rejects stale revisions", async () => {
		const { adminA, assetA } = await setupWebMedia(modules);
		const first = await adminA.mutation(api.content.saveAboutPageDraft, {
			siteUrl: SITE_A.siteUrl,
			payload: completeAbout(assetA.id),
		});
		const retry = await adminA.mutation(api.content.saveAboutPageDraft, {
			siteUrl: SITE_A.siteUrl,
			expectedDraftRevisionId: first.revisionId,
			payload: completeAbout(assetA.id),
		});
		expect(retry.revisionId).toBe(first.revisionId);
		const second = await adminA.mutation(api.content.saveAboutPageDraft, {
			siteUrl: SITE_A.siteUrl,
			expectedDraftRevisionId: first.revisionId,
			payload: { ...completeAbout(assetA.id), heading: "about maggie" },
		});
		await expect(
			adminA.mutation(api.content.saveAboutPageDraft, {
				siteUrl: SITE_A.siteUrl,
				expectedDraftRevisionId: first.revisionId,
				payload: { ...completeAbout(assetA.id), heading: "stale" },
			}),
		).rejects.toThrow(/conflict/i);
		expect(second.revisionId).not.toBe(first.revisionId);
	});

	test("allows incomplete drafts but enforces bounded accessible publication", async () => {
		const { adminA, assetA } = await setupWebMedia(modules);
		await expect(
			adminA.mutation(api.content.saveAboutPageDraft, {
				siteUrl: SITE_A.siteUrl,
				payload: { biography: "x".repeat(8_001) },
			}),
		).rejects.toThrow(/8000 characters or fewer/i);
		await expect(
			adminA.mutation(api.content.saveAboutPageDraft, {
				siteUrl: SITE_A.siteUrl,
				payload: {
					portraits: Array.from({ length: 11 }, (_, index) =>
						portrait(assetA.id, { key: `portrait-${index}` }),
					),
				},
			}),
		).rejects.toThrow(/more than 10 images/i);
		const incomplete = await adminA.mutation(api.content.saveAboutPageDraft, {
			siteUrl: SITE_A.siteUrl,
			payload: { heading: "about" },
		});
		await expect(
			adminA.mutation(api.content.publishAboutPage, {
				siteUrl: SITE_A.siteUrl,
				draftRevisionId: incomplete.revisionId,
			}),
		).rejects.toThrow(/portrait is required/i);

		const missingAlt = await adminA.mutation(api.content.saveAboutPageDraft, {
			siteUrl: SITE_A.siteUrl,
			expectedDraftRevisionId: incomplete.revisionId,
			payload: {
				...completeAbout(assetA.id),
				portraits: [portrait(assetA.id)],
			},
		});
		await expect(
			adminA.mutation(api.content.publishAboutPage, {
				siteUrl: SITE_A.siteUrl,
				draftRevisionId: missingAlt.revisionId,
			}),
		).rejects.toThrow(/needs alt text before publishing/i);
	});

	test("rejects cross-tenant portraits and protects active About references from deletion", async () => {
		const { adminA, assetA, assetB } = await setupWebMedia(modules);
		await expect(
			adminA.mutation(api.content.saveAboutPageDraft, {
				siteUrl: SITE_A.siteUrl,
				payload: completeAbout(assetB.id),
			}),
		).rejects.toThrow(/same site/i);

		const draft = await adminA.mutation(api.content.saveAboutPageDraft, {
			siteUrl: SITE_A.siteUrl,
			payload: completeAbout(assetA.id),
		});
		await expect(
			adminA.mutation(api.mediaAssets.requestDeletion, {
				siteUrl: SITE_A.siteUrl,
				id: assetA.id,
			}),
		).rejects.toThrow(/in use by About content/i);
		await adminA.mutation(api.content.publishAboutPage, {
			siteUrl: SITE_A.siteUrl,
			draftRevisionId: draft.revisionId,
		});
		await expect(
			adminA.mutation(api.mediaAssets.requestDeletion, {
				siteUrl: SITE_A.siteUrl,
				id: assetA.id,
			}),
		).rejects.toThrow(/in use by About content/i);
	});

	test("projects only normalized copy and public responsive derivatives", async () => {
		const { t, adminA, assetA, assetC } = await setupWebMedia(modules);
		const draft = await adminA.mutation(api.content.saveAboutPageDraft, {
			siteUrl: SITE_A.siteUrl,
			payload: {
				...completeAbout(assetA.id),
				heading: "  about  ",
				displayName: "  Margaret Helena  ",
				portraits: [
					portrait(assetA.id, {
						key: "portrait-first",
						altText: "Margaret standing beside lake water",
					}),
					portrait(assetC.id, {
						key: "portrait-second",
						altText: "Margaret looking toward the camera",
					}),
				],
			},
		});
		await adminA.mutation(api.content.publishAboutPage, {
			siteUrl: SITE_A.siteUrl,
			draftRevisionId: draft.revisionId,
		});
		const published = await t.query(
			api.content.getPublishedAboutPageWithRevision,
			{ siteUrl: SITE_A.siteUrl },
		);
		expect(published).toMatchObject({
			revisionId: draft.revisionId,
			payload: {
				heading: "about",
				displayName: "Margaret Helena",
				portraits: [
					{
						order: 0,
						altText: "Margaret standing beside lake water",
						asset: {
							assetId: ASSET_A,
							source: { width: 3000, height: 2000 },
						},
					},
					{
						order: 1,
						altText: "Margaret looking toward the camera",
						asset: { assetId: ASSET_C },
					},
				],
			},
		});
		const serialized = JSON.stringify(published);
		expect(serialized).not.toContain("seoImage");
		expect(serialized).not.toContain("focalPoint");
		expect(serialized).not.toContain("originalFilename");
		expect(serialized).not.toContain("master.webp");
		expect(serialized).not.toContain(assetA.id);
		expect(Object.keys(published ?? {}).sort()).toEqual([
			"payload",
			"publishedAt",
			"revisionId",
		]);
	});
});

test("real-page About previews project ready owned portraits without publishing the draft", async () => {
 const { t, adminA, adminB, assetA } = await setupWebMedia(modules);
 const draft = await adminA.mutation(api.content.saveAboutPageDraft, { siteUrl: SITE_A.siteUrl, payload: completeAbout(assetA.id) });
 const args = { siteUrl: SITE_A.siteUrl, draftRevisionId: draft.revisionId };
 expect(await adminA.query(api.content.getAboutPageDraftPreview, args)).toMatchObject({ payload: { portraits: [{ asset: { assetId: ASSET_A } }] } });
 expect(await t.query(api.content.getPublishedAboutPageWithRevision, { siteUrl: SITE_A.siteUrl })).toBeNull();
 await expect(adminB.query(api.content.getAboutPageDraftPreview, args)).rejects.toThrow("Not authorized");
});
