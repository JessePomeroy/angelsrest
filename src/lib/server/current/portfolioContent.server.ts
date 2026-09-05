import { error } from "@sveltejs/kit";
import { ConvexHttpClient } from "convex/browser";
import { api } from "$convex/api";
import { SITE_DOMAIN } from "$lib/config/site";
import { getConvexUrl } from "$lib/server/runtimeConfig";

const GALLERY_MAX = 100;
const PLACEMENT_MAX = 500;
const MEDIA_ORIGIN = `https://media.${SITE_DOMAIN}`;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const LEGACY_SOURCE_IMAGE_REF = /^image-[A-Za-z0-9]+-\d+x\d+-[A-Za-z0-9]+$/;

export type PortfolioIndexGallery = {
	title: string;
	slug: string;
	preview: string | null;
};

export type PortfolioDetail = {
	title: string;
	description: string | null;
	canonicalUrl: string;
	seo: { description: string | null; ogImageUrl: string | null } | null;
	images: Array<{ thumbnail: string; full: string; alt: string }>;
};

type ImageEvidence = {
	key: string | null;
	assetRef: string;
	width: number;
	height: number;
	cropCanonical: string;
	hotspotCanonical: string;
	alt: string;
	workerAssetId: string | null;
	sourceSha256: string | null;
};

type GalleryEvidence = {
	sourceId: string | null;
	sourceRevision: string | null;
	slug: string;
	title: string;
	description: string | null;
	canonicalUrl: string;
	seoDescription: string | null;
	seoOgImage: ImageEvidence | null;
	images: ImageEvidence[];
};

type ConvexReader = {
	listPublished(signal: AbortSignal): Promise<unknown>;
	getPublishedBySlug(slug: string, signal: AbortSignal): Promise<unknown>;
};

export class PortfolioProjectionError extends Error {
	constructor() {
		super("Malformed public Portfolio projection");
	}
}

function fail(): never {
	throw new PortfolioProjectionError();
}

function object(value: unknown, required: readonly string[]): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) fail();
	if (Object.getPrototypeOf(value) !== Object.prototype) fail();
	const keys = Reflect.ownKeys(value);
	const allowed = new Set(required);
	if (
		keys.some((key) => typeof key !== "string") ||
		required.some((key) => !Object.hasOwn(value, key)) ||
		keys.some((key) => !allowed.has(key as string))
	)
		fail();
	return value as Record<string, unknown>;
}

function list(value: unknown, maximum: number) {
	if (!Array.isArray(value) || value.length > maximum) fail();
	return value;
}

function requiredText(value: unknown, maximum: number, pattern?: RegExp) {
	if (typeof value !== "string" || !value || value !== value.trim() || value.length > maximum)
		fail();
	if (pattern && !pattern.test(value)) fail();
	return value;
}

function optionalText(value: unknown, maximum: number) {
	if (value === null) return null;
	if (typeof value !== "string" || value.length > maximum) fail();
	return value;
}

function integer(value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
	if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum)
		fail();
	return value as number;
}

function titleDerivedCanonicalUrl(title: string) {
	return `https://${SITE_DOMAIN}/gallery/${title.toLowerCase().replace(/\s+/g, "-")}`;
}

function derivative(value: unknown, assetId: string, filename: string) {
	const item = object(value, ["key", "contentType", "width", "height"]);
	if (item.contentType !== "image/webp") fail();
	const key = requiredText(item.key, 500);
	if (key !== `sites/${SITE_DOMAIN}/web/${assetId}/${filename}`) fail();
	integer(item.width, 1, 100_000);
	integer(item.height, 1, 100_000);
	return `${MEDIA_ORIGIN}/${key}`;
}

function convexImage(value: unknown) {
	const item = object(value, [
		"key",
		"order",
		"altText",
		"caption",
		"focalPoint",
		"sourceAssetRef",
		"sourceCropCanonical",
		"sourceHotspotCanonical",
		"asset",
	]);
	const asset = object(item.asset, ["assetId", "source", "derivatives"]);
	const assetId = requiredText(asset.assetId, 36, UUID_V4);
	const source = object(asset.source, ["width", "height", "sha256"]);
	const derivatives = object(asset.derivatives, [
		"thumb",
		"card",
		"display1280",
		"display2048",
		"display2560",
	]);
	derivative(derivatives.thumb, assetId, "thumb.webp");
	const thumbnail = derivative(derivatives.card, assetId, "card.webp");
	derivative(derivatives.display1280, assetId, "display-1280.webp");
	const full = derivative(derivatives.display2048, assetId, "display-2048.webp");
	derivative(derivatives.display2560, assetId, "display-2560.webp");
	const sourceSha256 = source.sha256 === null ? null : requiredText(source.sha256, 64, SHA256);
	return {
		evidence: {
			key: requiredText(item.key, 100),
			assetRef:
				item.sourceAssetRef === null
					? ""
					: requiredText(item.sourceAssetRef, 500, LEGACY_SOURCE_IMAGE_REF),
			width: integer(source.width, 1, 100_000),
			height: integer(source.height, 1, 100_000),
			cropCanonical:
				item.sourceCropCanonical === null ? "" : requiredText(item.sourceCropCanonical, 500),
			hotspotCanonical:
				item.sourceHotspotCanonical === null ? "" : requiredText(item.sourceHotspotCanonical, 500),
			alt: optionalText(item.altText, 500) ?? "",
			workerAssetId: assetId,
			sourceSha256,
		},
		thumbnail,
		full,
	};
}

function adaptConvexGallery(value: unknown) {
	const row = object(value, [
		"galleryId",
		"revisionId",
		"sourceDocumentId",
		"sourceDocumentRevision",
		"title",
		"description",
		"slug",
		"portfolioOrder",
		"isVisible",
		"publishedAt",
		"seo",
		"placements",
	]);
	requiredText(row.galleryId, 100);
	requiredText(row.revisionId, 100);
	integer(row.portfolioOrder, 0, GALLERY_MAX - 1);
	integer(row.publishedAt);
	if (row.isVisible !== true) fail();
	const images = list(row.placements, PLACEMENT_MAX).map((rawPlacement, index) => {
		const item = convexImage(rawPlacement);
		const placement = object(rawPlacement, [
			"key",
			"order",
			"altText",
			"caption",
			"focalPoint",
			"sourceAssetRef",
			"sourceCropCanonical",
			"sourceHotspotCanonical",
			"asset",
		]);
		if (integer(placement.order, 0, PLACEMENT_MAX - 1) !== index) fail();
		return item;
	});
	const seo = object(row.seo, ["description", "ogImage"]);
	let seoOgImage: ImageEvidence | null = null;
	let ogImageUrl: string | null = null;
	if (seo.ogImage !== null) {
		const image = object(seo.ogImage, ["assetId", "sourceAssetRef", "source", "derivatives"]);
		const synthetic = convexImage({
			key: "seo",
			order: 0,
			altText: "SEO image",
			caption: null,
			focalPoint: null,
			sourceAssetRef: image.sourceAssetRef,
			sourceCropCanonical: null,
			sourceHotspotCanonical: null,
			asset: { assetId: image.assetId, source: image.source, derivatives: image.derivatives },
		});
		seoOgImage = synthetic.evidence;
		ogImageUrl = synthetic.full;
	}
	const title = requiredText(row.title, 120);
	const description = optionalText(row.description, 2_000);
	const slug = requiredText(row.slug, 80);
	const seoDescription = optionalText(seo.description, 320);
	const evidence: GalleryEvidence = {
		sourceId: row.sourceDocumentId === null ? null : requiredText(row.sourceDocumentId, 256),
		sourceRevision:
			row.sourceDocumentRevision === null ? null : requiredText(row.sourceDocumentRevision, 256),
		title,
		description,
		slug,
		canonicalUrl: titleDerivedCanonicalUrl(title),
		seoDescription,
		seoOgImage,
		images: images.map(({ evidence }) => evidence),
	};
	return {
		index: {
			title,
			slug,
			preview: images[0]?.thumbnail ?? null,
		} satisfies PortfolioIndexGallery,
		detail: {
			title,
			description,
			canonicalUrl: evidence.canonicalUrl,
			seo:
				seoDescription !== null || ogImageUrl !== null
					? { description: seoDescription, ogImageUrl }
					: null,
			images: images.map(({ evidence: image, thumbnail, full }) => ({
				thumbnail,
				full,
				alt: image.alt,
			})),
		} satisfies PortfolioDetail,
	};
}

export function adaptConvexPortfolioList(value: unknown): PortfolioIndexGallery[] {
	const galleries = list(value, GALLERY_MAX).map(adaptConvexGallery);
	return galleries.map(({ index }) => index);
}

export function adaptConvexPortfolioDetail(value: unknown): PortfolioDetail | null {
	if (value === null) return null;
	return adaptConvexGallery(value).detail;
}

function createConvexReader(): ConvexReader {
	function client(signal: AbortSignal) {
		return new ConvexHttpClient(getConvexUrl(), {
			logger: false,
			fetch: (input, init) => fetch(input, { ...init, signal }),
		});
	}
	return {
		async listPublished(signal) {
			return await client(signal).query(api.portfolioGalleries.listPublishedWithPlacements, {
				siteUrl: SITE_DOMAIN,
			});
		},
		async getPublishedBySlug(slug, signal) {
			return await client(signal).query(api.portfolioGalleries.getPublishedBySlug, {
				siteUrl: SITE_DOMAIN,
				slug,
			});
		},
	};
}

function unavailable(): never {
	throw error(503, "Portfolio is unavailable");
}

export function createPortfolioContentProvider(
	dependencies: { createReader?: () => ConvexReader } = {},
) {
	const createReader = dependencies.createReader ?? createConvexReader;

	return {
		async list() {
			try {
				return adaptConvexPortfolioList(
					await createReader().listPublished(AbortSignal.timeout(6_000)),
				);
			} catch {
				unavailable();
			}
		},
		async getBySlug(slug: string) {
			try {
				return adaptConvexPortfolioDetail(
					await createReader().getPublishedBySlug(slug, AbortSignal.timeout(6_000)),
				);
			} catch {
				unavailable();
			}
		},
	};
}

export const portfolioContent = createPortfolioContentProvider();
