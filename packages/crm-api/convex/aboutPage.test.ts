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
		const { t, adminA, adminB, assetA } = await setup();
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
		const { adminA, assetA } = await setup();
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
		const { adminA, assetA } = await setup();
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
		const { adminA, assetA, assetB } = await setup();
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
		const { t, adminA, assetA, assetC } = await setup();
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
