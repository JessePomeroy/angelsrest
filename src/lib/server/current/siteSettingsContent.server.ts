import { error } from "@sveltejs/kit";
import { api } from "$convex/api";
import { SITE_DOMAIN } from "$lib/config/site";
import {
	convexReadClient,
	ProjectionError,
	projectionValidators,
} from "$lib/server/current/projection.server";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256 = /^[a-f0-9]{64}$/;

type ConvexReader = {
	loadPublished(signal: AbortSignal): Promise<unknown>;
};

export type SiteSettingsContent = {
	artistName: string | null;
	siteTitle: string | null;
	tagline: string | null;
	logoUrl: string | null;
	socialLinks: Array<{ platform: string; url: string }>;
	seo: {
		description: string | null;
		ogImageUrl: string | null;
		keywords: string[];
	};
};

function fail(): never {
	throw new ProjectionError("Malformed public Site Settings projection");
}

const { object, list, integer } = projectionValidators(fail);

function requiredText(value: unknown, maximum: number): string {
	if (typeof value !== "string") fail();
	const normalized = value.trim();
	if (!normalized || normalized.length > maximum || normalized !== value) fail();
	return normalized;
}

function publicUrl(value: unknown): string {
	const normalized = requiredText(value, 2_048);
	let parsed: URL;
	try {
		parsed = new URL(normalized);
	} catch {
		return fail();
	}
	if (
		(parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
		parsed.username ||
		parsed.password
	)
		fail();
	return normalized;
}

function socialLinks(value: unknown): Array<{ platform: string; url: string }> {
	if (value === null) return [];
	return list(value, 20).map((entry) => {
		const link = object(entry, ["platform", "url"]);
		return {
			platform: requiredText(link.platform, 50),
			url: publicUrl(link.url),
		};
	});
}

function convexOgImage(value: unknown) {
	const image = object(value, ["url", "assetId", "sourceSha256"]);
	const assetId = requiredText(image.assetId, 36);
	if (!UUID_V4.test(assetId)) fail();
	const url = publicUrl(image.url);
	if (url !== `https://media.${SITE_DOMAIN}/sites/${SITE_DOMAIN}/web/${assetId}/display-2048.webp`)
		fail();
	const sourceSha256 = requiredText(image.sourceSha256, 64);
	if (!SHA256.test(sourceSha256)) fail();
	return { url, sourceSha256 };
}

export function adaptConvexSiteSettings(value: unknown): SiteSettingsContent {
	const state = object(value, ["revisionId", "publishedAt", "payload"]);
	requiredText(state.revisionId, 100);
	integer(state.publishedAt);
	const payload = object(state.payload, [
		"artistName",
		"siteTitle",
		"tagline",
		"socialLinks",
		"seoDescription",
		"seoOgImage",
	]);
	const image = convexOgImage(payload.seoOgImage);
	return {
		artistName: requiredText(payload.artistName, 120),
		siteTitle: requiredText(payload.siteTitle, 120),
		tagline: requiredText(payload.tagline, 300),
		logoUrl: null,
		socialLinks: socialLinks(payload.socialLinks),
		seo: {
			description: requiredText(payload.seoDescription, 320),
			ogImageUrl: image.url,
			keywords: [],
		},
	};
}

function createConvexReader(): ConvexReader {
	return {
		async loadPublished(signal) {
			return await convexReadClient(signal).query(
				api.content.getPublishedSiteSettingsWithRevision,
				{ siteUrl: SITE_DOMAIN },
			);
		},
	};
}

function unavailable(): never {
	throw error(503, "Site Settings are unavailable");
}

export function createSiteSettingsContentProvider(
	dependencies: { createReader?: () => ConvexReader } = {},
) {
	const createReader = dependencies.createReader ?? createConvexReader;

	return {
		async load() {
			try {
				return adaptConvexSiteSettings(
					await createReader().loadPublished(AbortSignal.timeout(6_000)),
				);
			} catch {
				unavailable();
			}
		},
	};
}

export const siteSettingsContent = createSiteSettingsContentProvider();
