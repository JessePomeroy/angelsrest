import { error } from "@sveltejs/kit";
import { ConvexHttpClient } from "convex/browser";
import { api } from "$convex/api";
import { env as privateEnv } from "$env/dynamic/private";
import { env as publicEnv } from "$env/dynamic/public";
import { SITE_DOMAIN } from "$lib/config/site";
import { getSanityClient } from "$lib/sanity/client.server";
import { logStructured } from "$lib/server/logger";

const SHADOW_DEADLINE_MS = 750;
const HOST_OG_IMAGE_FALLBACK = "/og-image.png";
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const ACCEPTED_OG_SOURCE = {
	assetRef: "image-0ccd0a41f44c6387c01425cd93579ac5a4a9f341-1848x1848-png",
	width: 1_848,
	height: 1_848,
	sha256: "c4c238f25cd39d63f55692fefde0a4bd11ff1a9cfd232e94e2dcd952d0fb6d97",
} as const;

type ProviderMode = "sanity" | "shadow" | "convex";
type ShadowCode = "site_settings" | "normalization_error" | "secondary_error" | "timeout";
type Comparison = {
	codes: ShadowCode[];
	mismatchCount: number;
	primaryCount: number | null;
	secondaryCount: number | null;
};
type SanityClient = { fetch(query: string): Promise<unknown> };
type OgEvidence =
	| {
			provider: "sanity";
			assetRef: string | null;
			width: number | null;
			height: number | null;
	  }
	| { provider: "convex"; sourceSha256: string };
type SiteSettingsCandidate = {
	content: SiteSettingsContent;
	ogEvidence: OgEvidence;
};
type SanitySource = {
	load(isPreview: boolean): Promise<SiteSettingsCandidate>;
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

function adaptSanityCandidate(value: unknown): SiteSettingsCandidate {
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
	const content: SiteSettingsContent = {
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
	return {
		content,
		ogEvidence: { provider: "sanity", assetRef, width, height },
	};
}

export function adaptSanitySiteSettings(value: unknown): SiteSettingsContent {
	return adaptSanityCandidate(value).content;
}

function adaptConvexCandidate(value: unknown): SiteSettingsCandidate {
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
	const content: SiteSettingsContent = {
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
	return {
		content,
		ogEvidence: { provider: "convex", sourceSha256: image.sourceSha256 },
	};
}

export function adaptConvexSiteSettings(value: unknown): SiteSettingsContent {
	return adaptConvexCandidate(value).content;
}

function comparable(value: SiteSettingsContent) {
	return {
		...value,
		// The accepted logo omission is behavior-neutral: the host does not render it.
		logoUrl: null,
		seo: {
			...value.seo,
			// Provider URLs necessarily differ after the exact asset transfer. Compare
			// explicit-image behavior against the host fallback boundary instead.
			ogImageUrl: value.seo.ogImageUrl === null ? HOST_OG_IMAGE_FALLBACK : "explicit",
		},
	};
}

function acceptedOgBinding(
	primary: SiteSettingsCandidate,
	secondary: SiteSettingsCandidate,
	expectedSourceSha256: string,
) {
	const sanity = primary.ogEvidence.provider === "sanity" ? primary : secondary;
	const convex = primary.ogEvidence.provider === "convex" ? primary : secondary;
	if (sanity.ogEvidence.provider !== "sanity" || convex.ogEvidence.provider !== "convex")
		return false;
	return (
		sanity.content.seo.ogImageUrl !== null &&
		convex.content.seo.ogImageUrl !== null &&
		sanity.ogEvidence.assetRef === ACCEPTED_OG_SOURCE.assetRef &&
		sanity.ogEvidence.width === ACCEPTED_OG_SOURCE.width &&
		sanity.ogEvidence.height === ACCEPTED_OG_SOURCE.height &&
		convex.ogEvidence.sourceSha256 === expectedSourceSha256
	);
}

function compareSiteSettings(
	primary: SiteSettingsCandidate,
	secondary: SiteSettingsCandidate,
	expectedSourceSha256: string,
): Comparison {
	const matches =
		JSON.stringify(comparable(primary.content)) === JSON.stringify(comparable(secondary.content)) &&
		acceptedOgBinding(primary, secondary, expectedSourceSha256);
	return {
		codes: matches ? [] : ["site_settings"],
		mismatchCount: matches ? 0 : 1,
		primaryCount: 1,
		secondaryCount: 1,
	};
}

export function parseSiteSettingsProviderMode(value: unknown): ProviderMode {
	return value === "sanity" || value === "shadow" || value === "convex" ? value : "sanity";
}

export function createSanitySiteSettingsSource(
	selectClient: (isPreview: boolean) => SanityClient = getSanityClient,
): SanitySource {
	return {
		async load(isPreview) {
			return adaptSanityCandidate(await selectClient(isPreview).fetch(SANITY_QUERY));
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
		log?: typeof logStructured;
		now?: () => number;
		deadlineMs?: number;
		acceptedOgSourceSha256?: string;
	} = {},
) {
	const sanity = dependencies.sanity ?? createSanitySiteSettingsSource();
	const mode = dependencies.mode ?? (() => privateEnv.SITE_SETTINGS_CONTENT_PROVIDER);
	const createReader = dependencies.createReader ?? createConvexReader;
	const log = dependencies.log ?? logStructured;
	const now = dependencies.now ?? Date.now;
	const deadlineMs = dependencies.deadlineMs ?? SHADOW_DEADLINE_MS;
	const acceptedOgSourceSha256 = dependencies.acceptedOgSourceSha256 ?? ACCEPTED_OG_SOURCE.sha256;

	function report(comparison: Comparison, startedAt: number) {
		if (comparison.codes.length === 0) return;
		log({
			event: "site_settings.shadow_closed",
			level: "warn",
			durationMs: Math.max(0, Math.min(deadlineMs, Math.round(now() - startedAt))),
			meta: {
				codes: comparison.codes,
				mismatchCount: comparison.mismatchCount,
				primaryCount: comparison.primaryCount,
				secondaryCount: comparison.secondaryCount,
			},
		});
	}

	function bounded(work: Promise<Comparison>, controller: AbortController) {
		let timer: ReturnType<typeof setTimeout> | undefined;
		return Promise.race([
			work,
			new Promise<Comparison>((resolve) => {
				timer = setTimeout(() => {
					controller.abort();
					resolve({
						codes: ["timeout"],
						mismatchCount: 1,
						primaryCount: null,
						secondaryCount: null,
					});
				}, deadlineMs);
			}),
		]).finally(() => clearTimeout(timer));
	}

	async function loadConvex() {
		try {
			return adaptConvexCandidate(await createReader().loadPublished(new AbortController().signal))
				.content;
		} catch {
			unavailable();
		}
	}

	async function loadShadow() {
		const startedAt = now();
		const controller = new AbortController();
		const primary = sanity.load(false);
		const comparison = bounded(
			(async () => {
				try {
					const [left, rawRight] = await Promise.all([
						primary,
						createReader().loadPublished(controller.signal),
					]);
					return compareSiteSettings(left, adaptConvexCandidate(rawRight), acceptedOgSourceSha256);
				} catch (cause) {
					return {
						codes: [
							cause instanceof SiteSettingsProjectionError
								? "normalization_error"
								: "secondary_error",
						] as ShadowCode[],
						mismatchCount: 1,
						primaryCount: null,
						secondaryCount: null,
					};
				}
			})(),
			controller,
		);
		try {
			const result = await primary;
			report(await comparison, startedAt);
			return result.content;
		} catch (cause) {
			controller.abort();
			throw cause;
		}
	}

	return {
		async load(isPreview: boolean) {
			if (isPreview) return (await sanity.load(true)).content;
			const provider = parseSiteSettingsProviderMode(mode());
			if (provider === "convex") return await loadConvex();
			if (provider === "shadow") return await loadShadow();
			return (await sanity.load(false)).content;
		},
	};
}

export const siteSettingsContent = createSiteSettingsContentProvider();
