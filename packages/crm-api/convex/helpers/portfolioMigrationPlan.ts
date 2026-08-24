import type { Infer } from "convex/values";
import { v } from "convex/values";
import { checksumPortfolioDraft } from "./portfolioData";
import {
	PORTFOLIO_GALLERY_MAX,
	PORTFOLIO_PLACEMENT_MAX,
	PORTFOLIO_PUBLIC_PLACEMENT_MAX,
	toPublishedImportedPortfolioGallery,
} from "./portfolioValidators";

const SHA256 = /^[a-f0-9]{64}$/;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const STABLE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const REVISION = /^[A-Za-z0-9._-]{1,256}$/;
const SANITY_IMAGE_REF = /^image-[A-Za-z0-9]+-\d+x\d+-[A-Za-z0-9]+$/;
const PLACEMENT_KEY = /^[A-Za-z0-9_-]{1,100}$/;
const MEDIA_INPUT_MAX_BYTES = 20 * 1_024 * 1_024;

const animationInspectionValidator = v.object({
	frameCount: v.number(),
	frameDurationMs: v.number(),
	loop: v.literal("infinite"),
});

const mediaMappingValidator = v.object({
	sourceAssetRef: v.string(),
	sourceAssetRevision: v.string(),
	sourceOriginalContentType: v.string(),
	transferRecipe: v.literal("sanity-width-1600-webp-q90"),
	transferSha256: v.string(),
	transferSizeBytes: v.number(),
	transferWidth: v.number(),
	transferHeight: v.number(),
	targetMediaAssetId: v.id("mediaAssets"),
	targetWorkerAssetId: v.string(),
	targetReceiptSha256: v.string(),
	targetAnimationInspection: v.optional(v.object({
		card: animationInspectionValidator,
		display2048: animationInspectionValidator,
	})),
});

const placementValidator = v.object({
	key: v.string(),
	assetId: v.id("mediaAssets"),
	altText: v.optional(v.string()),
	sourceAltState: v.union(v.literal("present"), v.literal("absent")),
	focalPoint: v.optional(v.object({ x: v.number(), y: v.number() })),
	sourceAssetRef: v.string(),
	sourceCropCanonical: v.string(),
	sourceHotspotCanonical: v.string(),
});

const preservedTargetGalleryValidator = v.object({
	galleryId: v.id("portfolioGalleries"),
	draftRevisionId: v.id("portfolioGalleryRevisions"),
	publishedRevisionId: v.union(v.id("portfolioGalleryRevisions"), v.null()),
	slug: v.string(),
	portfolioOrder: v.number(),
	isPublished: v.boolean(),
	isVisible: v.union(v.boolean(), v.null()),
	sourceDocumentId: v.union(v.string(), v.null()),
	createdAt: v.number(),
	createdByDigest: v.string(),
	updatedAt: v.number(),
	updatedByDigest: v.string(),
	publishedAt: v.union(v.number(), v.null()),
	publishedBy: v.union(v.string(), v.null()),
	revision: v.object({
		revisionId: v.id("portfolioGalleryRevisions"),
		checksum: v.string(),
		createdAt: v.number(),
		createdByDigest: v.string(),
	}),
});

const entryValidator = v.object({
	sourceId: v.string(),
	sourceRevision: v.string(),
	sourceOrderRank: v.string(),
	sourceUnsupportedCanonical: v.string(),
	targetIsVisible: v.boolean(),
	portfolioOrder: v.number(),
	draft: v.object({
		title: v.string(),
		description: v.optional(v.string()),
		slug: v.string(),
		seoDescription: v.optional(v.string()),
		seoOgImageAssetId: v.optional(v.id("mediaAssets")),
		seoOgSourceAssetRef: v.optional(v.string()),
		placements: v.array(placementValidator),
	}),
});

export const portfolioMigrationPlanValidator = v.object({
	version: v.literal(1),
	migrationId: v.string(),
	siteUrl: v.string(),
	source: v.object({
		projectId: v.string(),
		dataset: v.string(),
		perspective: v.literal("published"),
	}),
	decisionSet: v.object({
		id: v.string(),
		ordering: v.literal("order-rank-then-source-id-owner-approved"),
		visibility: v.literal("preserve-unfiltered-all-published-owner-approved"),
		canonicalUrl: v.literal("preserve-title-derived-canonical-owner-approved"),
		derivatives: v.literal("accept-fixed-convex-webp-owner-approved"),
		cropHotspot: v.literal("accept-focal-only-owner-approved"),
		captions: v.literal("confirmed-absent-owner-approved"),
		missingAlt: v.literal("legacy-runtime-fallback-only-owner-approved"),
		seo: v.literal("confirmed-absent-owner-approved"),
		unsupportedFields: v.literal(
			"omit-category-date-featured-visibility-with-presence-recorded-owner-approved",
		),
		mediaTransfer: v.literal("sanity-width-1600-webp-q90-owner-approved"),
		gifCanary: v.literal("17-frames-100ms-infinite-card-and-display2048"),
	}),
	preservedTargetGallery: preservedTargetGalleryValidator,
	mediaMappings: v.array(mediaMappingValidator),
	entries: v.array(entryValidator),
});

export type PortfolioMigrationPlan = Infer<typeof portfolioMigrationPlanValidator>;
export type PortfolioMigrationEntry = Infer<typeof entryValidator>;
export type PortfolioMediaMapping = Infer<typeof mediaMappingValidator>;

type JsonRecord = Record<string, unknown>;

export function canonicalPortfolioJson(value: unknown): string {
	if (value === null) return "null";
	if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
	if (typeof value === "number") {
		if (!Number.isFinite(value)) throw new Error("Portfolio plan contains a non-finite number");
		return JSON.stringify(value);
	}
	if (Array.isArray(value)) return `[${value.map(canonicalPortfolioJson).join(",")}]`;
	if (typeof value === "object") {
		return `{${Object.entries(value as JsonRecord)
			.filter(([, entry]) => entry !== undefined)
			.sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
			.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalPortfolioJson(entry)}`)
			.join(",")}}`;
	}
	throw new Error("Portfolio plan contains an unsupported value");
}

export type PortfolioPreservedTargetActorRole =
	| "gallery-created-by"
	| "gallery-updated-by"
	| "revision-created-by";

export async function digestPortfolioPreservedTargetActor(
	siteUrl: string,
	role: PortfolioPreservedTargetActorRole,
	actor: string,
) {
	return await checksumPortfolioDraft(canonicalPortfolioJson([
		"portfolio-preserved-target-actor-v1",
		siteUrl,
		role,
		actor,
	]));
}

function requireText(value: string, label: string, maximum: number) {
	if (!value || value !== value.trim() || value.length > maximum) {
		throw new Error(`${label} is invalid`);
	}
	return value;
}

function requirePositiveInteger(value: number, label: string) {
	if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} is invalid`);
}

function requireTimestamp(value: number, label: string) {
	if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} is invalid`);
}

function requireCanonical(value: string, label: string) {
	let parsed: unknown;
	try {
		parsed = JSON.parse(value);
	} catch {
		throw new Error(`${label} is not canonical JSON`);
	}
	if (canonicalPortfolioJson(parsed) !== value) throw new Error(`${label} is not canonical JSON`);
}

function validateMediaMappings(plan: PortfolioMigrationPlan) {
	if (plan.mediaMappings.length > PORTFOLIO_PUBLIC_PLACEMENT_MAX * 2) {
		throw new Error("Portfolio media mapping limit exceeded");
	}
	const byRef = new Map<string, PortfolioMediaMapping>();
	const targetIds = new Set<string>();
	const workerIds = new Set<string>();
	for (const mapping of plan.mediaMappings) {
		if (!SANITY_IMAGE_REF.test(mapping.sourceAssetRef)) {
			throw new Error("Portfolio source asset reference is invalid");
		}
		if (!REVISION.test(mapping.sourceAssetRevision)) {
			throw new Error("Portfolio source asset revision is invalid");
		}
		if (!/^image\/[a-z0-9.+-]+$/.test(mapping.sourceOriginalContentType)) {
			throw new Error("Portfolio source media type is invalid");
		}
		if (!SHA256.test(mapping.transferSha256) || !SHA256.test(mapping.targetReceiptSha256)) {
			throw new Error("Portfolio media digest is invalid");
		}
		requirePositiveInteger(mapping.transferSizeBytes, "Portfolio transfer byte size");
		if (mapping.transferSizeBytes > MEDIA_INPUT_MAX_BYTES) {
			throw new Error("Portfolio transfer exceeds the media worker input limit");
		}
		requirePositiveInteger(mapping.transferWidth, "Portfolio transfer width");
		requirePositiveInteger(mapping.transferHeight, "Portfolio transfer height");
		if (mapping.transferWidth > 1_600 || mapping.transferHeight > 100_000) {
			throw new Error("Portfolio transfer dimensions are invalid");
		}
		if (!UUID_V4.test(mapping.targetWorkerAssetId)) {
			throw new Error("Portfolio target worker asset ID is invalid");
		}
		if (
			byRef.has(mapping.sourceAssetRef)
			|| targetIds.has(mapping.targetMediaAssetId)
			|| workerIds.has(mapping.targetWorkerAssetId)
		) throw new Error("Portfolio media mappings must be one-to-one");
		const animation = mapping.targetAnimationInspection;
		if (mapping.sourceOriginalContentType === "image/gif") {
			if (
				!animation
				|| animation.card.frameCount !== 17
				|| animation.card.frameDurationMs !== 100
				|| animation.card.loop !== "infinite"
				|| animation.display2048.frameCount !== 17
				|| animation.display2048.frameDurationMs !== 100
				|| animation.display2048.loop !== "infinite"
			) throw new Error("Portfolio GIF target animation inspection is not accepted");
		} else if (animation !== undefined) {
			throw new Error("Portfolio animation inspection is only valid for a GIF source");
		}
		byRef.set(mapping.sourceAssetRef, mapping);
		targetIds.add(mapping.targetMediaAssetId);
		workerIds.add(mapping.targetWorkerAssetId);
	}
	return byRef;
}

function validateEntry(
	entry: PortfolioMigrationEntry,
	index: number,
	mediaByRef: Map<string, PortfolioMediaMapping>,
	usedMediaRefs: Set<string>,
) {
	if (!STABLE_ID.test(entry.sourceId) || !REVISION.test(entry.sourceRevision)) {
		throw new Error("Portfolio source document identity is invalid");
	}
	requireText(entry.sourceOrderRank, "Portfolio source order rank", 256);
	requireCanonical(entry.sourceUnsupportedCanonical, "Portfolio unsupported fields");
	if (entry.portfolioOrder !== index) throw new Error("Portfolio order is not contiguous");
	if (entry.draft.seoDescription !== undefined) {
		requireText(entry.draft.seoDescription, "Portfolio SEO description", 320);
	}
	if (
		(entry.draft.seoOgImageAssetId === undefined)
		!== (entry.draft.seoOgSourceAssetRef === undefined)
	) throw new Error("Portfolio SEO image identity is incomplete");
	if (entry.draft.seoOgImageAssetId && entry.draft.seoOgSourceAssetRef) {
		const mapping = mediaByRef.get(entry.draft.seoOgSourceAssetRef);
		if (!mapping || mapping.targetMediaAssetId !== entry.draft.seoOgImageAssetId) {
			throw new Error("Portfolio SEO image mapping is inconsistent");
		}
		usedMediaRefs.add(mapping.sourceAssetRef);
	}
	if (entry.draft.placements.length > PORTFOLIO_PLACEMENT_MAX) {
		throw new Error("Portfolio gallery placement limit exceeded");
	}
	const keys = new Set<string>();
	const assets = new Set<string>();
	for (const placement of entry.draft.placements) {
		if (!PLACEMENT_KEY.test(placement.key) || keys.has(placement.key)) {
			throw new Error("Portfolio placement key is invalid or duplicated");
		}
		if (assets.has(placement.assetId)) {
			throw new Error("Portfolio source asset is repeated within one gallery");
		}
		if (placement.sourceAltState === "present") {
			requireText(placement.altText ?? "", "Portfolio placement alt text", 500);
		} else if (placement.altText !== undefined) {
			throw new Error("Portfolio missing source alt must use the legacy runtime fallback");
		}
		requireCanonical(placement.sourceCropCanonical, "Portfolio source crop");
		requireCanonical(placement.sourceHotspotCanonical, "Portfolio source hotspot");
		const mapping = mediaByRef.get(placement.sourceAssetRef);
		if (!mapping || mapping.targetMediaAssetId !== placement.assetId) {
			throw new Error("Portfolio placement media mapping is inconsistent");
		}
		if (
			placement.focalPoint
			&& (
				placement.focalPoint.x < 0
				|| placement.focalPoint.x > 1
				|| placement.focalPoint.y < 0
				|| placement.focalPoint.y > 1
			)
		) throw new Error("Portfolio focal point is invalid");
		keys.add(placement.key);
		assets.add(placement.assetId);
		usedMediaRefs.add(mapping.sourceAssetRef);
	}
	const draft = {
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
	if (draft.placements.length === 0 || !draft.title.trim()) {
		throw new Error("Portfolio imported gallery is not publishable");
	}
	toPublishedImportedPortfolioGallery(
		draft,
		new Set(
			entry.draft.placements
				.filter((placement) => placement.sourceAltState === "absent")
				.map((placement) => placement.key),
		),
	);
}

/** Validate one already owner-approved, exact Portfolio migration manifest. */
export function validatePortfolioMigrationPlan(plan: PortfolioMigrationPlan) {
	if (plan.version !== 1 || plan.source.perspective !== "published") {
		throw new Error("Portfolio migration plan version is unsupported");
	}
	requireText(plan.migrationId, "Portfolio migration ID", 256);
	requireText(plan.siteUrl, "Portfolio site URL", 256);
	requireText(plan.source.projectId, "Portfolio source project", 128);
	requireText(plan.source.dataset, "Portfolio source dataset", 128);
	requireText(plan.decisionSet.id, "Portfolio decision set", 256);
	const preserved = plan.preservedTargetGallery;
	requireText(preserved.slug, "Preserved Portfolio target slug", 80);
	if (preserved.sourceDocumentId !== null) {
		requireText(preserved.sourceDocumentId, "Preserved Portfolio source identity", 256);
	}
	requireTimestamp(preserved.createdAt, "Preserved Portfolio target creation time");
	requireTimestamp(preserved.updatedAt, "Preserved Portfolio target update time");
	requireTimestamp(preserved.revision.createdAt, "Preserved Portfolio revision creation time");
	if (
		preserved.isPublished
		|| preserved.publishedRevisionId !== null
		|| preserved.publishedAt !== null
		|| preserved.publishedBy !== null
		|| preserved.draftRevisionId !== preserved.revision.revisionId
		|| !Number.isSafeInteger(preserved.portfolioOrder)
		|| preserved.portfolioOrder < 0
		|| !SHA256.test(preserved.createdByDigest)
		|| !SHA256.test(preserved.updatedByDigest)
		|| !SHA256.test(preserved.revision.checksum)
		|| !SHA256.test(preserved.revision.createdByDigest)
	) throw new Error("Preserved Portfolio target tuple is invalid");
	if (plan.entries.length < 1 || plan.entries.length >= PORTFOLIO_GALLERY_MAX) {
		throw new Error("Portfolio gallery manifest count is invalid");
	}
	const mediaByRef = validateMediaMappings(plan);
	const usedMediaRefs = new Set<string>();
	const sourceIds = new Set<string>();
	const slugs = new Set<string>();
	let placementCount = 0;
	for (const [index, entry] of plan.entries.entries()) {
		if (
			sourceIds.has(entry.sourceId)
			|| slugs.has(entry.draft.slug)
			|| entry.draft.slug === preserved.slug
		) {
			throw new Error("Portfolio source IDs and slugs must be unique");
		}
		validateEntry(entry, index, mediaByRef, usedMediaRefs);
		sourceIds.add(entry.sourceId);
		slugs.add(entry.draft.slug);
		placementCount += entry.draft.placements.length;
		if (
			entry.targetIsVisible !== true
			|| entry.draft.seoDescription !== undefined
			|| entry.draft.seoOgImageAssetId !== undefined
			|| entry.draft.seoOgSourceAssetRef !== undefined
		) throw new Error("Portfolio accepted visibility and SEO decisions changed");
	}
	if (placementCount > PORTFOLIO_PUBLIC_PLACEMENT_MAX) {
		throw new Error("Portfolio public placement limit exceeded");
	}
	const expectedOrder = [...plan.entries].sort((left, right) => {
		const leftValue = `${left.sourceOrderRank}\u0000${left.sourceId}`;
		const rightValue = `${right.sourceOrderRank}\u0000${right.sourceId}`;
		return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
	});
	if (expectedOrder.some((entry, index) => entry.sourceId !== plan.entries[index]?.sourceId)) {
		throw new Error("Portfolio source order is not deterministic");
	}
	if (
		usedMediaRefs.size !== mediaByRef.size
		|| [...mediaByRef.keys()].some((sourceRef) => !usedMediaRefs.has(sourceRef))
	) throw new Error("Portfolio media mapping contains an unused asset");
	return { galleryCount: plan.entries.length, placementCount, mediaCount: mediaByRef.size };
}

export async function digestPortfolioMigrationPlan(plan: PortfolioMigrationPlan) {
	validatePortfolioMigrationPlan(plan);
	return await checksumPortfolioDraft(canonicalPortfolioJson(plan));
}

export async function requirePortfolioMigrationPlan(
	plan: PortfolioMigrationPlan,
	digest: string,
) {
	if (!SHA256.test(digest) || await digestPortfolioMigrationPlan(plan) !== digest) {
		throw new Error("Portfolio migration plan digest mismatch");
	}
	return digest;
}
