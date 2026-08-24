import type { Infer } from "convex/values";
import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { requireRestoreOperationId } from "./contentRevisionProvenance";
import {
	assertRevisionOwnership,
	checksumPortfolioDraft,
	getPortfolioPlacements,
	portfolioDraftFromRevision,
	requireReadyPortfolioAssets,
	requireReadyPortfolioSeoAsset,
} from "./portfolioData";
import {
	canonicalPortfolioJson,
	digestPortfolioPreservedTargetActor,
	requirePortfolioMigrationPlan,
	type PortfolioMigrationEntry,
	type PortfolioMigrationPlan,
} from "./portfolioMigrationPlan";
import {
	PORTFOLIO_GALLERY_MAX,
	serializePortfolioGalleryDraft,
	toPublishedImportedPortfolioGallery,
	toPublishedPortfolioGallery,
} from "./portfolioValidators";

const IMPORT_ACTOR_PREFIX = "sanityImport:portfolio:";
const PUBLISH_ACTOR_PREFIX = "sanityPublish:portfolio:";
const MEDIA_ACTOR_PREFIX = "sanityImport:portfolio-media:";
const RESTORE_ACTOR = "operator:portfolio-pinned-restore";
const RESTORE_CONFLICT = "Portfolio pinned restore conflict: rebuild the exact restore request";
const SHA256 = /^[a-f0-9]{64}$/;

const nullableRevisionValidator = v.union(v.id("portfolioGalleryRevisions"), v.null());

export const portfolioPinnedRestoreEntryValidator = v.object({
	galleryId: v.id("portfolioGalleries"),
	sourceRevisionId: v.id("portfolioGalleryRevisions"),
	sourcePortfolioOrder: v.number(),
	sourceIsVisible: v.boolean(),
	expected: v.object({
		draftRevisionId: nullableRevisionValidator,
		publishedRevisionId: v.id("portfolioGalleryRevisions"),
		slug: v.string(),
		portfolioOrder: v.number(),
		isVisible: v.boolean(),
		publishedAt: v.number(),
		publishedBy: v.string(),
		updatedAt: v.number(),
		updatedBy: v.string(),
	}),
});

export type PortfolioPinnedRestoreEntry = Infer<typeof portfolioPinnedRestoreEntryValidator>;

type ImportState = {
	gallery: Doc<"portfolioGalleries">;
	revision: Doc<"portfolioGalleryRevisions">;
	placements: Doc<"portfolioPlacements">[];
};

function conflict(): never {
	throw new Error(RESTORE_CONFLICT);
}

async function requireTenant(ctx: MutationCtx, siteUrl: string) {
	const tenant = await ctx.db
		.query("platformClients")
		.withIndex("by_siteUrl", (q) => q.eq("siteUrl", siteUrl))
		.unique();
	if (!tenant) throw new Error("Portfolio migration tenant does not exist");
}

function importActor(digest: string) {
	return `${IMPORT_ACTOR_PREFIX}${digest}`;
}

function publishActor(digest: string) {
	return `${PUBLISH_ACTOR_PREFIX}${digest}`;
}

function mediaActor(digest: string) {
	return `${MEDIA_ACTOR_PREFIX}${digest}`;
}

export function isInitialSanityPortfolioImport(
	gallery: Doc<"portfolioGalleries"> | null,
) {
	return Boolean(
		gallery
		&& gallery.createdBy.startsWith(IMPORT_ACTOR_PREFIX)
		&& !gallery.publishedRevisionId,
	);
}

function migrationDraft(entry: PortfolioMigrationEntry) {
	return {
		title: entry.draft.title,
		description: entry.draft.description,
		slug: entry.draft.slug,
		placements: entry.draft.placements.map((placement) => ({
			key: placement.key,
			assetId: placement.assetId,
			altText: placement.altText,
			focalPoint: placement.focalPoint,
		})),
	};
}

function acceptedLegacyMissingAltKeys(entry: PortfolioMigrationEntry) {
	return new Set(
		entry.draft.placements
			.filter((placement) => placement.sourceAltState === "absent")
			.map((placement) => placement.key),
	);
}

async function migrationChecksum(entry: PortfolioMigrationEntry) {
	return await checksumPortfolioDraft(serializePortfolioGalleryDraft(migrationDraft(entry)));
}

async function requireExactPreservedTargetGallery(
	ctx: MutationCtx,
	plan: PortfolioMigrationPlan,
	galleries: Doc<"portfolioGalleries">[],
) {
	const expected = plan.preservedTargetGallery;
	const preserved = galleries.filter((gallery) =>
		!gallery.createdBy.startsWith(IMPORT_ACTOR_PREFIX)
	);
	const gallery = preserved[0];
	if (preserved.length !== 1 || !gallery) {
		throw new Error("Preserved Portfolio target gallery changed");
	}
	const [createdByDigest, updatedByDigest] = await Promise.all([
		digestPortfolioPreservedTargetActor(
			plan.siteUrl,
			"gallery-created-by",
			gallery.createdBy,
		),
		digestPortfolioPreservedTargetActor(
			plan.siteUrl,
			"gallery-updated-by",
			gallery.updatedBy,
		),
	]);
	if (
		gallery._id !== expected.galleryId
		|| gallery.siteUrl !== plan.siteUrl
		|| gallery.slug !== expected.slug
		|| gallery.portfolioOrder !== expected.portfolioOrder
		|| gallery.isPublished !== expected.isPublished
		|| (gallery.isVisible === undefined ? null : gallery.isVisible) !== expected.isVisible
		|| (gallery.sourceDocumentId === undefined ? null : gallery.sourceDocumentId)
			!== expected.sourceDocumentId
		|| gallery.draftRevisionId !== expected.draftRevisionId
		|| (gallery.publishedRevisionId ?? null) !== expected.publishedRevisionId
		|| gallery.createdAt !== expected.createdAt
		|| createdByDigest !== expected.createdByDigest
		|| gallery.updatedAt !== expected.updatedAt
		|| updatedByDigest !== expected.updatedByDigest
		|| (gallery.publishedAt ?? null) !== expected.publishedAt
		|| (gallery.publishedBy ?? null) !== expected.publishedBy
	) throw new Error("Preserved Portfolio target gallery changed");
	const revisions = await ctx.db
		.query("portfolioGalleryRevisions")
		.withIndex("by_galleryId_and_createdAt", (q) => q.eq("galleryId", gallery._id))
		.take(2);
	const revision = revisions[0];
	if (revisions.length !== 1 || !revision) {
		throw new Error("Preserved Portfolio target revision changed");
	}
	const revisionCreatedByDigest = await digestPortfolioPreservedTargetActor(
		plan.siteUrl,
		"revision-created-by",
		revision.createdBy,
	);
	if (
		revision._id !== expected.revision.revisionId
		|| revision.siteUrl !== plan.siteUrl
		|| revision.galleryId !== gallery._id
		|| revision.schemaVersion !== 1
		|| revision.slug !== gallery.slug
		|| revision.checksum !== expected.revision.checksum
		|| revision.source !== "admin"
		|| revision.createdAt !== expected.revision.createdAt
		|| revisionCreatedByDigest !== expected.revision.createdByDigest
		|| revision.seoDescription !== undefined
		|| revision.seoOgImageAssetId !== undefined
		|| revision.seoOgSourceAssetRef !== undefined
		|| revision.sourceDocumentRevision !== undefined
		|| revision.restoredFromRevisionId !== undefined
		|| revision.restoreOperationId !== undefined
		|| revision.restoreRequestDigest !== undefined
	) throw new Error("Preserved Portfolio target revision changed");
	const placements = await getPortfolioPlacements(ctx, revision._id);
	const draft = portfolioDraftFromRevision(revision, placements);
	if (
		revision.placementCount !== placements.length
		|| revision.checksum !== await checksumPortfolioDraft(
			serializePortfolioGalleryDraft(draft),
		)
	) throw new Error("Preserved Portfolio target checksum changed");
	return { gallery, revision };
}

async function requirePlanMedia(
	ctx: MutationCtx,
	plan: PortfolioMigrationPlan,
	digest: string,
) {
	const assets = await Promise.all(
		plan.mediaMappings.map((mapping) => ctx.db.get(mapping.targetMediaAssetId)),
	);
	for (const [index, mapping] of plan.mediaMappings.entries()) {
		const asset = assets[index];
		if (
			!asset
			|| asset.siteUrl !== plan.siteUrl
			|| asset.intent !== "web"
			|| asset.status !== "ready"
			|| asset.assetId !== mapping.targetWorkerAssetId
			|| asset.source.contentType !== "image/webp"
			|| asset.source.sha256 !== mapping.transferSha256
			|| asset.source.sizeBytes !== mapping.transferSizeBytes
			|| asset.source.width !== mapping.transferWidth
			|| asset.source.height !== mapping.transferHeight
			|| asset.updatedBy !== mediaActor(digest)
		) throw new Error("Portfolio media target does not match its accepted receipt");
	}
}

/** Receipt-bound, one-way source hash attestation for the exact media manifest. */
export async function attestPortfolioMediaSources(
	ctx: MutationCtx,
	args: { plan: PortfolioMigrationPlan; digest: string },
) {
	const digest = await requirePortfolioMigrationPlan(args.plan, args.digest);
	await requireTenant(ctx, args.plan.siteUrl);
	const actor = mediaActor(digest);
	let attested = 0;
	for (const mapping of args.plan.mediaMappings) {
		const asset = await ctx.db.get(mapping.targetMediaAssetId);
		if (
			!asset
			|| asset.siteUrl !== args.plan.siteUrl
			|| asset.intent !== "web"
			|| asset.status !== "ready"
			|| asset.assetId !== mapping.targetWorkerAssetId
			|| asset.source.contentType !== "image/webp"
			|| asset.source.sizeBytes !== mapping.transferSizeBytes
			|| asset.source.width !== mapping.transferWidth
			|| asset.source.height !== mapping.transferHeight
		) throw new Error("Portfolio media attestation target does not match its receipt");
		if (asset.source.sha256 !== undefined && asset.source.sha256 !== mapping.transferSha256) {
			throw new Error("Portfolio media source SHA-256 conflicts with its receipt");
		}
		if (asset.updatedBy.startsWith(MEDIA_ACTOR_PREFIX) && asset.updatedBy !== actor) {
			throw new Error("Portfolio media asset already has a different immutable attestation");
		}
		if (asset.source.sha256 === mapping.transferSha256 && asset.updatedBy === actor) continue;
		await ctx.db.patch(asset._id, {
			source: { ...asset.source, sha256: mapping.transferSha256 },
			updatedAt: Date.now(),
			updatedBy: actor,
		});
		attested += 1;
	}
	return {
		status: attested === 0 ? "identical-replay" as const : "attested" as const,
		digest,
		mediaCount: args.plan.mediaMappings.length,
		attestedCount: attested,
	};
}

async function loadExactImportState(
	ctx: MutationCtx,
	plan: PortfolioMigrationPlan,
	digest: string,
	entry: PortfolioMigrationEntry,
) {
	const actor = importActor(digest);
	const gallery = await ctx.db
		.query("portfolioGalleries")
		.withIndex("by_siteUrl_and_sourceDocumentId", (q) =>
			q.eq("siteUrl", plan.siteUrl).eq("sourceDocumentId", entry.sourceId),
		)
		.unique();
	if (
		!gallery
		|| gallery.slug !== entry.draft.slug
		|| gallery.portfolioOrder !== entry.portfolioOrder
		|| gallery.isVisible !== entry.targetIsVisible
		|| gallery.sourceDocumentId !== entry.sourceId
		|| gallery.createdBy !== actor
	) throw new Error("Existing Portfolio import identity changed");
	const revisions = await ctx.db
		.query("portfolioGalleryRevisions")
		.withIndex("by_galleryId_and_createdAt", (q) => q.eq("galleryId", gallery._id))
		.take(2);
	if (revisions.length !== 1) throw new Error("Existing Portfolio import history changed");
	const revision = revisions[0];
	const checksum = await migrationChecksum(entry);
	if (
		!revision
		|| revision.siteUrl !== plan.siteUrl
		|| revision.galleryId !== gallery._id
		|| revision.schemaVersion !== 1
		|| revision.title !== entry.draft.title
		|| revision.description !== entry.draft.description
		|| revision.slug !== entry.draft.slug
		|| revision.seoDescription !== entry.draft.seoDescription
		|| revision.seoOgImageAssetId !== entry.draft.seoOgImageAssetId
		|| revision.seoOgSourceAssetRef !== entry.draft.seoOgSourceAssetRef
		|| revision.sourceDocumentRevision !== entry.sourceRevision
		|| revision.placementCount !== entry.draft.placements.length
		|| revision.checksum !== checksum
		|| revision.source !== "sanityImport"
		|| revision.createdBy !== actor
		|| revision.restoredFromRevisionId !== undefined
		|| revision.restoreOperationId !== undefined
		|| revision.restoreRequestDigest !== undefined
	) throw new Error("Existing Portfolio import revision changed");
	const placements = await getPortfolioPlacements(ctx, revision._id);
	if (placements.length !== entry.draft.placements.length) {
		throw new Error("Existing Portfolio import placement count changed");
	}
	for (const [index, expected] of entry.draft.placements.entries()) {
		const placement = placements[index];
		if (
			!placement
			|| placement.siteUrl !== plan.siteUrl
			|| placement.galleryId !== gallery._id
			|| placement.revisionId !== revision._id
			|| placement.assetId !== expected.assetId
			|| placement.placementKey !== expected.key
			|| placement.order !== index
			|| placement.altText !== expected.altText
			|| placement.sourceAltAbsent !== (
				expected.sourceAltState === "absent" ? true : undefined
			)
			|| placement.caption !== undefined
			|| canonicalPortfolioJson(placement.focalPoint ?? null)
				!== canonicalPortfolioJson(expected.focalPoint ?? null)
			|| placement.sourceAssetRef !== expected.sourceAssetRef
			|| placement.sourceCropCanonical !== expected.sourceCropCanonical
			|| placement.sourceHotspotCanonical !== expected.sourceHotspotCanonical
		) throw new Error("Existing Portfolio import placement changed");
	}
	return { gallery, revision, placements } satisfies ImportState;
}

async function loadAllExactImportStates(
	ctx: MutationCtx,
	plan: PortfolioMigrationPlan,
	digest: string,
) {
	const galleries = await ctx.db
		.query("portfolioGalleries")
		.withIndex("by_siteUrl_and_portfolioOrder", (q) => q.eq("siteUrl", plan.siteUrl))
		.take(PORTFOLIO_GALLERY_MAX + 1);
	if (galleries.length > PORTFOLIO_GALLERY_MAX) {
		throw new Error("Existing Portfolio gallery limit exceeded");
	}
	await requireExactPreservedTargetGallery(ctx, plan, galleries);
	const imported = galleries.filter((gallery) =>
		gallery.createdBy.startsWith(IMPORT_ACTOR_PREFIX)
	);
	if (
		galleries.length !== plan.entries.length + 1
		|| imported.length !== plan.entries.length
	) {
		throw new Error("Existing Portfolio import graph is partial or has an extra publication");
	}
	return await Promise.all(
		plan.entries.map((entry) => loadExactImportState(ctx, plan, digest, entry)),
	);
}

/** Atomically import or exactly replay one fixed unpublished Portfolio graph. */
export async function importSanityPortfolioDrafts(
	ctx: MutationCtx,
	args: { plan: PortfolioMigrationPlan; digest: string },
) {
	const digest = await requirePortfolioMigrationPlan(args.plan, args.digest);
	await requireTenant(ctx, args.plan.siteUrl);
	await requirePlanMedia(ctx, args.plan, digest);
	const existing = await ctx.db
		.query("portfolioGalleries")
		.withIndex("by_siteUrl_and_portfolioOrder", (q) => q.eq("siteUrl", args.plan.siteUrl))
		.take(PORTFOLIO_GALLERY_MAX + 1);
	if (existing.length > PORTFOLIO_GALLERY_MAX) {
		throw new Error("Existing Portfolio gallery limit exceeded");
	}
	await requireExactPreservedTargetGallery(ctx, args.plan, existing);
	const sourceIds = new Set(args.plan.entries.map((entry) => entry.sourceId));
	const related = existing.filter((gallery) =>
		gallery.createdBy.startsWith(IMPORT_ACTOR_PREFIX)
		|| (gallery.sourceDocumentId !== undefined && sourceIds.has(gallery.sourceDocumentId))
	);
	if (related.length > 0) {
		const states = await loadAllExactImportStates(ctx, args.plan, digest);
		if (states.some(({ gallery, revision }) =>
			gallery.isPublished
			|| gallery.draftRevisionId !== revision._id
			|| gallery.publishedRevisionId !== undefined
			|| gallery.publishedAt !== undefined
			|| gallery.publishedBy !== undefined
			|| gallery.updatedAt !== gallery.createdAt
			|| gallery.updatedBy !== importActor(digest)
		)) throw new Error("Existing Portfolio import is not an untouched draft graph");
		return {
			status: "identical-replay" as const,
			digest,
			entries: states.map(({ gallery, revision }) => ({
				galleryId: gallery._id,
				revisionId: revision._id,
			})),
		};
	}
	if (
		existing.length + args.plan.entries.length > PORTFOLIO_GALLERY_MAX
		|| existing.some((gallery) =>
			args.plan.entries.some((entry) => entry.draft.slug === gallery.slug)
		)
	) throw new Error("Portfolio import conflicts with existing target content");

	const actor = importActor(digest);
	const now = Date.now();
	const entries: Array<{
		galleryId: Id<"portfolioGalleries">;
		revisionId: Id<"portfolioGalleryRevisions">;
	}> = [];
	for (const entry of args.plan.entries) {
		const draft = migrationDraft(entry);
		toPublishedImportedPortfolioGallery(draft, acceptedLegacyMissingAltKeys(entry));
		await requireReadyPortfolioAssets(ctx, args.plan.siteUrl, draft.placements);
		await requireReadyPortfolioSeoAsset(ctx, args.plan.siteUrl, entry.draft.seoOgImageAssetId);
		const galleryId = await ctx.db.insert("portfolioGalleries", {
			siteUrl: args.plan.siteUrl,
			slug: entry.draft.slug,
			portfolioOrder: entry.portfolioOrder,
			isPublished: false,
			isVisible: entry.targetIsVisible,
			sourceDocumentId: entry.sourceId,
			createdAt: now,
			createdBy: actor,
			updatedAt: now,
			updatedBy: actor,
		});
		const revisionId = await ctx.db.insert("portfolioGalleryRevisions", {
			siteUrl: args.plan.siteUrl,
			galleryId,
			schemaVersion: 1,
			title: entry.draft.title,
			description: entry.draft.description,
			slug: entry.draft.slug,
			seoDescription: entry.draft.seoDescription,
			seoOgImageAssetId: entry.draft.seoOgImageAssetId,
			seoOgSourceAssetRef: entry.draft.seoOgSourceAssetRef,
			sourceDocumentRevision: entry.sourceRevision,
			placementCount: entry.draft.placements.length,
			checksum: await migrationChecksum(entry),
			source: "sanityImport",
			createdAt: now,
			createdBy: actor,
		});
		for (const [order, placement] of entry.draft.placements.entries()) {
			await ctx.db.insert("portfolioPlacements", {
				siteUrl: args.plan.siteUrl,
				galleryId,
				revisionId,
				assetId: placement.assetId,
				placementKey: placement.key,
				order,
				altText: placement.altText,
				sourceAltAbsent: placement.sourceAltState === "absent" ? true : undefined,
				focalPoint: placement.focalPoint,
				sourceAssetRef: placement.sourceAssetRef,
				sourceCropCanonical: placement.sourceCropCanonical,
				sourceHotspotCanonical: placement.sourceHotspotCanonical,
			});
		}
		await ctx.db.patch(galleryId, { draftRevisionId: revisionId });
		entries.push({ galleryId, revisionId });
	}
	return { status: "imported" as const, digest, entries };
}

/** Atomically publish or exactly replay the full fixed imported graph. */
export async function publishSanityPortfolioDrafts(
	ctx: MutationCtx,
	args: { plan: PortfolioMigrationPlan; digest: string },
) {
	const digest = await requirePortfolioMigrationPlan(args.plan, args.digest);
	await requireTenant(ctx, args.plan.siteUrl);
	await requirePlanMedia(ctx, args.plan, digest);
	const states = await loadAllExactImportStates(ctx, args.plan, digest);
	const actor = publishActor(digest);
	const replay = states.every(({ gallery, revision }) =>
		gallery.isPublished
		&& gallery.draftRevisionId === revision._id
		&& gallery.publishedRevisionId === revision._id
		&& gallery.publishedAt !== undefined
		&& gallery.publishedBy === actor
		&& gallery.updatedAt === gallery.publishedAt
		&& gallery.updatedBy === actor
	);
	if (replay) {
		const publishedAt = states[0]?.gallery.publishedAt;
		if (
			publishedAt === undefined
			|| states.some(({ gallery }) => gallery.publishedAt !== publishedAt)
		) throw new Error("Existing Portfolio publication timestamps diverged");
		return {
			status: "identical-replay" as const,
			digest,
			publishedAt,
			entries: states.map(({ gallery, revision }) => ({
				galleryId: gallery._id,
				revisionId: revision._id,
			})),
		};
	}
	if (states.some(({ gallery, revision }) =>
		gallery.isPublished
		|| gallery.draftRevisionId !== revision._id
		|| gallery.publishedRevisionId !== undefined
		|| gallery.publishedAt !== undefined
		|| gallery.publishedBy !== undefined
		|| gallery.updatedAt !== gallery.createdAt
		|| gallery.updatedBy !== importActor(digest)
	)) throw new Error("Portfolio publication target changed");

	const publishedAt = Date.now();
	for (const { gallery, revision } of states) {
		await ctx.db.patch(gallery._id, {
			draftRevisionId: revision._id,
			publishedRevisionId: revision._id,
			isPublished: true,
			publishedAt,
			publishedBy: actor,
			updatedAt: publishedAt,
			updatedBy: actor,
		});
	}
	return {
		status: "published" as const,
		digest,
		publishedAt,
		entries: states.map(({ gallery, revision }) => ({
			galleryId: gallery._id,
			revisionId: revision._id,
		})),
	};
}

function validateRestoreEntries(entries: PortfolioPinnedRestoreEntry[]) {
	if (entries.length < 1 || entries.length > PORTFOLIO_GALLERY_MAX) conflict();
	const galleries = new Set<string>();
	const expectedOrders = new Set<number>();
	const sourceOrders = new Set<number>();
	for (const entry of entries) {
		if (
			galleries.has(entry.galleryId)
			|| expectedOrders.has(entry.expected.portfolioOrder)
			|| sourceOrders.has(entry.sourcePortfolioOrder)
			|| !Number.isSafeInteger(entry.expected.portfolioOrder)
			|| entry.expected.portfolioOrder < 0
			|| !Number.isSafeInteger(entry.sourcePortfolioOrder)
			|| entry.sourcePortfolioOrder < 0
			|| !Number.isSafeInteger(entry.expected.publishedAt)
			|| !Number.isSafeInteger(entry.expected.updatedAt)
			|| !entry.expected.publishedBy
			|| !entry.expected.updatedBy
		) conflict();
		galleries.add(entry.galleryId);
		expectedOrders.add(entry.expected.portfolioOrder);
		sourceOrders.add(entry.sourcePortfolioOrder);
	}
	return [...entries].sort((left, right) =>
		left.expected.portfolioOrder - right.expected.portfolioOrder
	);
}

export async function digestPortfolioRestoreRequest(
	siteUrl: string,
	operationId: string,
	entries: PortfolioPinnedRestoreEntry[],
) {
	requireRestoreOperationId(operationId);
	const normalized = validateRestoreEntries(entries);
	return await checksumPortfolioDraft(canonicalPortfolioJson({
		siteUrl,
		operationId,
		entries: normalized,
	}));
}

async function requirePublishableRevision(
	ctx: MutationCtx,
	gallery: Doc<"portfolioGalleries">,
	revisionId: Id<"portfolioGalleryRevisions">,
) {
	const revision = await ctx.db.get(revisionId);
	if (!revision) throw new Error("Portfolio pinned revision not found");
	assertRevisionOwnership(revision, gallery);
	const placements = await getPortfolioPlacements(ctx, revision._id);
	const draft = portfolioDraftFromRevision(revision, placements);
	if (revision.source === "admin") {
		toPublishedPortfolioGallery(draft);
	} else {
		toPublishedImportedPortfolioGallery(
			draft,
			new Set(
				placements
					.filter((placement) => placement.sourceAltAbsent === true)
					.map((placement) => placement.placementKey),
			),
		);
	}
	if (
		revision.placementCount !== placements.length
		|| revision.checksum !== await checksumPortfolioDraft(serializePortfolioGalleryDraft(draft))
	) throw new Error("Portfolio pinned revision checksum mismatch");
	await requireReadyPortfolioAssets(ctx, gallery.siteUrl, draft.placements);
	await requireReadyPortfolioSeoAsset(ctx, gallery.siteUrl, revision.seoOgImageAssetId);
	return { revision, placements, draft };
}

function assertRestoreCas(
	gallery: Doc<"portfolioGalleries">,
	entry: PortfolioPinnedRestoreEntry,
) {
	const expected = entry.expected;
	if (
		gallery.slug !== expected.slug
		|| gallery.portfolioOrder !== expected.portfolioOrder
		|| gallery.isVisible !== expected.isVisible
		|| !gallery.isPublished
		|| gallery.draftRevisionId !== (expected.draftRevisionId ?? undefined)
		|| gallery.publishedRevisionId !== expected.publishedRevisionId
		|| gallery.publishedAt !== expected.publishedAt
		|| gallery.publishedBy !== expected.publishedBy
		|| gallery.updatedAt !== expected.updatedAt
		|| gallery.updatedBy !== expected.updatedBy
	) conflict();
}

function restoredDraftRevisionId(
	entry: PortfolioPinnedRestoreEntry,
	restoredRevisionId: Id<"portfolioGalleryRevisions">,
) {
	return entry.expected.draftRevisionId === entry.expected.publishedRevisionId
		? restoredRevisionId
		: entry.expected.draftRevisionId ?? undefined;
}

function samePlacement(
	left: Doc<"portfolioPlacements">,
	right: Doc<"portfolioPlacements">,
) {
	return canonicalPortfolioJson({
		assetId: left.assetId,
		placementKey: left.placementKey,
		order: left.order,
		altText: left.altText ?? null,
		caption: left.caption ?? null,
		focalPoint: left.focalPoint ?? null,
		sourceAssetRef: left.sourceAssetRef ?? null,
		sourceAltAbsent: left.sourceAltAbsent ?? null,
		sourceCropCanonical: left.sourceCropCanonical ?? null,
		sourceHotspotCanonical: left.sourceHotspotCanonical ?? null,
	}) === canonicalPortfolioJson({
		assetId: right.assetId,
		placementKey: right.placementKey,
		order: right.order,
		altText: right.altText ?? null,
		caption: right.caption ?? null,
		focalPoint: right.focalPoint ?? null,
		sourceAssetRef: right.sourceAssetRef ?? null,
		sourceAltAbsent: right.sourceAltAbsent ?? null,
		sourceCropCanonical: right.sourceCropCanonical ?? null,
		sourceHotspotCanonical: right.sourceHotspotCanonical ?? null,
	});
}

function sameRevisionContent(
	left: Doc<"portfolioGalleryRevisions">,
	right: Doc<"portfolioGalleryRevisions">,
) {
	return left.schemaVersion === right.schemaVersion
		&& left.title === right.title
		&& left.description === right.description
		&& left.slug === right.slug
		&& left.seoDescription === right.seoDescription
		&& left.seoOgImageAssetId === right.seoOgImageAssetId
		&& left.seoOgSourceAssetRef === right.seoOgSourceAssetRef
		&& left.sourceDocumentRevision === right.sourceDocumentRevision
		&& left.placementCount === right.placementCount
		&& left.checksum === right.checksum;
}

async function exactRestoreReplay(
	ctx: MutationCtx,
	args: {
		siteUrl: string;
		operationId: string;
		digest: string;
		entries: PortfolioPinnedRestoreEntry[];
	},
) {
	const rows = await ctx.db
		.query("portfolioGalleryRevisions")
		.withIndex("by_siteUrl_and_restoreOperationId", (q) =>
			q.eq("siteUrl", args.siteUrl).eq("restoreOperationId", args.operationId),
		)
		.take(PORTFOLIO_GALLERY_MAX + 1);
	if (rows.length === 0) return null;
	if (rows.length !== args.entries.length) conflict();
	const rowByGallery = new Map(rows.map((row) => [row.galleryId, row]));
	let restoredAt: number | undefined;
	for (const entry of args.entries) {
		const [gallery, row] = [await ctx.db.get(entry.galleryId), rowByGallery.get(entry.galleryId)];
		if (
			!gallery
			|| !row
			|| !gallery.isPublished
			|| row.source !== "restore"
			|| row.createdBy !== RESTORE_ACTOR
			|| row.restoredFromRevisionId !== entry.sourceRevisionId
			|| row.restoreOperationId !== args.operationId
			|| row.restoreRequestDigest !== args.digest
			|| gallery.draftRevisionId !== restoredDraftRevisionId(entry, row._id)
			|| gallery.publishedRevisionId !== row._id
			|| gallery.slug !== row.slug
			|| gallery.portfolioOrder !== entry.sourcePortfolioOrder
			|| gallery.isVisible !== entry.sourceIsVisible
			|| gallery.publishedAt !== row.createdAt
			|| gallery.publishedBy !== RESTORE_ACTOR
			|| gallery.updatedAt !== row.createdAt
			|| gallery.updatedBy !== RESTORE_ACTOR
		) conflict();
		if (restoredAt !== undefined && restoredAt !== row.createdAt) conflict();
		restoredAt = row.createdAt;
		const [source, restored] = await Promise.all([
			requirePublishableRevision(ctx, gallery, entry.sourceRevisionId),
			requirePublishableRevision(ctx, gallery, row._id),
		]);
		if (
			!sameRevisionContent(source.revision, restored.revision)
			|| source.placements.length !== restored.placements.length
			|| source.placements.some((placement, index) =>
				!restored.placements[index] || !samePlacement(placement, restored.placements[index])
			)
		) conflict();
	}
	if (restoredAt === undefined) conflict();
	return { status: "identical-replay" as const, operationId: args.operationId, restoredAt };
}

/** Atomically republish new immutable revisions from one exact pinned graph. */
export async function restorePinnedPortfolioRevisions(
	ctx: MutationCtx,
	args: {
		siteUrl: string;
		operationId: string;
		entries: PortfolioPinnedRestoreEntry[];
	},
) {
	await requireTenant(ctx, args.siteUrl);
	const entries = validateRestoreEntries(args.entries);
	const siteGalleries = await ctx.db
		.query("portfolioGalleries")
		.withIndex("by_siteUrl_and_isPublished_and_portfolioOrder", (q) =>
			q.eq("siteUrl", args.siteUrl).eq("isPublished", true),
		)
		.take(PORTFOLIO_GALLERY_MAX + 1);
	if (
		siteGalleries.length !== entries.length
		|| siteGalleries.some((gallery) =>
			!entries.some((entry) => entry.galleryId === gallery._id)
		)
	) conflict();
	const digest = await digestPortfolioRestoreRequest(args.siteUrl, args.operationId, entries);
	const replay = await exactRestoreReplay(ctx, { ...args, entries, digest });
	if (replay) return replay;

	const prepared: Array<{
		entry: PortfolioPinnedRestoreEntry;
		gallery: Doc<"portfolioGalleries">;
		source: Awaited<ReturnType<typeof requirePublishableRevision>>;
	}> = [];
	for (const entry of entries) {
		const gallery = await ctx.db.get(entry.galleryId);
		if (!gallery || gallery.siteUrl !== args.siteUrl) conflict();
		assertRestoreCas(gallery, entry);
		await requirePublishableRevision(ctx, gallery, entry.expected.publishedRevisionId);
		prepared.push({
			entry,
			gallery,
			source: await requirePublishableRevision(ctx, gallery, entry.sourceRevisionId),
		});
	}
	const restoringIds = new Set(prepared.map(({ gallery }) => gallery._id));
	const nextSlugs = prepared.map(({ source }) => source.revision.slug);
	const allSiteGalleries = await ctx.db
		.query("portfolioGalleries")
		.withIndex("by_siteUrl_and_portfolioOrder", (q) => q.eq("siteUrl", args.siteUrl))
		.take(PORTFOLIO_GALLERY_MAX + 1);
	if (
		allSiteGalleries.length > PORTFOLIO_GALLERY_MAX
		|| new Set(nextSlugs).size !== nextSlugs.length
		|| allSiteGalleries.some((gallery) =>
			!restoringIds.has(gallery._id) && nextSlugs.includes(gallery.slug)
		)
	) conflict();
	const latest = Math.max(...entries.flatMap(({ expected }) => [
		expected.publishedAt,
		expected.updatedAt,
	]));
	const restoredAt = Math.max(Date.now(), latest + 1);
	if (!Number.isSafeInteger(restoredAt) || restoredAt <= latest) conflict();

	for (const { entry, gallery, source } of prepared) {
		const revisionId = await ctx.db.insert("portfolioGalleryRevisions", {
			siteUrl: gallery.siteUrl,
			galleryId: gallery._id,
			schemaVersion: 1,
			title: source.revision.title,
			description: source.revision.description,
			slug: source.revision.slug,
			seoDescription: source.revision.seoDescription,
			seoOgImageAssetId: source.revision.seoOgImageAssetId,
			seoOgSourceAssetRef: source.revision.seoOgSourceAssetRef,
			sourceDocumentRevision: source.revision.sourceDocumentRevision,
			placementCount: source.revision.placementCount,
			checksum: source.revision.checksum,
			source: "restore",
			createdAt: restoredAt,
			createdBy: RESTORE_ACTOR,
			restoredFromRevisionId: source.revision._id,
			restoreOperationId: args.operationId,
			restoreRequestDigest: digest,
		});
		for (const placement of source.placements) {
			await ctx.db.insert("portfolioPlacements", {
				siteUrl: gallery.siteUrl,
				galleryId: gallery._id,
				revisionId,
				assetId: placement.assetId,
				placementKey: placement.placementKey,
				order: placement.order,
				altText: placement.altText,
				caption: placement.caption,
				focalPoint: placement.focalPoint,
				sourceAssetRef: placement.sourceAssetRef,
				sourceAltAbsent: placement.sourceAltAbsent,
				sourceCropCanonical: placement.sourceCropCanonical,
				sourceHotspotCanonical: placement.sourceHotspotCanonical,
			});
		}
		await ctx.db.patch(gallery._id, {
			slug: source.revision.slug,
			portfolioOrder: entry.sourcePortfolioOrder,
			isVisible: entry.sourceIsVisible,
			draftRevisionId: restoredDraftRevisionId(entry, revisionId),
			publishedRevisionId: revisionId,
			isPublished: true,
			publishedAt: restoredAt,
			publishedBy: RESTORE_ACTOR,
			updatedAt: restoredAt,
			updatedBy: RESTORE_ACTOR,
		});
	}
	return { status: "restored" as const, operationId: args.operationId, restoredAt };
}
