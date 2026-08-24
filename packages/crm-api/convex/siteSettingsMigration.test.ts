/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
	createSanitySiteSettingsPlan,
	digestSanitySiteSettingsPlan,
	type SanitySiteSettingsPlan,
} from "./helpers/sanitySiteSettingsPlan";
import {
	type SiteSettingsPinnedRestoreEntry,
	attestSiteSettingsMediaSource,
	importSanitySiteSettingsDraft,
	publishSanitySiteSettingsDraft,
	restorePinnedSiteSettingsRevision,
} from "./helpers/siteSettingsMigrationStore";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const SITE = "site-a.example";
const ADMIN = "admin-a@example.com";
const OG_ASSET_UUID = "123e4567-e89b-42d3-a456-426614174000";
const OG_SOURCE_REF =
	"image-0ccd0a41f44c6387c01425cd93579ac5a4a9f341-1848x1848-png";
const OG_SOURCE_SHA256 = "a".repeat(64);
const OG_RECEIPT_SHA256 = "b".repeat(64);

const attestMediaSource = makeFunctionReference<
	"mutation",
	{
		siteUrl: string;
		mediaAssetId: Id<"mediaAssets">;
		workerAssetId: string;
		sourceAssetRef: string;
		sourceSha256: string;
		receiptDigest: string;
	}
>("siteSettingsMigration:attestMediaSource");

const importDraft = makeFunctionReference<
	"mutation",
	{ plan: SanitySiteSettingsPlan; digest: string }
>("siteSettingsMigration:importDraft");

const publishDraft = makeFunctionReference<
	"mutation",
	{ plan: SanitySiteSettingsPlan; digest: string }
>("siteSettingsMigration:publishDraft");

const restorePinned = makeFunctionReference<
	"mutation",
	{
		siteUrl: string;
		operationId: string;
		entry: SiteSettingsPinnedRestoreEntry;
	}
>("siteSettingsMigration:restorePinnedPublishedRevision");

function readyOgAsset(siteUrl: string) {
	const prefix = `sites/${siteUrl}/web/${OG_ASSET_UUID}/`;
	const derivative = (name: string, width: number) => ({
		key: `${prefix}${name}.webp`,
		contentType: "image/webp" as const,
		width,
		height: width,
	});
	return {
		assetId: OG_ASSET_UUID,
		originalFilename: "site-settings-og.png",
		source: {
			contentType: "image/png" as const,
			sizeBytes: 1_000_000,
			width: 1848,
			height: 1848,
		},
		master: {
			key: `${prefix}master.webp`,
			contentType: "image/webp" as const,
			sizeBytes: 700_000,
			width: 1848,
			height: 1848,
		},
		derivatives: {
			thumb: derivative("thumb", 320),
			card: derivative("card", 768),
			display1280: derivative("display-1280", 1280),
			display2048: derivative("display-2048", 1848),
			display2560: derivative("display-2560", 1848),
		},
	};
}

async function setup() {
	const t = convexTest(schema, modules);
	await t.mutation(internal.platform.seedClient, {
		name: "Site A",
		email: ADMIN,
		siteUrl: SITE,
		tier: "full",
		subscriptionStatus: "active",
		adminEmails: [ADMIN],
		role: "client",
	});
	const admin = t.withIdentity({ subject: ADMIN, email: ADMIN });
	const asset = await admin.mutation(api.mediaAssets.registerReadyWebAsset, {
		siteUrl: SITE,
		asset: readyOgAsset(SITE),
	});
	await t.run(async (ctx) =>
		await attestSiteSettingsMediaSource(ctx, {
			siteUrl: SITE,
			mediaAssetId: asset.id,
			workerAssetId: OG_ASSET_UUID,
			sourceAssetRef: OG_SOURCE_REF,
			sourceSha256: OG_SOURCE_SHA256,
			receiptDigest: OG_RECEIPT_SHA256,
		}),
	);
	const plan = createSanitySiteSettingsPlan(
		{
			siteSettings: [
				{
					_id: "site-settings-source",
					_rev: "site-settings-revision",
					_type: "siteSettings",
					artistName: "Jesse Pomeroy",
					siteTitle: "Angel's Rest",
					tagline: "artist in residence",
					socialLinks: [
						{
							_key: "instagram",
							platform: "instagram",
							url: "https://instagram.com/example",
						},
					],
					seo: {
						description: "Photography by Jesse Pomeroy",
						ogImage: { asset: { _ref: OG_SOURCE_REF } },
					},
				},
			],
		},
		{
			migrationId: "site-settings-test-v1",
			siteUrl: SITE,
			source: {
				projectId: "test-project",
				dataset: "test-dataset",
				perspective: "published",
			},
			decisions: {
				id: "site-settings-decisions-v1",
				artistName: { action: "use-source-owner-approved" },
				siteTitle: { action: "use-source-owner-approved" },
				tagline: { action: "use-source-owner-approved" },
				socialLinks: { action: "use-source-owner-approved" },
				seoDescription: { action: "use-source-owner-approved" },
				logo: { action: "confirmed-absent-owner-approved" },
				seoKeywords: { action: "confirmed-absent-owner-approved" },
				seoImage: {
					action: "extend-target-and-transfer-exact-source",
					sourceSha256: OG_SOURCE_SHA256,
					targetMediaAssetId: asset.id,
					targetWorkerAssetId: OG_ASSET_UUID,
					targetReceiptSha256: OG_RECEIPT_SHA256,
				},
			},
		},
	);
	return {
		t,
		admin,
		asset,
		plan,
		digest: await digestSanitySiteSettingsPlan(plan),
	};
}

type Fixture = Awaited<ReturnType<typeof setup>>;

async function document(fixture: Fixture) {
	return await fixture.t.run(async (ctx) => {
		const rows = await ctx.db.query("contentDocuments").collect();
		const row = rows.find(
			(candidate) => candidate.siteUrl === SITE && candidate.kind === "siteSettings",
		);
		if (!row) throw new Error("Site Settings test document not found");
		return row;
	});
}

async function revisionCount(fixture: Fixture) {
	return await fixture.t.run(
		async (ctx) => (await ctx.db.query("contentRevisions").collect()).length,
	);
}

function restoreEntry(
	document: Doc<"contentDocuments">,
	sourceRevisionId: SiteSettingsPinnedRestoreEntry["sourceRevisionId"],
): SiteSettingsPinnedRestoreEntry {
	if (
		document.kind !== "siteSettings"
		|| !document.publishedRevisionId
		|| document.publishedAt === undefined
		|| !document.publishedBy
	) throw new Error("Published Site Settings fixture is incomplete");
	return {
		documentId: document._id,
		sourceRevisionId,
		expected: {
			draftRevisionId: document.draftRevisionId ?? null,
			publishedRevisionId: document.publishedRevisionId,
			publishedAt: document.publishedAt,
			publishedBy: document.publishedBy,
			updatedAt: document.updatedAt,
			updatedBy: document.updatedBy,
		},
	};
}

describe("dormant Site Settings migration", () => {
	test("fails closed at every internal mutation before content writes", async () => {
		const fixture = await setup();
		await expect(
			fixture.t.mutation(attestMediaSource, {
				siteUrl: SITE,
				mediaAssetId: fixture.asset.id,
				workerAssetId: OG_ASSET_UUID,
				sourceAssetRef: OG_SOURCE_REF,
				sourceSha256: OG_SOURCE_SHA256,
				receiptDigest: OG_RECEIPT_SHA256,
			}),
		).rejects.toThrow(/capability is disabled/i);
		await expect(
			fixture.t.mutation(importDraft, {
				plan: fixture.plan,
				digest: fixture.digest,
			}),
		).rejects.toThrow(/capability is disabled/i);
		expect(await revisionCount(fixture)).toBe(0);

		const imported = await fixture.t.run(
			async (ctx) =>
				await importSanitySiteSettingsDraft(ctx, {
					plan: fixture.plan,
					digest: fixture.digest,
				}),
		);
		await expect(
			fixture.t.mutation(publishDraft, {
				plan: fixture.plan,
				digest: fixture.digest,
			}),
		).rejects.toThrow(/capability is disabled/i);
		const initialImport = await document(fixture);
		expect(initialImport.draftRevisionId).toBe(imported.revisionId);
		await expect(
			fixture.admin.mutation(api.content.saveSiteSettingsDraft, {
				siteUrl: SITE,
				expectedDraftRevisionId: imported.revisionId,
				payload: { ...fixture.plan.payload, tagline: "Blocked initial edit" },
			}),
		).rejects.toThrow(/requires fixed initial publication/i);
		await expect(
			fixture.admin.mutation(api.content.discardSiteSettingsDraft, {
				siteUrl: SITE,
				draftRevisionId: imported.revisionId,
			}),
		).rejects.toThrow(/requires fixed initial publication/i);
		expect(await revisionCount(fixture)).toBe(1);
		expect(await document(fixture)).toEqual(initialImport);
		await expect(
			fixture.admin.mutation(api.content.publishSiteSettings, {
				siteUrl: SITE,
				draftRevisionId: imported.revisionId,
			}),
		).rejects.toThrow(/requires fixed initial publication/i);

		await fixture.t.run(
			async (ctx) =>
				await publishSanitySiteSettingsDraft(ctx, {
					plan: fixture.plan,
					digest: fixture.digest,
				}),
		);
		const entry = restoreEntry(await document(fixture), imported.revisionId);
		await expect(
			fixture.t.mutation(restorePinned, {
				siteUrl: SITE,
				operationId: "site-settings-disabled-restore",
				entry,
			}),
		).rejects.toThrow(/capability is disabled/i);
		expect(await revisionCount(fixture)).toBe(1);
	});

	test("imports, publishes, and restores with exact zero-write replays", async () => {
		const fixture = await setup();
		const imported = await fixture.t.run(
			async (ctx) =>
				await importSanitySiteSettingsDraft(ctx, {
					plan: fixture.plan,
					digest: fixture.digest,
				}),
		);
		expect(imported.status).toBe("imported");
		await expect(
			fixture.t.run(
				async (ctx) =>
					await importSanitySiteSettingsDraft(ctx, {
						plan: fixture.plan,
						digest: fixture.digest,
					}),
			),
		).resolves.toMatchObject({
			status: "identical-replay",
			revisionId: imported.revisionId,
		});
		expect(await revisionCount(fixture)).toBe(1);

		const published = await fixture.t.run(
			async (ctx) =>
				await publishSanitySiteSettingsDraft(ctx, {
					plan: fixture.plan,
					digest: fixture.digest,
				}),
		);
		expect(published.status).toBe("published");
		await expect(
			fixture.t.run(
				async (ctx) =>
					await publishSanitySiteSettingsDraft(ctx, {
						plan: fixture.plan,
						digest: fixture.digest,
					}),
			),
		).resolves.toMatchObject({ status: "identical-replay" });
		expect(await revisionCount(fixture)).toBe(1);

		const { seoOgImageAssetId: _serverOwnedImage, ...browserPayload } =
			fixture.plan.payload;
		const changed = await fixture.admin.mutation(api.content.saveSiteSettingsDraft, {
			siteUrl: SITE,
			payload: { ...browserPayload, tagline: "Changed after cutover" },
		});
		const changedRevision = await fixture.t.run(
			async (ctx) => await ctx.db.get(changed.revisionId),
		);
		expect(changedRevision?.payload).toMatchObject({
			seoOgImageAssetId: fixture.asset.id,
		});
		await fixture.admin.mutation(api.content.publishSiteSettings, {
			siteUrl: SITE,
			draftRevisionId: changed.revisionId,
		});
		expect(
			await fixture.t.query(api.content.getPublishedSiteSettings, { siteUrl: SITE }),
		).toMatchObject({
			tagline: "Changed after cutover",
			seoOgImage: {
				assetId: OG_ASSET_UUID,
				sourceSha256: OG_SOURCE_SHA256,
			},
		});
		const entry = restoreEntry(await document(fixture), imported.revisionId);
		const restored = await fixture.t.run(
			async (ctx) =>
				await restorePinnedSiteSettingsRevision(ctx, {
					siteUrl: SITE,
					operationId: "site-settings-restore-1",
					entry,
				}),
		);
		expect(restored.status).toBe("restored");
		await expect(
			fixture.t.run(
				async (ctx) =>
					await restorePinnedSiteSettingsRevision(ctx, {
						siteUrl: SITE,
						operationId: "site-settings-restore-1",
						entry,
					}),
			),
		).resolves.toMatchObject({
			status: "identical-replay",
			restoredRevisionId: restored.restoredRevisionId,
		});
		expect(await revisionCount(fixture)).toBe(3);
		expect(
			await fixture.t.query(api.content.getPublishedSiteSettings, { siteUrl: SITE }),
		).toEqual({
			...browserPayload,
			seoOgImage: {
				url: `https://media.angelsrest.online/sites/${SITE}/web/${OG_ASSET_UUID}/display-2048.webp`,
				assetId: OG_ASSET_UUID,
				sourceSha256: OG_SOURCE_SHA256,
			},
		});

		const restoredRevision = await fixture.t.run(
			async (ctx) => await ctx.db.get(restored.restoredRevisionId),
		);
		expect(restoredRevision).toMatchObject({
			source: "restore",
			restoredFromRevisionId: imported.revisionId,
			restoreOperationId: "site-settings-restore-1",
			restoreRequestDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
		});
	});
});
