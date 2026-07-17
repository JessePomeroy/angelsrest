import type { Infer } from "convex/values";
import { v } from "convex/values";

export const aboutPortraitPlacementValidator = v.object({
	key: v.string(),
	assetId: v.id("mediaAssets"),
	altText: v.optional(v.string()),
});

export const aboutSectionValidator = v.object({
	key: v.string(),
	title: v.optional(v.string()),
	items: v.array(v.string()),
});

export const aboutHighlightValidator = v.object({
	key: v.string(),
	label: v.optional(v.string()),
	value: v.optional(v.string()),
});

/**
 * About drafts contain content and tenant-owned public-media references only.
 * Layout, carousel behavior, contact operations, and site navigation remain
 * host-owned concerns.
 */
export const aboutPageDraftPayloadValidator = v.object({
	heading: v.optional(v.string()),
	displayName: v.optional(v.string()),
	role: v.optional(v.string()),
	introduction: v.optional(v.string()),
	biography: v.optional(v.string()),
	portraits: v.optional(v.array(aboutPortraitPlacementValidator)),
	sections: v.optional(v.array(aboutSectionValidator)),
	highlights: v.optional(v.array(aboutHighlightValidator)),
	seoDescription: v.optional(v.string()),
});

export type AboutPageDraftPayload = Infer<typeof aboutPageDraftPayloadValidator>;
export type AboutPortraitPlacement = NonNullable<AboutPageDraftPayload["portraits"]>[number];

export type PublishedAboutPage = {
	heading: string;
	displayName: string;
	role?: string;
	introduction?: string;
	biography?: string;
	portraits: Array<{
		key: string;
		assetId: AboutPortraitPlacement["assetId"];
		altText: string;
	}>;
	sections: Array<{ key: string; title: string; items: string[] }>;
	highlights: Array<{ key: string; label: string; value: string }>;
	seoDescription: string;
};

export const ABOUT_PORTRAIT_MAX = 10;

const LIMITS = {
	heading: 120,
	displayName: 200,
	role: 160,
	introduction: 2_000,
	biography: 8_000,
	portraits: ABOUT_PORTRAIT_MAX,
	placementKey: 100,
	altText: 500,
	sections: 12,
	sectionTitle: 120,
	sectionItems: 20,
	sectionItem: 500,
	highlights: 12,
	highlightLabel: 80,
	highlightValue: 300,
	seoDescription: 320,
} as const;

const ALLOWED_KEYS = new Set([
	"heading",
	"displayName",
	"role",
	"introduction",
	"biography",
	"portraits",
	"sections",
	"highlights",
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
export function validateAboutPageDraft(payload: AboutPageDraftPayload) {
	for (const key of Object.keys(payload)) {
		if (!ALLOWED_KEYS.has(key)) {
			throw new Error("About page payload contains an unsupported field");
		}
	}

	assertMaximum(payload.heading, LIMITS.heading, "About heading");
	assertMaximum(payload.displayName, LIMITS.displayName, "Display name");
	assertMaximum(payload.role, LIMITS.role, "Role");
	assertMaximum(payload.introduction, LIMITS.introduction, "Introduction");
	assertMaximum(payload.biography, LIMITS.biography, "Biography");
	assertMaximum(payload.seoDescription, LIMITS.seoDescription, "SEO description");

	const portraits = payload.portraits ?? [];
	if (portraits.length > LIMITS.portraits) {
		throw new Error(`Portrait sequences cannot contain more than ${LIMITS.portraits} images`);
	}
	assertUniqueKeys(portraits, "Portrait placement");
	if (new Set(portraits.map((portrait) => portrait.assetId)).size !== portraits.length) {
		throw new Error("Portrait assets must be unique");
	}
	for (const portrait of portraits) {
		assertMaximum(portrait.key, LIMITS.placementKey, "Portrait placement key");
		assertMaximum(portrait.altText, LIMITS.altText, "Portrait alt text");
	}

	const sections = payload.sections ?? [];
	if (sections.length > LIMITS.sections) {
		throw new Error(`About sections cannot contain more than ${LIMITS.sections} items`);
	}
	assertUniqueKeys(sections, "About section");
	for (const section of sections) {
		assertMaximum(section.key, LIMITS.placementKey, "About section key");
		assertMaximum(section.title, LIMITS.sectionTitle, "About section title");
		if (section.items.length > LIMITS.sectionItems) {
			throw new Error(
				`About sections cannot contain more than ${LIMITS.sectionItems} bullet items`,
			);
		}
		for (const item of section.items) {
			assertMaximum(item, LIMITS.sectionItem, "About section item");
		}
	}

	const highlights = payload.highlights ?? [];
	if (highlights.length > LIMITS.highlights) {
		throw new Error(`About highlights cannot contain more than ${LIMITS.highlights} items`);
	}
	assertUniqueKeys(highlights, "About highlight");
	for (const highlight of highlights) {
		assertMaximum(highlight.key, LIMITS.placementKey, "About highlight key");
		assertMaximum(highlight.label, LIMITS.highlightLabel, "Highlight label");
		assertMaximum(highlight.value, LIMITS.highlightValue, "Highlight value");
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

/** Normalize the public content while retaining internal asset references for projection. */
export function toPublishedAboutPage(payload: AboutPageDraftPayload): PublishedAboutPage {
	validateAboutPageDraft(payload);
	const portraits = payload.portraits ?? [];
	if (portraits.length === 0) {
		throw new Error("At least one portrait is required before publishing");
	}
	const normalizedPortraits = portraits.map((portrait, index) => {
		const altText = optionalText(
			portrait.altText,
			`Portrait ${index + 1} alt text`,
			LIMITS.altText,
		);
		if (!altText) {
			throw new Error(`Portrait ${index + 1} needs alt text before publishing`);
		}
		return {
			key: requireText(portrait.key, `Portrait ${index + 1} key`, LIMITS.placementKey),
			assetId: portrait.assetId,
			altText,
		};
	});
	const sections = (payload.sections ?? []).map((section, index) => ({
		key: requireText(section.key, `Section ${index + 1} key`, LIMITS.placementKey),
		title: requireText(section.title, `Section ${index + 1} title`, LIMITS.sectionTitle),
		items: section.items.map((item, itemIndex) =>
			requireText(
				item,
				`Section ${index + 1} item ${itemIndex + 1}`,
				LIMITS.sectionItem,
			),
		),
	}));
	const highlights = (payload.highlights ?? []).map((highlight, index) => ({
		key: requireText(highlight.key, `Highlight ${index + 1} key`, LIMITS.placementKey),
		label: requireText(
			highlight.label,
			`Highlight ${index + 1} label`,
			LIMITS.highlightLabel,
		),
		value: requireText(
			highlight.value,
			`Highlight ${index + 1} value`,
			LIMITS.highlightValue,
		),
	}));
	const introduction = optionalText(
		payload.introduction,
		"Introduction",
		LIMITS.introduction,
	);
	const biography = optionalText(payload.biography, "Biography", LIMITS.biography);
	if (!introduction && !biography && sections.length === 0) {
		throw new Error("About content needs an introduction, biography, or section");
	}

	return {
		heading: requireText(payload.heading, "About heading", LIMITS.heading),
		displayName: requireText(payload.displayName, "Display name", LIMITS.displayName),
		role: optionalText(payload.role, "Role", LIMITS.role),
		introduction,
		biography,
		portraits: normalizedPortraits,
		sections,
		highlights,
		seoDescription: requireText(
			payload.seoDescription,
			"SEO description",
			LIMITS.seoDescription,
		),
	};
}

/** Stable serialization preserves deliberate sequence order and revision identity. */
export function serializeAboutPagePayload(payload: AboutPageDraftPayload) {
	return JSON.stringify({
		heading: payload.heading ?? null,
		displayName: payload.displayName ?? null,
		role: payload.role ?? null,
		introduction: payload.introduction ?? null,
		biography: payload.biography ?? null,
		portraits: (payload.portraits ?? []).map((portrait) => ({
			key: portrait.key,
			assetId: portrait.assetId,
			altText: portrait.altText ?? null,
		})),
		sections: (payload.sections ?? []).map((section) => ({
			key: section.key,
			title: section.title ?? null,
			items: section.items,
		})),
		highlights: (payload.highlights ?? []).map((highlight) => ({
			key: highlight.key,
			label: highlight.label ?? null,
			value: highlight.value ?? null,
		})),
		seoDescription: payload.seoDescription ?? null,
	});
}

export function aboutPageReferencesAsset(
	payload: AboutPageDraftPayload,
	assetId: string,
) {
	return (payload.portraits ?? []).some((portrait) => portrait.assetId === assetId);
}
