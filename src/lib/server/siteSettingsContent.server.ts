import { error } from "@sveltejs/kit";
import { ConvexHttpClient } from "convex/browser";
import { api } from "$convex/api";
import { env as privateEnv } from "$env/dynamic/private";
import { env as publicEnv } from "$env/dynamic/public";
import { SITE_DOMAIN } from "$lib/config/site";
import { getSanityClient } from "$lib/sanity/client.server";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256 = /^[a-f0-9]{64}$/;

type ProviderMode = "sanity" | "convex";
type SanityClient = { fetch(query: string): Promise<unknown> };
type SanitySource = {
	load(isPreview: boolean): Promise<SiteSettingsContent>;
};
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

const SANITY_QUERY = `{
	"siteSettings": *[_type == "siteSettings"][0...2]{
		artistName,
		siteTitle,
		tagline,
		"logoUrl": logo.asset->url,
		socialLinks[]{platform, url},
		seo{
			description,
			"ogImageUrl": ogImage.asset->url,
			"ogImageAssetRef": ogImage.asset._ref,
			"ogImageWidth": ogImage.asset->metadata.dimensions.width,
			"ogImageHeight": ogImage.asset->metadata.dimensions.height,
			keywords
		}
	}
}`;

export class SiteSettingsProjectionError extends Error {
	constructor() {
		super("Malformed public Site Settings projection");
	}
}

function fail(): never {
	throw new SiteSettingsProjectionError();
}

function object(
	value: unknown,
	required: readonly string[],
	optional: readonly string[] = [],
): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) fail();
	if (Object.getPrototypeOf(value) !== Object.prototype) fail();
	const keys = Reflect.ownKeys(value);
	if (keys.some((key) => typeof key !== "string")) fail();
	const allowed = new Set([...required, ...optional]);
	if (
		required.some((key) => !Object.hasOwn(value, key)) ||
		keys.some((key) => !allowed.has(key as string))
	)
		fail();
	return value as Record<string, unknown>;
}

function list(value: unknown, maximum: number): unknown[] {
	if (!Array.isArray(value) || value.length > maximum) fail();
	return value;
}

function nullableText(value: unknown, maximum: number): string | null {
	if (value === null) return null;
	if (typeof value !== "string" || value.length > maximum) fail();
	return value;
}

function requiredText(value: unknown, maximum: number): string {
	if (typeof value !== "string") fail();
	const normalized = value.trim();
	if (!normalized || normalized.length > maximum || normalized !== value) fail();
	return normalized;
}

function integer(value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
	if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum)
		fail();
	return value as number;
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

function nullableUrl(value: unknown): string | null {
	return value === null ? null : publicUrl(value);
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

function keywords(value: unknown): string[] {
	if (value === null) return [];
	return list(value, 100).map((entry) => requiredText(entry, 500));
}

function optionalInteger(value: unknown) {
	return value === null ? null : integer(value, 1, 100_000);
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

export function adaptSanitySiteSettings(value: unknown): SiteSettingsContent {
	const root = object(value, ["siteSettings"]);
	const rows = list(root.siteSettings, 2);
	if (rows.length !== 1) fail();
	const settings = object(rows[0], [
		"artistName",
		"siteTitle",
		"tagline",
		"logoUrl",
		"socialLinks",
		"seo",
	]);
	const seo =
		settings.seo === null
			? null
			: object(settings.seo, [
					"description",
					"ogImageUrl",
					"ogImageAssetRef",
					"ogImageWidth",
					"ogImageHeight",
					"keywords",
				]);
	const ogImageUrl = seo ? nullableUrl(seo.ogImageUrl) : null;
	const assetRef = seo ? nullableText(seo.ogImageAssetRef, 500) : null;
	const width = seo ? optionalInteger(seo.ogImageWidth) : null;
	const height = seo ? optionalInteger(seo.ogImageHeight) : null;
	if (
		(ogImageUrl === null && (assetRef !== null || width !== null || height !== null)) ||
		(ogImageUrl !== null && (assetRef === null || width === null || height === null))
	)
		fail();
	return {
		artistName: nullableText(settings.artistName, 120),
		siteTitle: nullableText(settings.siteTitle, 120),
		tagline: nullableText(settings.tagline, 300),
		logoUrl: nullableUrl(settings.logoUrl),
		socialLinks: socialLinks(settings.socialLinks),
		seo: {
			description: seo ? nullableText(seo.description, 320) : null,
			ogImageUrl,
			keywords: seo ? keywords(seo.keywords) : [],
		},
	};
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

export function parseSiteSettingsProviderMode(value: unknown): ProviderMode {
	return value === "sanity" || value === "convex" ? value : "sanity";
}

export function createSanitySiteSettingsSource(
	selectClient: (isPreview: boolean) => SanityClient = getSanityClient,
): SanitySource {
	return {
		async load(isPreview) {
			return adaptSanitySiteSettings(await selectClient(isPreview).fetch(SANITY_QUERY));
		},
	};
}

function createConvexReader(): ConvexReader {
	return {
		async loadPublished(signal) {
			const client = new ConvexHttpClient(publicEnv.PUBLIC_CONVEX_URL || "", {
				logger: false,
				fetch: (input, init) => fetch(input, { ...init, signal }),
			});
			return await client.query(api.content.getPublishedSiteSettingsWithRevision, {
				siteUrl: SITE_DOMAIN,
			});
		},
	};
}

function unavailable(): never {
	throw error(503, "Site Settings are unavailable");
}

export function createSiteSettingsContentProvider(
	dependencies: {
		sanity?: SanitySource;
		mode?: () => unknown;
		createReader?: () => ConvexReader;
	} = {},
) {
	const sanity = dependencies.sanity ?? createSanitySiteSettingsSource();
	const mode = dependencies.mode ?? (() => privateEnv.SITE_SETTINGS_CONTENT_PROVIDER);
	const createReader = dependencies.createReader ?? createConvexReader;

	async function loadConvex() {
		try {
			return adaptConvexSiteSettings(
				await createReader().loadPublished(new AbortController().signal),
			);
		} catch {
			unavailable();
		}
	}

	return {
		async load(isPreview: boolean) {
			if (isPreview) return await sanity.load(true);
			const provider = parseSiteSettingsProviderMode(mode());
			if (provider === "convex") return await loadConvex();
			return await sanity.load(false);
		},
	};
}

export const siteSettingsContent = createSiteSettingsContentProvider();
