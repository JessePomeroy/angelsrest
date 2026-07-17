import { stableTechnicalItems } from "./postContentValidationSupport";
import {
	postExcerptFromDraft,
	type PostDraft,
	type PostRevisionPayload,
	validatePostDraft,
} from "./postContentValidators";

/** Exact, order-preserving graph serialization for idempotent save retries. */
export function serializePostDraft(draft: PostDraft) {
	const validated = validatePostDraft(draft);
	return JSON.stringify({
		kind: "post",
		title: validated.title ?? null,
		slug: validated.slug ?? null,
		format: validated.format ?? null,
		presentation: validated.presentation ?? null,
		displayPublishedAt: validated.displayPublishedAt ?? null,
		summary: validated.summary ?? null,
		seoTitle: validated.seoTitle ?? null,
		seoDescription: validated.seoDescription ?? null,
		brief: validated.brief ?? null,
		approach: validated.approach ?? null,
		outcome: validated.outcome ?? null,
		credits: validated.credits ?? null,
		equipment: stableTechnicalItems(validated.equipment),
		materials: stableTechnicalItems(validated.materials),
		authorDocumentId: validated.authorDocumentId ?? null,
		categories: validated.categories.map((category) => ({
			key: category.key,
			documentId: category.documentId,
		})),
		mainImage: validated.mainImage
			? {
				key: validated.mainImage.key,
				assetId: validated.mainImage.assetId,
				altText: validated.mainImage.altText ?? null,
				caption: validated.mainImage.caption ?? null,
			}
			: null,
		body: validated.body,
	});
}

/**
 * Compact integrity input for Post list projections. Body and technical-item
 * contents remain covered by the full revision checksum; this value covers
 * every header plus the reference and main-media rows a list actually reads.
 */
export type PostSummaryIntegrityInput = Omit<
	PostRevisionPayload,
	"summaryChecksum"
> & {
	authorDocumentId?: PostDraft["authorDocumentId"];
	categories: PostDraft["categories"];
	mainImage?: PostDraft["mainImage"];
};

export function postSummaryIntegrityFromDraft(
	draft: PostDraft,
): PostSummaryIntegrityInput {
	const validated = validatePostDraft(draft);
	const bodyImageCount = validated.body.blocks.filter(
		(block) => block.type === "image",
	).length;
	return {
		kind: "post",
		title: validated.title,
		slug: validated.slug,
		format: validated.format,
		presentation: validated.presentation,
		displayPublishedAt: validated.displayPublishedAt,
		summary: validated.summary,
		seoTitle: validated.seoTitle,
		seoDescription: validated.seoDescription,
		brief: validated.brief,
		approach: validated.approach,
		outcome: validated.outcome,
		credits: validated.credits,
		excerpt: postExcerptFromDraft(validated),
		bodyBlockCount: validated.body.blocks.length,
		categoryCount: validated.categories.length,
		equipmentCount: validated.equipment.length,
		materialCount: validated.materials.length,
		mediaPlacementCount: bodyImageCount + (validated.mainImage ? 1 : 0),
		referenceCount:
			validated.categories.length + (validated.authorDocumentId ? 1 : 0),
		hasAuthor: validated.authorDocumentId !== undefined,
		hasMainImage: validated.mainImage !== undefined,
		authorDocumentId: validated.authorDocumentId,
		categories: validated.categories,
		mainImage: validated.mainImage,
	};
}

export function postSummaryChecksumInput(input: PostSummaryIntegrityInput) {
	return `post-summary:v1:${JSON.stringify({
		kind: "post",
		title: input.title ?? null,
		slug: input.slug ?? null,
		format: input.format ?? null,
		presentation: input.presentation ?? null,
		displayPublishedAt: input.displayPublishedAt ?? null,
		summary: input.summary ?? null,
		seoTitle: input.seoTitle ?? null,
		seoDescription: input.seoDescription ?? null,
		brief: input.brief ?? null,
		approach: input.approach ?? null,
		outcome: input.outcome ?? null,
		credits: input.credits ?? null,
		excerpt: input.excerpt,
		bodyBlockCount: input.bodyBlockCount,
		categoryCount: input.categoryCount,
		equipmentCount: input.equipmentCount,
		materialCount: input.materialCount,
		mediaPlacementCount: input.mediaPlacementCount,
		referenceCount: input.referenceCount,
		hasAuthor: input.hasAuthor,
		hasMainImage: input.hasMainImage,
		authorDocumentId: input.authorDocumentId ?? null,
		categories: input.categories.map((category) => ({
			key: category.key,
			documentId: category.documentId,
		})),
		mainImage: input.mainImage
			? {
				key: input.mainImage.key,
				assetId: input.mainImage.assetId,
				altText: input.mainImage.altText ?? null,
				caption: input.mainImage.caption ?? null,
			}
			: null,
	})}`;
}

export function postChecksumInput(draft: PostDraft) {
	return `post-content:v1:${serializePostDraft(draft)}`;
}
