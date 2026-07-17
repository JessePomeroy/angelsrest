import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import {
	type AboutPageDraftPayload,
	sanitizeAboutPagePayload,
	serializeAboutPagePayload,
} from "./helpers/aboutPageValidators";
import {
	type ModelingPageDraftPayload,
	sanitizeModelingPagePayload,
	serializeModelingPagePayload,
} from "./helpers/modelingPageValidators";
import {
	checksumPortfolioDraft,
	getPortfolioPlacements,
	getPortfolioRevision,
	portfolioDraftFromRevision,
} from "./helpers/portfolioData";
import { serializePortfolioGalleryDraft } from "./helpers/portfolioValidators";

const MIGRATION_PAGE_SIZE = 100;
const ALT_TEXT_MAX_LENGTH = 500;

async function checksumPayload(serialized: string) {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(serialized),
	);
	return Array.from(new Uint8Array(digest), (byte) =>
		byte.toString(16).padStart(2, "0"),
	).join("");
}

function aboutPayloadNeedsMigration(payload: AboutPageDraftPayload) {
	return (
		"seoImageAssetId" in payload
		|| (payload.portraits ?? []).some((portrait) => "decorative" in portrait)
	);
}

function modelingPayloadNeedsMigration(payload: ModelingPageDraftPayload) {
	return (
		"seoImageAssetId" in payload
		|| (payload.galleries ?? []).some((gallery) =>
			(gallery.images ?? []).some((image) => "decorative" in image)
		)
	);
}

function aboutPayloadNeedsAccessibilityReview(payload: AboutPageDraftPayload) {
	return (payload.portraits ?? []).some(
		(portrait) => portrait.decorative === true && !portrait.altText?.trim(),
	);
}

function modelingPayloadNeedsAccessibilityReview(payload: ModelingPageDraftPayload) {
	return (payload.galleries ?? []).some((gallery) =>
		(gallery.images ?? []).some(
			(image) => image.decorative === true && !image.altText?.trim(),
		)
	);
}

/**
 * Backfill a factual description for one legacy decorative asset, then strip
 * the retired metadata from each affected revision. This is deliberately
 * asset-scoped so a migration cannot assign one description to unrelated
 * images. Call repeatedly with continueCursor until isDone is true.
 */
export const backfillRetiredContentImageAltText = internalMutation({
	args: {
		cursor: v.union(v.string(), v.null()),
		assetId: v.id("mediaAssets"),
		altText: v.string(),
	},
	handler: async (ctx, { cursor, assetId, altText }) => {
		const normalizedAltText = altText.trim();
		if (!normalizedAltText) throw new Error("Migration alt text is required");
		if (normalizedAltText.length > ALT_TEXT_MAX_LENGTH) {
			throw new Error(`Migration alt text must be ${ALT_TEXT_MAX_LENGTH} characters or fewer`);
		}

		const page = await ctx.db.query("contentRevisions").paginate({
			cursor,
			numItems: MIGRATION_PAGE_SIZE,
		});
		const changedRevisionIds: Id<"contentRevisions">[] = [];

		for (const revision of page.page) {
			if (revision.kind === "aboutPage") {
				const payload = revision.payload as AboutPageDraftPayload;
				let changed = false;
				const withAltText: AboutPageDraftPayload = {
					...payload,
					portraits: payload.portraits?.map((portrait) => {
						if (
							portrait.assetId !== assetId
							|| portrait.decorative !== true
							|| portrait.altText?.trim()
						) return portrait;
						changed = true;
						return { ...portrait, altText: normalizedAltText };
					}),
				};
				if (!changed) continue;
				const sanitized = sanitizeAboutPagePayload(withAltText);
				await ctx.db.patch(revision._id, {
					payload: sanitized,
					checksum: await checksumPayload(serializeAboutPagePayload(sanitized)),
				});
				changedRevisionIds.push(revision._id);
			} else if (revision.kind === "modelingPage") {
				const payload = revision.payload as ModelingPageDraftPayload;
				let changed = false;
				const withAltText: ModelingPageDraftPayload = {
					...payload,
					galleries: payload.galleries?.map((gallery) => ({
						...gallery,
						images: gallery.images?.map((image) => {
							if (
								image.assetId !== assetId
								|| image.decorative !== true
								|| image.altText?.trim()
							) return image;
							changed = true;
							return { ...image, altText: normalizedAltText };
						}),
					})),
				};
				if (!changed) continue;
				const sanitized = sanitizeModelingPagePayload(withAltText);
				await ctx.db.patch(revision._id, {
					payload: sanitized,
					checksum: await checksumPayload(serializeModelingPagePayload(sanitized)),
				});
				changedRevisionIds.push(revision._id);
			}
		}

		return {
			continueCursor: page.continueCursor,
			isDone: page.isDone,
			scanned: page.page.length,
			changed: changedRevisionIds.length,
			changedRevisionIds,
		};
	},
});

/**
 * Bounded, resumable cleanup for retired CMS image metadata in content
 * revisions. Call with a null cursor, then repeat with continueCursor until
 * isDone is true.
 */
export const stripRetiredContentImageMetadata = internalMutation({
	args: { cursor: v.union(v.string(), v.null()) },
	handler: async (ctx, { cursor }) => {
		const page = await ctx.db.query("contentRevisions").paginate({
			cursor,
			numItems: MIGRATION_PAGE_SIZE,
		});
		const changedRevisionIds: Id<"contentRevisions">[] = [];
		const blockedRevisionIds: Id<"contentRevisions">[] = [];
		for (const revision of page.page) {
			if (revision.kind === "aboutPage") {
				const payload = revision.payload as AboutPageDraftPayload;
				if (!aboutPayloadNeedsMigration(payload)) continue;
				if (aboutPayloadNeedsAccessibilityReview(payload)) {
					blockedRevisionIds.push(revision._id);
					continue;
				}
				const sanitized = sanitizeAboutPagePayload(payload);
				await ctx.db.patch(revision._id, {
					payload: sanitized,
					checksum: await checksumPayload(serializeAboutPagePayload(sanitized)),
				});
				changedRevisionIds.push(revision._id);
			} else if (revision.kind === "modelingPage") {
				const payload = revision.payload as ModelingPageDraftPayload;
				if (!modelingPayloadNeedsMigration(payload)) continue;
				if (modelingPayloadNeedsAccessibilityReview(payload)) {
					blockedRevisionIds.push(revision._id);
					continue;
				}
				const sanitized = sanitizeModelingPagePayload(payload);
				await ctx.db.patch(revision._id, {
					payload: sanitized,
					checksum: await checksumPayload(serializeModelingPagePayload(sanitized)),
				});
				changedRevisionIds.push(revision._id);
			}
		}
		return {
			continueCursor: page.continueCursor,
			isDone: page.isDone,
			scanned: page.page.length,
			changed: changedRevisionIds.length,
			changedRevisionIds,
			blocked: blockedRevisionIds.length,
			blockedRevisionIds,
		};
	},
});

/**
 * Bounded, resumable cleanup for retired Portfolio placement metadata. The
 * parent revision checksum is recalculated from the field-free contract.
 */
export const stripRetiredPortfolioImageMetadata = internalMutation({
	args: { cursor: v.union(v.string(), v.null()) },
	handler: async (ctx, { cursor }) => {
		const page = await ctx.db.query("portfolioPlacements").paginate({
			cursor,
			numItems: MIGRATION_PAGE_SIZE,
		});
		const changedPlacementIds: Id<"portfolioPlacements">[] = [];
		const blockedPlacementIds: Id<"portfolioPlacements">[] = [];
		const revisionIds = new Set<Id<"portfolioGalleryRevisions">>();
		for (const placement of page.page) {
			if (!("decorative" in placement)) continue;
			if (placement.decorative === true && !placement.altText?.trim()) {
				blockedPlacementIds.push(placement._id);
				continue;
			}
			await ctx.db.patch(placement._id, { decorative: undefined });
			changedPlacementIds.push(placement._id);
			revisionIds.add(placement.revisionId);
		}

		for (const revisionId of revisionIds) {
			const revision = await getPortfolioRevision(ctx, revisionId);
			if (!revision) throw new Error("Portfolio revision not found during migration");
			const placements = await getPortfolioPlacements(ctx, revisionId);
			const draft = portfolioDraftFromRevision(revision, placements);
			await ctx.db.patch(revisionId, {
				checksum: await checksumPortfolioDraft(
					serializePortfolioGalleryDraft(draft),
				),
			});
		}

		return {
			continueCursor: page.continueCursor,
			isDone: page.isDone,
			scanned: page.page.length,
			changed: changedPlacementIds.length,
			changedPlacementIds,
			blocked: blockedPlacementIds.length,
			blockedPlacementIds,
		};
	},
});
