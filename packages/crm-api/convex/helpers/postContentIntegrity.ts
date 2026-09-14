import { stableTechnicalItems } from "./postContentValidationSupport";
import {
	postExcerptFromDraft,
	type PostDraft,
	type PostRevisionPayload,
	validatePostDraft,
} from "./postContentValidators";

/** Exact, order-preserving graph serialization for idempotent save retries. */
function serializePostDraft(validated: PostDraft) {
	// Omit absent additive markers so marker-free revisions retain their v1 checksums.
	return JSON.stringify({
		kind: "post",
		title: validated.title ?? null,
		slug: validated.slug ?? null,
		format: validated.format ?? null,
		presentation: validated.presentation ?? null,
		displayPublishedAt: validated.displayPublishedAt ?? null,
		summary: validated.summary ?? null,
		...(validated.summarySource ? { summarySource: validated.summarySource } : {}),
		seoTitle: validated.seoTitle ?? null,
		seoDescription: validated.seoDescription ?? null,
		brief: validated.brief ?? null,
		approach: validated.approach ?? null,
		outcome: validated.outcome ?? null,
		credits: validated.credits ?? null,
		equipment: stableTechnicalItems(validated.equipment),
		materials: stableTechnicalItems(validated.materials),
		authorDocumentId: validated.authorDocumentId ?? null,
		...(validated.authorSource ? { authorSource: validated.authorSource } : {}),
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

function postRevisionHeader(draft: PostDraft): Omit<PostRevisionPayload, "summaryChecksum"> {
	const bodyImages = draft.body.blocks.filter((block) => block.type === "image").length;
	return {
		kind: "post",
		title: draft.title,
		slug: draft.slug,
		format: draft.format,
		presentation: draft.presentation,
		displayPublishedAt: draft.displayPublishedAt,
		summary: draft.summary,
		...(draft.summarySource ? { summarySource: draft.summarySource } : {}),
		seoTitle: draft.seoTitle,
		seoDescription: draft.seoDescription,
		brief: draft.brief,
		approach: draft.approach,
		outcome: draft.outcome,
		credits: draft.credits,
		excerpt: postExcerptFromDraft(draft),
		bodyBlockCount: draft.body.blocks.length,
		categoryCount: draft.categories.length,
		equipmentCount: draft.equipment.length,
		materialCount: draft.materials.length,
		mediaPlacementCount: bodyImages + (draft.mainImage ? 1 : 0),
		referenceCount: draft.categories.length + (draft.authorDocumentId ? 1 : 0),
		hasAuthor: draft.authorDocumentId !== undefined,
		...(draft.authorSource ? { authorSource: draft.authorSource } : {}),
		hasMainImage: draft.mainImage !== undefined,
	};
}

function postSummaryChecksumInput(input: PostSummaryIntegrityInput) {
	return `post-summary:v1:${JSON.stringify({
		kind: "post",
		title: input.title ?? null,
		slug: input.slug ?? null,
		format: input.format ?? null,
		presentation: input.presentation ?? null,
		displayPublishedAt: input.displayPublishedAt ?? null,
		summary: input.summary ?? null,
		...(input.summarySource ? { summarySource: input.summarySource } : {}),
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
		...(input.authorSource ? { authorSource: input.authorSource } : {}),
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

async function checksumInput(input: string) {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
	return Array.from(new Uint8Array(digest), (byte) =>
		byte.toString(16).padStart(2, "0"),
	).join("");
}

export async function checksumPostSummaryIntegrity(input: PostSummaryIntegrityInput) {
	return await checksumInput(postSummaryChecksumInput(input));
}

/** Derive stored headers and both v1 checksums from the same validated graph. */
export async function preparePostRevision(input: PostDraft) {
	const draft = validatePostDraft(input);
	const header = postRevisionHeader(draft);
	const checksum = await checksumInput(`post-content:v1:${serializePostDraft(draft)}`);
	const summaryChecksum = await checksumPostSummaryIntegrity({
		...header,
		authorDocumentId: draft.authorDocumentId,
		categories: draft.categories,
		mainImage: draft.mainImage,
	});
	return { draft, checksum, payload: { ...header, summaryChecksum } };
}
