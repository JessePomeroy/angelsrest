import { error } from "@sveltejs/kit";
import { ConvexHttpClient } from "convex/browser";
import { api } from "$convex/api";
import { env as privateEnv } from "$env/dynamic/private";
import { env as publicEnv } from "$env/dynamic/public";
import { SITE_DOMAIN } from "$lib/config/site";
import { urlFor } from "$lib/sanity/client";
import { getSanityClient } from "$lib/sanity/client.server";

const GALLERY_MAX = 100;
const PLACEMENT_MAX = 500;
const MEDIA_ORIGIN = `https://media.${SITE_DOMAIN}`;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const SANITY_IMAGE_REF = /^image-[A-Za-z0-9]+-\d+x\d+-[A-Za-z0-9]+$/;

const LIST_QUERY = `*[_type == "gallery"] | order(orderRank asc, _id asc)[0...101]{
	_id,
	_rev,
	title,
	"slug": slug.current,
	orderRank,
	"previewImage": images[0]{
		_key,
		alt,
		crop{bottom, left, right, top},
		hotspot{height, width, x, y},
		"assetRef": asset._ref,
		"width": asset->metadata.dimensions.width,
		"height": asset->metadata.dimensions.height
	}
}`;

const DETAIL_QUERY = `*[_type == "gallery" && slug.current == $slug][0...2]{
	_id,
	_rev,
	title,
	"slug": slug.current,
	description,
	images[]{
		_key,
		alt,
		crop{bottom, left, right, top},
		hotspot{height, width, x, y},
		"assetRef": asset._ref,
		"width": asset->metadata.dimensions.width,
		"height": asset->metadata.dimensions.height
	},
	seo{
		description,
		"ogImageUrl": ogImage.asset->url,
		"ogImage": ogImage{
			crop{bottom, left, right, top},
			hotspot{height, width, x, y},
			"assetRef": asset._ref,
			"width": asset->metadata.dimensions.width,
			"height": asset->metadata.dimensions.height
		}
	}
}`;

type ProviderMode = "sanity" | "convex";

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

type SanityClient = {
	fetch(query: string, params?: Record<string, string>): Promise<unknown>;
};
type SanitySource = {
	list(isPreview: boolean): Promise<PortfolioIndexGallery[]>;
	getBySlug(slug: string, isPreview: boolean): Promise<PortfolioDetail | null>;
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

function number(value: unknown, minimum: number, maximum: number) {
	if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum)
		fail();
	return value;
}

function canonical(value: unknown): string {
	if (value === null) return "null";
	if (typeof value === "number" || typeof value === "boolean" || typeof value === "string") {
		return JSON.stringify(value);
	}
	if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
	if (value && typeof value === "object") {
		return `{${Object.entries(value as Record<string, unknown>)
			.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
			.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
			.join(",")}}`;
	}
	return fail();
}

function crop(value: unknown) {
	if (value === null) return null;
	const item = object(value, ["bottom", "left", "right", "top"]);
	return {
		bottom: number(item.bottom, 0, 1),
		left: number(item.left, 0, 1),
		right: number(item.right, 0, 1),
		top: number(item.top, 0, 1),
	};
}

function hotspot(value: unknown) {
	if (value === null) return null;
	const item = object(value, ["height", "width", "x", "y"]);
	return {
		height: number(item.height, 0, 1),
		width: number(item.width, 0, 1),
		x: number(item.x, 0, 1),
		y: number(item.y, 0, 1),
	};
}

type SanityImage = ImageEvidence & {
	source: {
		asset: { _ref: string };
		crop?: ReturnType<typeof crop>;
		hotspot?: ReturnType<typeof hotspot>;
	};
};

function sanityImage(value: unknown, keyRequired = true): SanityImage {
	const item = object(value, ["_key", "alt", "crop", "hotspot", "assetRef", "width", "height"]);
	const assetRef = requiredText(item.assetRef, 500, SANITY_IMAGE_REF);
	const normalizedCrop = crop(item.crop);
	const normalizedHotspot = hotspot(item.hotspot);
	const key = item._key === null ? null : requiredText(item._key, 100);
	if (keyRequired && key === null) fail();
	return {
		key,
		assetRef,
		width: integer(item.width, 1, 100_000),
		height: integer(item.height, 1, 100_000),
		cropCanonical: canonical(normalizedCrop),
		hotspotCanonical: canonical(normalizedHotspot),
		alt: optionalText(item.alt, 500) ?? "",
		workerAssetId: null,
		sourceSha256: null,
		source: {
			asset: { _ref: assetRef },
			...(normalizedCrop ? { crop: normalizedCrop } : {}),
			...(normalizedHotspot ? { hotspot: normalizedHotspot } : {}),
		},
	};
}

function imageUrl(image: SanityImage, kind: "preview" | "thumbnail" | "full") {
	const builder = urlFor(image.source);
	if (kind === "preview") return builder.width(600).format("webp").quality(80).url();
	if (kind === "thumbnail") return builder.width(400).format("webp").quality(80).url();
	return builder.width(1600).format("webp").quality(90).url();
}

function titleDerivedCanonicalUrl(title: string) {
	return `https://${SITE_DOMAIN}/gallery/${title.toLowerCase().replace(/\s+/g, "-")}`;
}

function sanityEvidence(
	row: Record<string, unknown>,
	images: SanityImage[],
	seoDescription: string | null,
	seoOgImage: SanityImage | null,
): GalleryEvidence {
	const title = requiredText(row.title, 120);
	return {
		sourceId: requiredText(row._id, 256),
		sourceRevision: requiredText(row._rev, 256),
		slug: requiredText(row.slug, 96),
		title,
		description: optionalText(row.description, 2_000),
		canonicalUrl: titleDerivedCanonicalUrl(title),
		seoDescription,
		seoOgImage,
		images,
	};
}

export function adaptSanityPortfolioList(value: unknown): PortfolioIndexGallery[] {
	const rows = list(value, GALLERY_MAX);
	const content: PortfolioIndexGallery[] = [];
	for (const raw of rows) {
		const row = object(raw, ["_id", "_rev", "title", "slug", "orderRank", "previewImage"]);
		requiredText(row.orderRank, 256);
		const preview = row.previewImage === null ? null : sanityImage(row.previewImage);
		const item = sanityEvidence(
			{ ...row, description: null },
			preview ? [preview] : [],
			null,
			null,
		);
		content.push({
			title: item.title,
			slug: item.slug,
			preview: preview ? imageUrl(preview, "preview") : null,
		});
	}
	return content;
}

export function adaptSanityPortfolioDetail(value: unknown): PortfolioDetail | null {
	const rows = list(value, 2);
	if (rows.length === 0) return null;
	if (rows.length !== 1) fail();
	const row = object(rows[0], ["_id", "_rev", "title", "slug", "description", "images", "seo"]);
	const images = list(row.images, PLACEMENT_MAX).map((image) => sanityImage(image));
	let seoDescription: string | null = null;
	let seoOgImage: SanityImage | null = null;
	let seoContent: PortfolioDetail["seo"] = null;
	if (row.seo !== null) {
		const seo = object(row.seo, ["description", "ogImageUrl", "ogImage"]);
		seoDescription = optionalText(seo.description, 320);
		seoOgImage =
			seo.ogImage === null
				? null
				: sanityImage({ _key: null, alt: null, ...(seo.ogImage as object) }, false);
		const ogImageUrl = optionalText(seo.ogImageUrl, 2_048);
		if ((seoOgImage === null) !== (ogImageUrl === null)) fail();
		seoContent = { description: seoDescription, ogImageUrl };
	}
	const evidence = sanityEvidence(row, images, seoDescription, seoOgImage);
	return {
		title: evidence.title,
		description: evidence.description,
		canonicalUrl: evidence.canonicalUrl,
		seo: seoContent,
		images: images.map((image) => ({
			thumbnail: imageUrl(image, "thumbnail"),
			full: imageUrl(image, "full"),
			alt: image.alt,
		})),
	};
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
					: requiredText(item.sourceAssetRef, 500, SANITY_IMAGE_REF),
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

export function parsePortfolioProviderMode(value: unknown): ProviderMode {
	return value === "sanity" || value === "convex" ? value : "sanity";
}

export function createSanityPortfolioSource(
	selectClient: (isPreview: boolean) => SanityClient = getSanityClient,
): SanitySource {
	return {
		async list(isPreview) {
			return adaptSanityPortfolioList(await selectClient(isPreview).fetch(LIST_QUERY));
		},
		async getBySlug(slug, isPreview) {
			return adaptSanityPortfolioDetail(
				await selectClient(isPreview).fetch(DETAIL_QUERY, { slug }),
			);
		},
	};
}

function createConvexReader(): ConvexReader {
	function client(signal: AbortSignal) {
		return new ConvexHttpClient(publicEnv.PUBLIC_CONVEX_URL || "", {
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
	dependencies: {
		sanity?: SanitySource;
		mode?: () => unknown;
		createReader?: () => ConvexReader;
	} = {},
) {
	const sanity = dependencies.sanity ?? createSanityPortfolioSource();
	const mode = dependencies.mode ?? (() => privateEnv.PORTFOLIO_CONTENT_PROVIDER);
	const createReader = dependencies.createReader ?? createConvexReader;

	return {
		async list(isPreview: boolean) {
			if (isPreview) return await sanity.list(true);
			const provider = parsePortfolioProviderMode(mode());
			if (provider === "convex") {
				try {
					return adaptConvexPortfolioList(
						await createReader().listPublished(new AbortController().signal),
					);
				} catch {
					unavailable();
				}
			}
			return await sanity.list(false);
		},
		async getBySlug(slug: string, isPreview: boolean) {
			if (isPreview) return await sanity.getBySlug(slug, true);
			const provider = parsePortfolioProviderMode(mode());
			if (provider === "convex") {
				try {
					return adaptConvexPortfolioDetail(
						await createReader().getPublishedBySlug(slug, new AbortController().signal),
					);
				} catch {
					unavailable();
				}
			}
			return await sanity.getBySlug(slug, false);
		},
	};
}

export const portfolioContent = createPortfolioContentProvider();
