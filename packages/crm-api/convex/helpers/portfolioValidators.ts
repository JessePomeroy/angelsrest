import type { Infer } from "convex/values";
import { v } from "convex/values";

export const portfolioPlacementDraftValidator = v.object({
	key: v.string(),
	assetId: v.id("mediaAssets"),
	altText: v.optional(v.string()),
	decorative: v.boolean(),
	caption: v.optional(v.string()),
	focalPoint: v.optional(v.object({ x: v.number(), y: v.number() })),
});

export const portfolioGalleryDraftValidator = v.object({
	title: v.optional(v.string()),
	description: v.optional(v.string()),
	slug: v.string(),
	placements: v.array(portfolioPlacementDraftValidator),
});

export type PortfolioGalleryDraft = Infer<typeof portfolioGalleryDraftValidator>;
export type PortfolioPlacementDraft = Infer<typeof portfolioPlacementDraftValidator>;

export const PORTFOLIO_GALLERY_MAX = 100;
export const PORTFOLIO_PLACEMENT_MAX = 500;

const LIMITS = {
	title: 120,
	description: 2_000,
	slug: 80,
	placementKey: 100,
	altText: 500,
	caption: 1_000,
} as const;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PLACEMENT_KEY_PATTERN = /^[A-Za-z0-9_-]+$/;

function assertMaximum(value: string | undefined, maximum: number, field: string) {
	if (value !== undefined && value.length > maximum) {
		throw new Error(`${field} must be ${maximum} characters or fewer`);
	}
}

export function validatePortfolioGalleryDraft(draft: PortfolioGalleryDraft) {
	assertMaximum(draft.title, LIMITS.title, "Gallery title");
	assertMaximum(draft.description, LIMITS.description, "Gallery description");
	if (draft.slug.length === 0 || draft.slug.length > LIMITS.slug || !SLUG_PATTERN.test(draft.slug)) {
		throw new Error("Gallery slug must contain only lowercase letters, numbers, and single hyphens");
	}
	if (draft.placements.length > PORTFOLIO_PLACEMENT_MAX) {
		throw new Error(`Portfolio galleries cannot exceed ${PORTFOLIO_PLACEMENT_MAX} placements`);
	}

	const placementKeys = new Set<string>();
	const assetIds = new Set<string>();
	for (const [index, placement] of draft.placements.entries()) {
		assertMaximum(placement.key, LIMITS.placementKey, `Placement ${index + 1} key`);
		if (!PLACEMENT_KEY_PATTERN.test(placement.key) || placementKeys.has(placement.key)) {
			throw new Error("Portfolio placement keys must be unique letters, numbers, underscores, or hyphens");
		}
		placementKeys.add(placement.key);
		if (assetIds.has(placement.assetId)) {
			throw new Error("A media asset can appear only once in a portfolio gallery revision");
		}
		assetIds.add(placement.assetId);
		assertMaximum(placement.altText, LIMITS.altText, `Placement ${index + 1} alt text`);
		assertMaximum(placement.caption, LIMITS.caption, `Placement ${index + 1} caption`);
		if (
			placement.focalPoint
			&& (
				!Number.isFinite(placement.focalPoint.x)
				|| !Number.isFinite(placement.focalPoint.y)
				|| placement.focalPoint.x < 0
				|| placement.focalPoint.x > 1
				|| placement.focalPoint.y < 0
				|| placement.focalPoint.y > 1
			)
		) throw new Error("Placement focal points must be between 0 and 1");
	}
}

function requireText(value: string | undefined, field: string, maximum: number) {
	const normalized = value?.trim() ?? "";
	if (!normalized) throw new Error(`${field} is required before publishing`);
	assertMaximum(normalized, maximum, field);
	return normalized;
}

export function toPublishedPortfolioGallery(draft: PortfolioGalleryDraft) {
	validatePortfolioGalleryDraft(draft);
	if (draft.placements.length === 0) {
		throw new Error("At least one portfolio image is required before publishing");
	}
	return {
		title: requireText(draft.title, "Gallery title", LIMITS.title),
		description: draft.description?.trim() || null,
		slug: draft.slug,
		placements: draft.placements.map((placement, index) => {
			const altText = placement.altText?.trim() ?? "";
			if (placement.decorative && altText) {
				throw new Error(`Placement ${index + 1} cannot have alt text when marked decorative`);
			}
			if (!placement.decorative && !altText) {
				throw new Error(`Placement ${index + 1} needs alt text or must be marked decorative`);
			}
			return {
				...placement,
				altText,
				caption: placement.caption?.trim() || null,
			};
		}),
	};
}

export function serializePortfolioGalleryDraft(draft: PortfolioGalleryDraft) {
	return JSON.stringify({
		title: draft.title ?? null,
		description: draft.description ?? null,
		slug: draft.slug,
		placements: draft.placements.map((placement) => ({
			key: placement.key,
			assetId: placement.assetId,
			altText: placement.altText ?? null,
			decorative: placement.decorative,
			caption: placement.caption ?? null,
			focalPoint: placement.focalPoint ?? null,
		})),
	});
}
