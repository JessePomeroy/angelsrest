import type { Infer } from "convex/values";
import { v } from "convex/values";

export const modelingImagePlacementValidator = v.object({
	key: v.string(),
	assetId: v.id("mediaAssets"),
	altText: v.optional(v.string()),
});

export const modelingGalleryDraftValidator = v.object({
	key: v.string(),
	title: v.optional(v.string()),
	slug: v.optional(v.string()),
	description: v.optional(v.string()),
	isVisible: v.boolean(),
	images: v.optional(v.array(modelingImagePlacementValidator)),
});

/**
 * Modeling drafts store editorial copy, deliberate category/image order, and
 * tenant-owned public-media references only. Orbit layout, transitions,
 * navigation, and the booking call-to-action remain host-owned.
 */
export const modelingPageDraftPayloadValidator = v.object({
	heading: v.optional(v.string()),
	intro: v.optional(v.string()),
	galleries: v.optional(v.array(modelingGalleryDraftValidator)),
	seoDescription: v.optional(v.string()),
});

export type ModelingPageDraftPayload = Infer<
	typeof modelingPageDraftPayloadValidator
>;
export type ModelingGalleryDraft = NonNullable<
	ModelingPageDraftPayload["galleries"]
>[number];
export type ModelingImagePlacement = NonNullable<
	ModelingGalleryDraft["images"]
>[number];

export type PublishedModelingGallery = {
	key: string;
	title: string;
	slug: string;
	description?: string;
	images: Array<{
		key: string;
		assetId: ModelingImagePlacement["assetId"];
		altText: string;
	}>;
};

export type PublishedModelingPage = {
	heading: string;
	intro?: string;
	galleries: PublishedModelingGallery[];
	seoDescription: string;
};

export const MODELING_GALLERY_MAX = 12;
export const MODELING_CATEGORY_IMAGE_MAX = 10;

const LIMITS = {
	heading: 120,
	intro: 2_000,
	galleries: MODELING_GALLERY_MAX,
	galleryKey: 100,
	galleryTitle: 120,
	gallerySlug: 96,
	galleryDescription: 1_000,
	images: MODELING_CATEGORY_IMAGE_MAX,
	imageKey: 100,
	altText: 500,
	seoDescription: 320,
} as const;

const ALLOWED_KEYS = new Set([
	"heading",
	"intro",
	"galleries",
	"seoDescription",
]);

function assertMaximum(value: string | undefined, maximum: number, field: string) {
	if (value !== undefined && value.length > maximum) {
		throw new Error(`${field} must be ${maximum} characters or fewer`);
	}
}

function assertUniqueKeys(items: Array<{ key: string }>, field: string) {
	const keys = items.map((item) => item.key);
	if (new Set(keys).size !== keys.length) {
		throw new Error(`${field} keys must be unique`);
	}
}

/** Bound autosaved drafts without requiring publishable completeness. */
export function validateModelingPageDraft(payload: ModelingPageDraftPayload) {
	for (const key of Object.keys(payload)) {
		if (!ALLOWED_KEYS.has(key)) {
			throw new Error("Modeling page payload contains an unsupported field");
		}
	}

	assertMaximum(payload.heading, LIMITS.heading, "Modeling heading");
	assertMaximum(payload.intro, LIMITS.intro, "Modeling introduction");
	assertMaximum(payload.seoDescription, LIMITS.seoDescription, "SEO description");

	const galleries = payload.galleries ?? [];
	if (galleries.length > LIMITS.galleries) {
		throw new Error(
			`Modeling pages cannot contain more than ${LIMITS.galleries} categories`,
		);
	}
	assertUniqueKeys(galleries, "Modeling category");

	for (const [galleryIndex, gallery] of galleries.entries()) {
		assertMaximum(
			gallery.key,
			LIMITS.galleryKey,
			`Category ${galleryIndex + 1} key`,
		);
		assertMaximum(
			gallery.title,
			LIMITS.galleryTitle,
			`Category ${galleryIndex + 1} title`,
		);
		assertMaximum(
			gallery.slug,
			LIMITS.gallerySlug,
			`Category ${galleryIndex + 1} slug`,
		);
		assertMaximum(
			gallery.description,
			LIMITS.galleryDescription,
			`Category ${galleryIndex + 1} description`,
		);

		const images = gallery.images ?? [];
		if (images.length > LIMITS.images) {
			throw new Error(
				`Modeling categories cannot contain more than ${LIMITS.images} images`,
			);
		}
		assertUniqueKeys(images, `Category ${galleryIndex + 1} image placement`);
		if (new Set(images.map((image) => image.assetId)).size !== images.length) {
			throw new Error(
				`Category ${galleryIndex + 1} cannot use the same image more than once`,
			);
		}
		for (const [imageIndex, image] of images.entries()) {
			assertMaximum(
				image.key,
				LIMITS.imageKey,
				`Category ${galleryIndex + 1} image ${imageIndex + 1} key`,
			);
			assertMaximum(
				image.altText,
				LIMITS.altText,
				`Category ${galleryIndex + 1} image ${imageIndex + 1} alt text`,
			);
		}
	}
}

function requireText(value: string | undefined, field: string, maximum: number) {
	const normalized = value?.trim() ?? "";
	if (!normalized) throw new Error(`${field} is required before publishing`);
	assertMaximum(normalized, maximum, field);
	return normalized;
}

function optionalText(value: string | undefined, field: string, maximum: number) {
	const normalized = value?.trim();
	if (!normalized) return undefined;
	assertMaximum(normalized, maximum, field);
	return normalized;
}

function requireSlug(value: string | undefined, field: string) {
	const normalized = requireText(value, field, LIMITS.gallerySlug);
	if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(normalized)) {
		throw new Error(`${field} must use lowercase words separated by hyphens`);
	}
	return normalized;
}

/**
 * Normalize only visible, complete categories for the public projection.
 * Hidden categories remain in the immutable revision so an editor can restore
 * them later without exposing incomplete content.
 */
export function toPublishedModelingPage(
	payload: ModelingPageDraftPayload,
): PublishedModelingPage {
	validateModelingPageDraft(payload);
	const galleries = (payload.galleries ?? []).flatMap(
		(gallery, galleryIndex): PublishedModelingGallery[] => {
			if (!gallery.isVisible) return [];
			const images = gallery.images ?? [];
			if (images.length === 0) {
				throw new Error(
					`Category ${galleryIndex + 1} needs at least one image before publishing`,
				);
			}
			const normalizedImages = images.map((image, imageIndex) => {
				const altText = optionalText(
					image.altText,
					`Category ${galleryIndex + 1} image ${imageIndex + 1} alt text`,
					LIMITS.altText,
				);
				if (!altText) {
					throw new Error(
						`Category ${galleryIndex + 1} image ${imageIndex + 1} needs alt text before publishing`,
					);
				}
				return {
					key: requireText(
						image.key,
						`Category ${galleryIndex + 1} image ${imageIndex + 1} key`,
						LIMITS.imageKey,
					),
					assetId: image.assetId,
					altText,
				};
			});
			return [{
				key: requireText(
					gallery.key,
					`Category ${galleryIndex + 1} key`,
					LIMITS.galleryKey,
				),
				title: requireText(
					gallery.title,
					`Category ${galleryIndex + 1} title`,
					LIMITS.galleryTitle,
				),
				slug: requireSlug(
					gallery.slug,
					`Category ${galleryIndex + 1} slug`,
				),
				description: optionalText(
					gallery.description,
					`Category ${galleryIndex + 1} description`,
					LIMITS.galleryDescription,
				),
				images: normalizedImages,
			}];
		},
	);
	if (galleries.length === 0) {
		throw new Error("At least one visible Modeling category is required before publishing");
	}
	const slugs = galleries.map((gallery) => gallery.slug);
	if (new Set(slugs).size !== slugs.length) {
		throw new Error("Visible Modeling category slugs must be unique");
	}

	return {
		heading: requireText(payload.heading, "Modeling heading", LIMITS.heading),
		intro: optionalText(payload.intro, "Modeling introduction", LIMITS.intro),
		galleries,
		seoDescription: requireText(
			payload.seoDescription,
			"SEO description",
			LIMITS.seoDescription,
		),
	};
}

/** Stable serialization preserves deliberate category and image sequence order. */
export function serializeModelingPagePayload(payload: ModelingPageDraftPayload) {
	return JSON.stringify({
		heading: payload.heading ?? null,
		intro: payload.intro ?? null,
		galleries: (payload.galleries ?? []).map((gallery) => ({
			key: gallery.key,
			title: gallery.title ?? null,
			slug: gallery.slug ?? null,
			description: gallery.description ?? null,
			isVisible: gallery.isVisible,
			images: (gallery.images ?? []).map((image) => ({
				key: image.key,
				assetId: image.assetId,
				altText: image.altText ?? null,
			})),
		})),
		seoDescription: payload.seoDescription ?? null,
	});
}

export function modelingPageReferencesAsset(
	payload: ModelingPageDraftPayload,
	assetId: string,
) {
	return (
		(payload.galleries ?? []).some((gallery) =>
			(gallery.images ?? []).some((image) => image.assetId === assetId)
		)
	);
}
