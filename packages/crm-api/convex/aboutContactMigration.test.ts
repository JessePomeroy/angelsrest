/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
	type AboutContactPinnedRestoreEntry,
	attestAboutContactMediaSource,
	importSanityAboutContactDrafts,
	publishSanityAboutContactDrafts,
	restorePinnedAboutContactRevisions,
} from "./helpers/aboutContactMigrationStore";
import {
	createSanityAboutContactPlan,
	digestSanityAboutContactPlan,
	type SanityAboutContactPlan,
} from "./helpers/sanityAboutContactPlan";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const SITE = "site-a.example";
const ADMIN = "admin-a@example.com";
const ASSET_UUID = "123e4567-e89b-42d3-a456-426614174000";
const MEDIA_RECEIPT = "b".repeat(64);

const attestMediaSource = makeFunctionReference<
	"mutation",
	{
		siteUrl: string;
		mediaAssetId: Id<"mediaAssets">;
		workerAssetId: string;
		sourceSha256: string;
		sourceWidth: number;
		sourceHeight: number;
		receiptDigest: string;
	}
>("aboutContactMigration:attestMediaSource");

const importDrafts = makeFunctionReference<
	"mutation",
	{ plan: SanityAboutContactPlan; digest: string }
>("aboutContactMigration:importDrafts");

const publishDrafts = makeFunctionReference<
	"mutation",
	{ plan: SanityAboutContactPlan; digest: string }
>("aboutContactMigration:publishDrafts");

const restorePinned = makeFunctionReference<
	"mutation",
	{
		siteUrl: string;
		operationId: string;
		entries: AboutContactPinnedRestoreEntry[];
	}
>("aboutContactMigration:restorePinnedPublishedRevisions");

function readyAsset(siteUrl: string, assetId: string) {
	const prefix = `sites/${siteUrl}/web/${assetId}/`;
	return {
		assetId,
		originalFilename: `${assetId}.jpg`,
		source: {
			contentType: "image/jpeg" as const,
			sizeBytes: 1_000_000,
			width: 1440,
			height: 2160,
		},
		master: {
			key: `${prefix}master.webp`,
			contentType: "image/webp" as const,
			sizeBytes: 700_000,
			width: 1440,
			height: 2160,
		},
		derivatives: {
			thumb: {
				key: `${prefix}thumb.webp`,
				contentType: "image/webp" as const,
				width: 320,
				height: 480,
			},
			card: {
				key: `${prefix}card.webp`,
				contentType: "image/webp" as const,
				width: 768,
				height: 1152,
			},
			display1280: {
				key: `${prefix}display-1280.webp`,
				contentType: "image/webp" as const,
				width: 1280,
				height: 1920,
			},
			display2048: {
				key: `${prefix}display-2048.webp`,
				contentType: "image/webp" as const,
				width: 1440,
				height: 2160,
			},
			display2560: {
				key: `${prefix}display-2560.webp`,
				contentType: "image/webp" as const,
				width: 1440,
				height: 2160,
			},
		},
	};
}

async function setup() {
	const t = convexTest(schema, modules);
	await t.mutation(internal.platform.seedClient, {
		name: SITE,
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
		asset: readyAsset(SITE, ASSET_UUID),
	});
	await t.run(async (ctx) =>
		await attestAboutContactMediaSource(ctx, {
			siteUrl: SITE,
			mediaAssetId: asset.id,
			workerAssetId: ASSET_UUID,
			sourceSha256: "0e94b665f7654c74158daf3aa2c497139c5cb7c4490d72205cfa3babd6dc4eb0",
			sourceWidth: 1440,
			sourceHeight: 2160,
			receiptDigest: MEDIA_RECEIPT,
		}),
	);
	const plan = createSanityAboutContactPlan(
		{
			about: [
				{
					_id: "about-source",
					_rev: "about-revision",
					_type: "about",
					name: "Margaret Helena",
					heading: "About",
					title: "Photographer",
					portrait: { asset: { _ref: "image-about-1440x2160-jpg" } },
					shortBio: "Chicago-raised photographer and artist.",
					plainBio: "I approach collaboration through observation and care.",
					fullBio: [],
					seo: { description: "About Margaret Helena." },
				},
			],
			contact: [
				{
					_id: "contact-source",
					_rev: "contact-revision",
					_type: "contactPage",
					heading: "Get in touch",
					intro: [
						{
							_type: "block",
							style: "normal",
							markDefs: [],
							children: [
								{
									_type: "span",
									text: "Tell me what you would like to make together.",
									marks: [],
								},
							],
						},
					],
					email: "hello@example.com",
					bookingEnabled: true,
					bookingUrl: "https://cal.example/source",
				},
			],
		},
		{
			migrationId: "about-contact-test-v1",
			siteUrl: SITE,
			source: {
				projectId: "test-project",
				dataset: "test-dataset",
				perspective: "published",
			},
			decisions: {
				id: "about-contact-decisions-v1",
				aboutBiography: { action: "use-plain-bio-owner-approved" },
				aboutPortrait: {
					action: "use-local-portrait-owner-approved",
					targetMediaAssetId: asset.id,
					targetWorkerAssetId: ASSET_UUID,
					targetReceiptSha256: MEDIA_RECEIPT,
					altText: "Margaret standing beside lake water.",
				},
				aboutSocial: {
					action: "defer-to-site-settings-owner-approved",
				},
				aboutSeoImage: { action: "keep-host-fallback-owner-approved" },
				contactIntro: {
					action: "accept-source-plain-paragraphs-owner-approved",
				},
				contactStaticCopy: {
					action: "accept-host-seed-owner-approved",
				},
				contactBooking: {
					action: "use-host-seed-booking-owner-approved",
				},
				contactBookingTypes: { action: "omit-owner-approved" },
			},
		},
	);
	return {
		t,
		admin,
		plan,
		digest: await digestSanityAboutContactPlan(plan),
	};
}

type Fixture = Awaited<ReturnType<typeof setup>>;

async function runImport(fixture: Fixture) {
	return await fixture.t.run(
		async (ctx) =>
			await importSanityAboutContactDrafts(ctx, {
				plan: fixture.plan,
				digest: fixture.digest,
			}),
	);
}

async function runPublish(fixture: Fixture) {
	return await fixture.t.run(
		async (ctx) =>
			await publishSanityAboutContactDrafts(ctx, {
				plan: fixture.plan,
				digest: fixture.digest,
			}),
	);
}

async function runRestore(
	fixture: Fixture,
	args: Parameters<typeof restorePinnedAboutContactRevisions>[1],
) {
	return await fixture.t.run(
		async (ctx) => await restorePinnedAboutContactRevisions(ctx, args),
	);
}

async function pair(fixture: Fixture) {
	return await fixture.t.run(async (ctx) => {
		const documents = await ctx.db.query("contentDocuments").collect();
		return documents
			.filter(
				(document): document is Doc<"contentDocuments"> & {
					kind: "aboutPage" | "contactPage";
				} =>
					document.siteUrl === SITE
					&& (document.kind === "aboutPage" || document.kind === "contactPage"),
			)
			.sort((left, right) => left.kind.localeCompare(right.kind));
	});
}

async function revisionCount(fixture: Fixture) {
	return await fixture.t.run(
		async (ctx) => (await ctx.db.query("contentRevisions").collect()).length,
	);
}

function restoreEntry(
	document: Doc<"contentDocuments">,
	sourceRevisionId: Id<"contentRevisions">,
): AboutContactPinnedRestoreEntry {
	if (
		(document.kind !== "aboutPage" && document.kind !== "contactPage")
		|| !document.publishedRevisionId
		|| document.publishedAt === undefined
		|| !document.publishedBy
	) {
		throw new Error("Published About/Contact fixture is incomplete");
	}
	return {
		kind: document.kind,
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

describe("dormant About/Contact migration", () => {
	test("fails closed before either entrypoint can reach content storage", async () => {
		const fixture = await setup();
		await expect(
			fixture.t.mutation(attestMediaSource, {
				siteUrl: SITE,
				mediaAssetId: fixture.plan.decisionSet.aboutPortrait.targetMediaAssetId,
				workerAssetId: ASSET_UUID,
				sourceSha256: "0e94b665f7654c74158daf3aa2c497139c5cb7c4490d72205cfa3babd6dc4eb0",
				sourceWidth: 1440,
				sourceHeight: 2160,
				receiptDigest: MEDIA_RECEIPT,
			}),
		).rejects.toThrow(/capability is disabled/i);
		await expect(
			fixture.t.mutation(importDrafts, {
				plan: fixture.plan,
				digest: fixture.digest,
			}),
		).rejects.toThrow(/capability is disabled/i);
		await expect(
			fixture.t.mutation(publishDrafts, {
				plan: fixture.plan,
				digest: fixture.digest,
			}),
		).rejects.toThrow(/capability is disabled/i);
		await expect(
			fixture.t.mutation(restorePinned, {
				siteUrl: SITE,
				operationId: "disabled-restore",
				entries: [],
			}),
		).rejects.toThrow(/capability is disabled/i);
		expect(await pair(fixture)).toEqual([]);
		expect(await revisionCount(fixture)).toBe(0);
	});

	test("imports exactly one atomic unpublished pair and makes exact replay zero-write", async () => {
		const fixture = await setup();
		const imported = await runImport(fixture);
		const attestedReplay = await fixture.t.run(async (ctx) =>
			await attestAboutContactMediaSource(ctx, {
				siteUrl: SITE,
				mediaAssetId: fixture.plan.decisionSet.aboutPortrait.targetMediaAssetId,
				workerAssetId: ASSET_UUID,
				sourceSha256: "0e94b665f7654c74158daf3aa2c497139c5cb7c4490d72205cfa3babd6dc4eb0",
				sourceWidth: 1440,
				sourceHeight: 2160,
				receiptDigest: MEDIA_RECEIPT,
			}),
		);
		expect(attestedReplay.status).toBe("identical-replay");
		await expect(
			fixture.t.run(async (ctx) =>
				await attestAboutContactMediaSource(ctx, {
					siteUrl: SITE,
					mediaAssetId: fixture.plan.decisionSet.aboutPortrait.targetMediaAssetId,
					workerAssetId: ASSET_UUID,
					sourceSha256: "0e94b665f7654c74158daf3aa2c497139c5cb7c4490d72205cfa3babd6dc4eb0",
					sourceWidth: 1440,
					sourceHeight: 2160,
					receiptDigest: "c".repeat(64),
				}),
			),
		).rejects.toThrow(/different immutable attestation/i);
		const documents = await pair(fixture);
		expect(imported).toMatchObject({ status: "imported", digest: fixture.digest });
		expect(documents).toHaveLength(2);
		expect(new Set(documents.map(({ createdAt }) => createdAt)).size).toBe(1);
		for (const document of documents) {
			expect(document.draftRevisionId).toBeDefined();
			expect(document.publishedRevisionId).toBeUndefined();
			expect(document.publishedAt).toBeUndefined();
		}
		const replay = await runImport(fixture);
		expect(replay).toMatchObject({
			status: "identical-replay",
			digest: fixture.digest,
			documents: imported.documents,
		});
		expect(await revisionCount(fixture)).toBe(2);

		const partial = await setup();
		await partial.t.run(async (ctx) => {
			await ctx.db.insert("contentDocuments", {
				siteUrl: SITE,
				kind: "aboutPage",
				createdAt: 1,
				createdBy: "fixture",
				updatedAt: 1,
				updatedBy: "fixture",
			});
		});
		await expect(runImport(partial)).rejects.toThrow(/partial state/i);
		expect(await pair(partial)).toHaveLength(1);
		expect(await revisionCount(partial)).toBe(0);

		const wrongReceipt = await setup();
		await wrongReceipt.t.run(async (ctx) => {
			const asset = (await ctx.db.query("mediaAssets").collect())[0];
			if (!asset) throw new Error("Receipt fixture asset is missing");
			await ctx.db.patch(asset._id, {
				source: { ...asset.source, sha256: "f".repeat(64) },
			});
		});
		await expect(runImport(wrongReceipt)).rejects.toThrow(/media receipt/i);
		expect(await pair(wrongReceipt)).toEqual([]);
		expect(await revisionCount(wrongReceipt)).toBe(0);
	});

	test("atomically publishes, CAS-restores, and exactly replays the pair", async () => {
		const invalidRestore = await setup();
		await runImport(invalidRestore);
		await runPublish(invalidRestore);
		const invalidAbout = await invalidRestore.admin.mutation(
			api.content.saveAboutPageDraft,
			{
				siteUrl: SITE,
				payload: {
					...invalidRestore.plan.entries[0].payload,
					introduction: undefined,
					biography: "Still generically publishable, but not renderable by this host.",
				},
			},
		);
		await invalidRestore.admin.mutation(api.content.saveAboutPageDraft, {
			siteUrl: SITE,
			expectedDraftRevisionId: invalidAbout.revisionId,
			payload: invalidRestore.plan.entries[0].payload,
		});
		const invalidEntries = (await pair(invalidRestore)).map((document) =>
			restoreEntry(
				document,
				document.kind === "aboutPage"
					? invalidAbout.revisionId
					: document.publishedRevisionId as Id<"contentRevisions">,
			),
		);
		const invalidCount = await revisionCount(invalidRestore);
		await expect(
			runRestore(invalidRestore, {
				siteUrl: SITE,
				operationId: "invalid-host-shape-v1",
				entries: invalidEntries,
			}),
		).rejects.toThrow(/one portrait and an introduction/i);
		expect(await revisionCount(invalidRestore)).toBe(invalidCount);

		const fixture = await setup();
		const imported = await runImport(fixture);
		for (const document of imported.documents) {
			const mutation = document.kind === "aboutPage"
				? api.content.publishAboutPage
				: api.content.publishContactPage;
			await expect(
				fixture.admin.mutation(mutation, {
					siteUrl: SITE,
					draftRevisionId: document.revisionId,
				}),
			).rejects.toThrow(/fixed-pair publication/i);
		}
		expect((await pair(fixture)).every(({ publishedRevisionId }) => !publishedRevisionId)).toBe(
			true,
		);
		const source = new Map(
			imported.documents.map(({ kind, revisionId }) => [kind, revisionId]),
		);
		const published = await runPublish(fixture);
		expect(published).toMatchObject({
			status: "published",
			digest: fixture.digest,
			documents: imported.documents,
		});
		const publishedPair = await pair(fixture);
		expect(new Set(publishedPair.map(({ publishedAt }) => publishedAt)).size).toBe(1);
		for (const document of publishedPair) {
			expect(document.draftRevisionId).toBeUndefined();
			expect(document.publishedRevisionId).toBeDefined();
		}
		expect(await runPublish(fixture)).toEqual({
			...published,
			status: "identical-replay",
		});
		expect(await revisionCount(fixture)).toBe(2);
		const changedAbout = await fixture.admin.mutation(
			api.content.saveAboutPageDraft,
			{
				siteUrl: SITE,
				payload: { ...fixture.plan.entries[0].payload, heading: "Changed About" },
			},
		);
		await fixture.admin.mutation(api.content.publishAboutPage, {
			siteUrl: SITE,
			draftRevisionId: changedAbout.revisionId,
		});
		const changedContact = await fixture.admin.mutation(
			api.content.saveContactPageDraft,
			{
				siteUrl: SITE,
				payload: {
					...fixture.plan.entries[1].payload,
					heading: "Changed Contact",
				},
			},
		);
		await fixture.admin.mutation(api.content.publishContactPage, {
			siteUrl: SITE,
			draftRevisionId: changedContact.revisionId,
		});

		const entries = (await pair(fixture)).map((document) => {
			const sourceRevisionId = source.get(document.kind);
			if (!sourceRevisionId) throw new Error("Source fixture is missing");
			return restoreEntry(document, sourceRevisionId);
		});
		const before = await revisionCount(fixture);
		const stale = structuredClone(entries);
		stale[0]!.expected.updatedAt += 1;
		await expect(
			runRestore(fixture, {
				siteUrl: SITE,
				operationId: "stale-about-contact-v1",
				entries: stale,
			}),
		).rejects.toThrow(/pinned restore conflict/i);
		expect(await revisionCount(fixture)).toBe(before);

		const args = {
			siteUrl: SITE,
			operationId: "restore-about-contact-v1",
			entries,
		};
		const restored = await runRestore(fixture, args);
		expect(restored.status).toBe("restored");
		expect(restored.documents).toHaveLength(2);
		expect(await revisionCount(fixture)).toBe(before + 2);
		for (const result of restored.documents) {
			const document = await fixture.t.run(
				async (ctx) => await ctx.db.get(result.documentId),
			);
			expect(document).toMatchObject({
				publishedRevisionId: result.restoredRevisionId,
				publishedAt: restored.restoredAt,
				publishedBy: "operator:about-contact-pinned-restore",
				updatedAt: restored.restoredAt,
				updatedBy: "operator:about-contact-pinned-restore",
			});
			expect(document?.draftRevisionId).toBeUndefined();
		}
		const replay = await runRestore(fixture, args);
		expect(replay).toEqual({ ...restored, status: "identical-replay" });
		expect(await revisionCount(fixture)).toBe(before + 2);
	});
});
