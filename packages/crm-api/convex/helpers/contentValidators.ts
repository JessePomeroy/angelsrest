import type { Infer } from "convex/values";
import { v } from "convex/values";

export const contentKindValidator = v.literal("siteSettings");

export const contentRevisionSourceValidator = v.union(
	v.literal("admin"),
	v.literal("sanityImport"),
	v.literal("restore"),
);

export const siteSettingsSocialLinkValidator = v.object({
	platform: v.string(),
	url: v.string(),
});

/**
 * Drafts intentionally allow incomplete or temporarily invalid values so
 * autosave never destroys an editor's work. Publication applies the stricter
 * semantic contract below.
 */
export const siteSettingsDraftPayloadValidator = v.object({
	artistName: v.optional(v.string()),
	siteTitle: v.optional(v.string()),
	tagline: v.optional(v.string()),
	socialLinks: v.optional(v.array(siteSettingsSocialLinkValidator)),
	seoDescription: v.optional(v.string()),
});

export type SiteSettingsDraftPayload = Infer<
	typeof siteSettingsDraftPayloadValidator
>;

export type PublishedSiteSettings = {
	artistName: string;
	siteTitle: string;
	tagline: string;
	socialLinks: Array<{ platform: string; url: string }>;
	seoDescription: string;
};

const LIMITS = {
	artistName: 120,
	siteTitle: 120,
	tagline: 300,
	seoDescription: 320,
	socialLinks: 20,
	socialPlatform: 50,
	socialUrl: 2_048,
} as const;

function assertMaximum(value: string | undefined, maximum: number, field: string) {
	if (value !== undefined && value.length > maximum) {
		throw new Error(`${field} must be ${maximum} characters or fewer`);
	}
}

/** Bound draft storage while retaining incomplete and semantically invalid input. */
export function validateSiteSettingsDraft(payload: SiteSettingsDraftPayload) {
	assertMaximum(payload.artistName, LIMITS.artistName, "Artist name");
	assertMaximum(payload.siteTitle, LIMITS.siteTitle, "Site title");
	assertMaximum(payload.tagline, LIMITS.tagline, "Tagline");
	assertMaximum(payload.seoDescription, LIMITS.seoDescription, "SEO description");

	const socialLinks = payload.socialLinks ?? [];
	if (socialLinks.length > LIMITS.socialLinks) {
		throw new Error(`Social links cannot contain more than ${LIMITS.socialLinks} items`);
	}
	for (const link of socialLinks) {
		assertMaximum(link.platform, LIMITS.socialPlatform, "Social platform");
		assertMaximum(link.url, LIMITS.socialUrl, "Social URL");
	}
}

function requireText(
	value: string | undefined,
	field: string,
	maximum: number,
) {
	const normalized = value?.trim() ?? "";
	if (!normalized) {
		throw new Error(`${field} is required before publishing`);
	}
	assertMaximum(normalized, maximum, field);
	return normalized;
}

function requirePublicUrl(value: string, field: string) {
	const normalized = value.trim();
	let parsed: URL;
	try {
		parsed = new URL(normalized);
	} catch {
		throw new Error(`${field} must be a valid public URL`);
	}
	if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
		throw new Error(`${field} must use http or https`);
	}
	return normalized;
}

/** Return the normalized, public-safe shape only after complete validation. */
export function toPublishedSiteSettings(
	payload: SiteSettingsDraftPayload,
): PublishedSiteSettings {
	validateSiteSettingsDraft(payload);
	const socialLinks = (payload.socialLinks ?? []).map((link, index) => ({
		platform: requireText(
			link.platform,
			`Social link ${index + 1} platform`,
			LIMITS.socialPlatform,
		),
		url: requirePublicUrl(link.url, `Social link ${index + 1} URL`),
	}));

	return {
		artistName: requireText(payload.artistName, "Artist name", LIMITS.artistName),
		siteTitle: requireText(payload.siteTitle, "Site title", LIMITS.siteTitle),
		tagline: requireText(payload.tagline, "Tagline", LIMITS.tagline),
		socialLinks,
		seoDescription: requireText(
			payload.seoDescription,
			"SEO description",
			LIMITS.seoDescription,
		),
	};
}

/** Stable serialization for revision identity and later migration parity checks. */
export function serializeSiteSettingsPayload(payload: SiteSettingsDraftPayload) {
	return JSON.stringify({
		artistName: payload.artistName ?? null,
		siteTitle: payload.siteTitle ?? null,
		tagline: payload.tagline ?? null,
		socialLinks: (payload.socialLinks ?? []).map((link) => ({
			platform: link.platform,
			url: link.url,
		})),
		seoDescription: payload.seoDescription ?? null,
	});
}
