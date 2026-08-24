import { getPaperBySlug, getSizeBySlug, getWholesaleCost } from "@jessepomeroy/print-catalog";
import { error } from "@sveltejs/kit";
import { ConvexHttpClient } from "convex/browser";
import type { FunctionReturnType } from "convex/server";
import { api } from "$convex/api";
import { env as privateEnv } from "$env/dynamic/private";
import { env as publicEnv } from "$env/dynamic/public";
import { SITE_DOMAIN } from "$lib/config/site";
import { getFreshPublishedSanityClient, getSanityClient } from "$lib/sanity/client.server";
import {
	adaptConvexIndex,
	adaptConvexPrintSet,
	adaptConvexProduct,
} from "$lib/server/convexShopAdapter";
import { logStructured } from "$lib/server/logger";
import { sanityShop } from "$lib/server/sanityShop.server";
import committedCatalogDisplayMediaTransferReceipts from "../../../scripts/cms/migrations/angelsrest-catalog/sanity-catalog-display-media-transfer-receipts.json";

type PublishedCatalog = FunctionReturnType<typeof api.catalogProductGraphs.listPublished>;
type ClosedReason = "mismatch" | "timeout" | "secondary_error" | "normalization_error";

type CatalogReader = {
	listPublished(signal: AbortSignal): Promise<PublishedCatalog>;
};

type SemanticProduct = { slug: string; value: { kind: string } };
type ComparisonOutcome = {
	reason?: ClosedReason;
	primaryCount: number | null;
	secondaryCount: number | null;
};

const MEDIA_ROLES = new Set(["primary", "cover", "gallery", "set_member", "social_share"]);
const COMPLETE_CATALOG_PRODUCT_COUNT = 33;
const COMPLETE_CATALOG_KIND_COUNTS: Record<string, number> = {
	print: 11,
	print_set: 2,
	postcard: 0,
	tapestry: 19,
	digital_download: 1,
	merchandise: 0,
};

const SANITY_COMPARISON_QUERY = `*[_type in ["lumaProductV2", "lumaPrintSetV2", "product"]] | order(_id asc)[0...34]{_type,"slug":slug.current,title,description,category,orderRank,inStock,featured,price,"hasCollection":defined(collection),"hasParent":defined(parent),variants[]{paper,size,retailPrice,enabled},bordersEnabled,framedEnabled,frameMarkupMultiplier,availablePapers,image{alt,"assetRef":asset._ref,"source":asset->metadata.dimensions{width,height}},previewImage{alt,"assetRef":asset._ref,"source":asset->metadata.dimensions{width,height}},images[]{alt,"assetRef":asset._ref,"source":asset->metadata.dimensions{width,height}},seo{description,ogImage{alt,"assetRef":asset._ref,"source":asset->metadata.dimensions{width,height}}}}`;

export function parseCatalogProviderMode(value: unknown) {
	return value === "shadow" || value === "convex" || value === "sanity" ? value : "sanity";
}

class NormalizationError extends Error {}

function record(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new NormalizationError();
	return value as Record<string, unknown>;
}

function array(value: unknown): unknown[] {
	if (!Array.isArray(value)) throw new NormalizationError();
	return value;
}

function slug(value: unknown) {
	if (typeof value !== "string" || !value || value !== value.trim()) throw new NormalizationError();
	return value;
}

function optionalString(value: unknown) {
	if (value === undefined || value === null || value === "") return null;
	if (typeof value !== "string" || value !== value.trim()) throw new NormalizationError();
	return value;
}

function optionalBoolean(value: unknown, fallback: boolean) {
	if (value === undefined || value === null) return fallback;
	if (typeof value !== "boolean") throw new NormalizationError();
	return value;
}

function cents(value: unknown) {
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0)
		throw new NormalizationError();
	const result = Math.round(value * 100);
	if (!Number.isSafeInteger(result) || result > 100_000_000 || result / 100 !== value)
		throw new NormalizationError();
	return result;
}

function positiveInteger(value: unknown) {
	if (!Number.isSafeInteger(value) || (value as number) <= 0) throw new NormalizationError();
	return value as number;
}

function dimensions(value: unknown) {
	const source = record(record(value).source);
	return { width: positiveInteger(source.width), height: positiveInteger(source.height) };
}

function printVariants(value: unknown) {
	const variants = array(value);
	if (variants.length === 0) throw new NormalizationError();
	return variants.flatMap((raw, order) => {
		const variant = record(raw);
		if (variant.enabled !== true && variant.enabled !== false && variant.enabled != null) {
			throw new NormalizationError();
		}
		const material = getPaperBySlug(slug(variant.paper));
		const size = getSizeBySlug(slug(variant.size));
		const retailPriceCents = cents(variant.retailPrice);
		if (!material || !size || getWholesaleCost(material.slug, size.slug) === null)
			throw new NormalizationError();
		return variant.enabled === true
			? [
					{
						order,
						material: { slug: material.slug, label: material.name },
						size: {
							slug: size.slug,
							label: size.label,
							widthInches: size.width,
							heightInches: size.height,
						},
						retailPriceCents,
					},
				]
			: [];
	});
}

function sanityPrintOptions(value: Record<string, unknown>) {
	const multiplier = value.frameMarkupMultiplier ?? 2;
	if (typeof multiplier !== "number" || !Number.isFinite(multiplier) || multiplier <= 0)
		throw new NormalizationError();
	const basisPoints = Math.round(multiplier * 10_000);
	if (!Number.isSafeInteger(basisPoints)) throw new NormalizationError();
	return {
		borderOptionsEnabled: optionalBoolean(value.bordersEnabled, true),
		frameOptionsEnabled: optionalBoolean(value.framedEnabled, false),
		framePriceMultiplierBasisPoints: basisPoints,
	};
}

function sanityMedia(value: Record<string, unknown>, type: string) {
	if (type === "lumaProductV2") {
		return [{ role: "primary", order: 0, source: dimensions(value.image) }];
	}
	if (type === "lumaPrintSetV2") {
		const images = array(value.images);
		const cover = value.previewImage ?? images[0];
		return [
			{ role: "cover", order: 0, source: dimensions(cover) },
			...images.map((image, order) => ({
				role: "set_member",
				order,
				source: dimensions(image),
			})),
		];
	}
	const images = array(value.images);
	if (images.length === 0) throw new NormalizationError();
	const media = images.map((image, order) => ({
		role: "gallery",
		order,
		source: dimensions(image),
	}));
	const seo = value.seo == null ? null : record(value.seo);
	if (seo?.ogImage != null) {
		media.push({ role: "social_share", order: 0, source: dimensions(seo.ogImage) });
	}
	return media;
}

const GENERAL_KINDS: Record<string, string> = {
	postcards: "postcard",
	tapestries: "tapestry",
	digital: "digital_download",
	merchandise: "merchandise",
};

function normalizeSanityCatalog(value: unknown): SemanticProduct[] {
	const products = array(value).map((raw) => {
		const product = record(raw);
		const type = slug(product._type);
		const isPrint = type === "lumaProductV2" || type === "lumaPrintSetV2";
		const kind =
			type === "lumaProductV2"
				? "print"
				: type === "lumaPrintSetV2"
					? "print_set"
					: type === "product" && typeof product.category === "string"
						? GENERAL_KINDS[product.category]
						: undefined;
		if (!kind || (type === "product" && product.category === "prints"))
			throw new NormalizationError();
		if (
			type === "product" &&
			product.availablePapers != null &&
			(!Array.isArray(product.availablePapers) || product.availablePapers.length > 0)
		)
			throw new NormalizationError();
		const variants = isPrint
			? printVariants(product.variants)
			: [
					{
						order: 0,
						material: null,
						size: null,
						retailPriceCents: cents(product.price),
					},
				];
		return {
			slug: slug(product.slug),
			value: {
				kind,
				availability: optionalBoolean(product.inStock, true) ? "available" : "unavailable",
				featured: optionalBoolean(product.featured, false),
				orderRank: type === "product" ? optionalString(product.orderRank) : null,
				variants,
				printOptions: isPrint ? sanityPrintOptions(product) : null,
				media: sanityMedia(product, type),
			},
		};
	});
	return sortedUnique(products);
}

function convexPrintOptions(value: unknown) {
	const options = record(value);
	if (typeof options.borderOptionsEnabled !== "boolean") throw new NormalizationError();
	if (typeof options.frameOptionsEnabled !== "boolean") throw new NormalizationError();
	return {
		borderOptionsEnabled: options.borderOptionsEnabled,
		frameOptionsEnabled: options.frameOptionsEnabled,
		framePriceMultiplierBasisPoints: positiveInteger(options.framePriceMultiplierBasisPoints),
	};
}

function normalizeConvexCatalog(value: unknown): SemanticProduct[] {
	const products = array(value).map((raw) => {
		const product = record(raw);
		const kind = slug(product.productKind);
		if (!Object.hasOwn(COMPLETE_CATALOG_KIND_COUNTS, kind)) throw new NormalizationError();
		const placement = record(product.shopPlacement);
		if (typeof placement.featured !== "boolean") throw new NormalizationError();
		const isPrint = kind === "print" || kind === "print_set";
		const variants = array(product.variants).map((rawVariant) => {
			const variant = record(rawVariant);
			if (!Number.isSafeInteger(variant.order) || (variant.order as number) < 0)
				throw new NormalizationError();
			if (!isPrint && (variant.materialOption !== null || variant.sizeOption !== null))
				throw new NormalizationError();
			const materialValue = isPrint ? record(variant.materialOption) : null;
			const sizeValue = isPrint ? record(variant.sizeOption) : null;
			return {
				order: variant.order,
				material: materialValue
					? { slug: slug(materialValue.slug), label: slug(materialValue.label) }
					: null,
				size: sizeValue
					? {
							slug: slug(sizeValue.slug),
							label: slug(sizeValue.label),
							widthInches: positiveInteger(sizeValue.widthInches),
							heightInches: positiveInteger(sizeValue.heightInches),
						}
					: null,
				retailPriceCents: positiveInteger(variant.retailPriceCents),
			};
		});
		const media = array(product.media).map((rawMedia) => {
			const item = record(rawMedia);
			const role = slug(item.role);
			if (!MEDIA_ROLES.has(role) || !Number.isSafeInteger(item.order) || (item.order as number) < 0)
				throw new NormalizationError();
			return { role, order: item.order, source: dimensions(record(item.asset)) };
		});
		const availability = product.saleAvailability;
		if (availability !== "available" && availability !== "unavailable")
			throw new NormalizationError();
		return {
			slug: slug(product.slug),
			value: {
				kind,
				availability,
				featured: placement.featured,
				orderRank: optionalString(placement.orderRank),
				variants,
				printOptions: isPrint ? convexPrintOptions(product.printOptions) : null,
				media,
			},
		};
	});
	return sortedUnique(products);
}

function sortedUnique(products: SemanticProduct[]) {
	products.sort((left, right) => (left.slug < right.slug ? -1 : left.slug > right.slug ? 1 : 0));
	if (products.some((product, index) => index > 0 && product.slug === products[index - 1]?.slug)) {
		throw new NormalizationError();
	}
	return products;
}

function assertCompleteCatalog(products: SemanticProduct[]) {
	if (products.length !== COMPLETE_CATALOG_PRODUCT_COUNT) throw new NormalizationError();
	for (const [kind, expected] of Object.entries(COMPLETE_CATALOG_KIND_COUNTS)) {
		if (products.filter((product) => product.value.kind === kind).length !== expected) {
			throw new NormalizationError();
		}
	}
}

export function compareCatalogSemantics(primary: unknown, secondary: unknown): ComparisonOutcome {
	const left = normalizeSanityCatalog(primary);
	const right = normalizeConvexCatalog(secondary);
	assertCompleteCatalog(left);
	assertCompleteCatalog(right);
	const matched =
		left.length === right.length &&
		left.every((product, index) => {
			const other = right[index];
			return (
				other?.slug === product.slug &&
				JSON.stringify(other.value) === JSON.stringify(product.value)
			);
		});
	return {
		...(matched ? {} : { reason: "mismatch" as const }),
		primaryCount: left.length,
		secondaryCount: right.length,
	};
}

type CatalogFacetProduct = { slug: string; kind: string };
type CommerceProduct = { slug: string; value: Record<string, unknown> };
type OrderProduct = CatalogFacetProduct & {
	title: string;
	availability: "available" | "unavailable";
	featured: boolean;
	orderRank: string | null;
};
type PresentationMedia = {
	role: string;
	order: number;
	altText: string | null;
	altValid: boolean;
	source: { width: number; height: number };
	sanityAssetRef: string | null;
	workerAssetId: string | null;
};
type PresentationProduct = CatalogFacetProduct & {
	title: string;
	description: string | null;
	seoDescription: string | null;
	media: PresentationMedia[];
};
type PresentationMismatchClass = "copy" | "mediaStructure" | "altText" | "dimensions";

export type PresentationMismatchCounts = Record<PresentationMismatchClass, number>;

export type ShopCatalogSentinelComparison = {
	outcome: "exact" | "mismatch";
	sanityCount: number;
	convexCount: number;
	distribution: "exact" | "mismatch";
	publicAdapterValidation: "exact" | "mismatch";
	commerceParity: "match" | "mismatch";
	presentationParity: "match" | "mismatch";
	presentationMismatchCounts: PresentationMismatchCounts;
	sanityPrintSetCoverFallbackCount: number;
	transferEquivalentDimensionCount: number;
	associationParity: "match" | "mismatch";
	productIndexOrder: "match" | "mismatch";
	printSetOrder: "match" | "mismatch";
};

export type ShopCatalogSentinelRead =
	| ShopCatalogSentinelComparison
	| {
			outcome: "unavailable";
			sanityCount: number | null;
			convexCount: number | null;
			distribution: "unavailable";
			publicAdapterValidation: "unavailable";
			commerceParity: "unavailable";
			presentationParity: "unavailable";
			presentationMismatchCounts: null;
			sanityPrintSetCoverFallbackCount: null;
			transferEquivalentDimensionCount: null;
			associationParity: "unavailable";
			productIndexOrder: "unavailable";
			printSetOrder: "unavailable";
	  };

class PresentationNormalizationError extends Error {
	constructor(readonly classification: PresentationMismatchClass) {
		super();
	}
}

function sanityProductKind(product: Record<string, unknown>) {
	const type = slug(product._type);
	if (type === "lumaProductV2") return "print";
	if (type === "lumaPrintSetV2") return "print_set";
	if (type === "product" && typeof product.category === "string") {
		const kind = GENERAL_KINDS[product.category];
		if (kind) return kind;
	}
	throw new NormalizationError();
}

function convexProductKind(product: Record<string, unknown>) {
	const kind = slug(product.productKind);
	if (!Object.hasOwn(COMPLETE_CATALOG_KIND_COUNTS, kind)) throw new NormalizationError();
	return kind;
}

function requiredBoolean(value: unknown) {
	if (typeof value !== "boolean") throw new NormalizationError();
	return value;
}

function sortedUniqueFacet<T extends { slug: string }>(products: T[]) {
	products.sort((left, right) => ordinal(left.slug, right.slug));
	if (products.some((product, index) => index > 0 && product.slug === products[index - 1]?.slug)) {
		throw new NormalizationError();
	}
	return products;
}

function normalizeSanityDistribution(value: unknown): CatalogFacetProduct[] {
	return sortedUniqueFacet(
		array(value).map((raw) => {
			const product = record(raw);
			return { slug: slug(product.slug), kind: sanityProductKind(product) };
		}),
	);
}

function normalizeConvexDistribution(value: unknown): CatalogFacetProduct[] {
	return sortedUniqueFacet(
		array(value).map((raw) => {
			const product = record(raw);
			return { slug: slug(product.slug), kind: convexProductKind(product) };
		}),
	);
}

function distributionMatches(products: CatalogFacetProduct[]) {
	return (
		products.length === COMPLETE_CATALOG_PRODUCT_COUNT &&
		Object.entries(COMPLETE_CATALOG_KIND_COUNTS).every(
			([kind, count]) => products.filter((product) => product.kind === kind).length === count,
		)
	);
}

function normalizeSanityCommerce(value: unknown): CommerceProduct[] {
	return sortedUniqueFacet(
		array(value).map((raw) => {
			const product = record(raw);
			const type = slug(product._type);
			const kind = sanityProductKind(product);
			const isPrint = kind === "print" || kind === "print_set";
			if (
				type === "product" &&
				product.availablePapers != null &&
				(!Array.isArray(product.availablePapers) || product.availablePapers.length > 0)
			) {
				throw new NormalizationError();
			}
			return {
				slug: slug(product.slug),
				value: {
					kind,
					availability: requiredBoolean(product.inStock) ? "available" : "unavailable",
					featured: optionalBoolean(product.featured, false),
					orderRank: type === "product" ? optionalString(product.orderRank) : null,
					variants: isPrint
						? printVariants(product.variants)
						: [
								{
									order: 0,
									material: null,
									size: null,
									retailPriceCents: cents(product.price),
								},
							],
					printOptions: isPrint ? sanityPrintOptions(product) : null,
				},
			};
		}),
	);
}

function normalizeConvexCommerce(value: unknown): CommerceProduct[] {
	return sortedUniqueFacet(
		array(value).map((raw) => {
			const product = record(raw);
			const kind = convexProductKind(product);
			const isPrint = kind === "print" || kind === "print_set";
			const placement = record(product.shopPlacement);
			if (typeof placement.featured !== "boolean") throw new NormalizationError();
			const availability = product.saleAvailability;
			if (availability !== "available" && availability !== "unavailable") {
				throw new NormalizationError();
			}
			const variants = array(product.variants).map((rawVariant) => {
				const variant = record(rawVariant);
				if (!Number.isSafeInteger(variant.order) || (variant.order as number) < 0) {
					throw new NormalizationError();
				}
				if (!isPrint && (variant.materialOption !== null || variant.sizeOption !== null)) {
					throw new NormalizationError();
				}
				const material = isPrint ? record(variant.materialOption) : null;
				const size = isPrint ? record(variant.sizeOption) : null;
				return {
					order: variant.order,
					material: material ? { slug: slug(material.slug), label: slug(material.label) } : null,
					size: size
						? {
								slug: slug(size.slug),
								label: slug(size.label),
								widthInches: positiveInteger(size.widthInches),
								heightInches: positiveInteger(size.heightInches),
							}
						: null,
					retailPriceCents: positiveInteger(variant.retailPriceCents),
				};
			});
			return {
				slug: slug(product.slug),
				value: {
					kind,
					availability,
					featured: placement.featured,
					orderRank: optionalString(placement.orderRank),
					variants,
					printOptions: isPrint ? convexPrintOptions(product.printOptions) : null,
				},
			};
		}),
	);
}

function normalizedAlt(value: unknown) {
	return optionalString(value);
}

function presentationRecord(value: unknown) {
	try {
		return record(value);
	} catch {
		throw new PresentationNormalizationError("mediaStructure");
	}
}

function presentationArray(value: unknown) {
	try {
		return array(value);
	} catch {
		throw new PresentationNormalizationError("mediaStructure");
	}
}

function presentationDimensions(value: unknown) {
	try {
		return dimensions(value);
	} catch {
		throw new PresentationNormalizationError("dimensions");
	}
}

function presentationAlt(value: unknown) {
	try {
		return normalizedAlt(value);
	} catch {
		throw new PresentationNormalizationError("altText");
	}
}

function sanityPresentationMedia(value: unknown, role: string, order: number): PresentationMedia {
	const image = presentationRecord(value);
	return {
		role,
		order,
		altText: presentationAlt(image.alt),
		altValid: true,
		source: presentationDimensions(image),
		sanityAssetRef: typeof image.assetRef === "string" ? image.assetRef : null,
		workerAssetId: null,
	};
}

function normalizeSanityPresentation(value: unknown): PresentationProduct[] {
	const products = presentationArray(value).map((raw) => {
		const product = presentationRecord(raw);
		let kind: string;
		let productSlug: string;
		let title: string;
		let description: string | null;
		let seo: Record<string, unknown> | null;
		try {
			kind = sanityProductKind(product);
			productSlug = slug(product.slug);
		} catch {
			throw new PresentationNormalizationError("mediaStructure");
		}
		try {
			title = slug(product.title);
			description = optionalString(product.description);
			seo = product.seo == null ? null : record(product.seo);
		} catch {
			throw new PresentationNormalizationError("copy");
		}
		const media: PresentationMedia[] = [];
		if (kind === "print") {
			media.push(sanityPresentationMedia(product.image, "primary", 0));
		} else if (kind === "print_set") {
			const images = presentationArray(product.images);
			media.push(sanityPresentationMedia(product.previewImage ?? images[0], "cover", 0));
			for (const [order, image] of images.entries()) {
				media.push(sanityPresentationMedia(image, "set_member", order));
			}
		} else {
			for (const [order, image] of presentationArray(product.images).entries()) {
				media.push(sanityPresentationMedia(image, "gallery", order));
			}
			if (seo?.ogImage != null) {
				media.push(sanityPresentationMedia(seo.ogImage, "social_share", 0));
			}
		}
		let seoDescription: string | null;
		try {
			seoDescription = optionalString(seo?.description);
		} catch {
			throw new PresentationNormalizationError("copy");
		}
		return { slug: productSlug, kind, title, description, seoDescription, media };
	});
	try {
		return sortedUniqueFacet(products);
	} catch {
		throw new PresentationNormalizationError("mediaStructure");
	}
}

const CONVEX_ASSET_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CONVEX_DOCUMENT_ID = /^[a-z0-9]{20,64}$/;
const LOWERCASE_SHA256 = /^[0-9a-f]{64}$/;
const SANITY_IMAGE_ASSET_REF = /^image-[0-9a-f]{40}-([1-9]\d*)x([1-9]\d*)-(jpg|png|webp)$/;
const CATALOG_DISPLAY_SOURCE_MAX_WIDTH = 4096;
const CATALOG_DISPLAY_SOURCE_MAX_BYTES = 20_000_000;
const CONVEX_DERIVATIVE_WIDTHS = {
	thumb: 320,
	card: 768,
	display1280: 1280,
	display2048: 2048,
	display2560: 2560,
} as const;

type TransferReceiptBinding = {
	workerAssetId: string;
	sanitySource: { width: number; height: number };
	transferredSource: {
		contentType: "image/jpeg" | "image/png" | "image/webp";
		sizeBytes: number;
		width: number;
		height: number;
	};
};

function exactReceiptRecord(value: unknown, keys: readonly string[]) {
	const candidate = record(value);
	const actualKeys = Object.keys(candidate).sort();
	const expectedKeys = [...keys].sort();
	if (!matches(actualKeys, expectedKeys)) throw new NormalizationError();
	return candidate;
}

function receiptString(value: unknown, pattern?: RegExp) {
	if (
		typeof value !== "string" ||
		!value ||
		value !== value.trim() ||
		(pattern && !pattern.test(value))
	) {
		throw new NormalizationError();
	}
	return value;
}

function receiptPositiveInteger(value: unknown, maximum = Number.MAX_SAFE_INTEGER) {
	const result = positiveInteger(value);
	if (result > maximum) throw new NormalizationError();
	return result;
}

function parseSanityImageAssetRef(value: string) {
	const match = SANITY_IMAGE_ASSET_REF.exec(value);
	if (!match) throw new NormalizationError();
	const width = Number(match[1]);
	const height = Number(match[2]);
	if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height)) throw new NormalizationError();
	const extension = match[3];
	return {
		width,
		height,
		contentType: (extension === "jpg" ? "image/jpeg" : `image/${extension}`) as
			| "image/jpeg"
			| "image/png"
			| "image/webp",
	};
}

function parseTransferReceiptBindings(value: unknown) {
	const root = exactReceiptRecord(value, ["schemaVersion", "siteUrl", "sanity", "receipts"]);
	if (root.schemaVersion !== 2 || root.siteUrl !== "angelsrest.online") {
		throw new NormalizationError();
	}
	const sanity = exactReceiptRecord(root.sanity, ["projectId", "dataset"]);
	if (sanity.projectId !== "n7rvza4g" || sanity.dataset !== "production") {
		throw new NormalizationError();
	}
	const receipts = record(root.receipts);
	const entries = Object.entries(receipts);
	if (entries.length !== COMPLETE_CATALOG_PRODUCT_COUNT) throw new NormalizationError();
	const bindings = new Map<string, TransferReceiptBinding>();
	const mediaAssetIds = new Set<string>();
	const workerAssetIds = new Set<string>();
	for (const [sanityAssetRef, rawReceipt] of entries) {
		const sanitySource = parseSanityImageAssetRef(sanityAssetRef);
		const receipt = exactReceiptRecord(rawReceipt, [
			"mediaAssetId",
			"workerAssetId",
			"sourceSha256",
			"source",
		]);
		const mediaAssetId = receiptString(receipt.mediaAssetId, CONVEX_DOCUMENT_ID);
		const workerAssetId = receiptString(receipt.workerAssetId, CONVEX_ASSET_ID);
		receiptString(receipt.sourceSha256, LOWERCASE_SHA256);
		if (mediaAssetIds.has(mediaAssetId) || workerAssetIds.has(workerAssetId)) {
			throw new NormalizationError();
		}
		mediaAssetIds.add(mediaAssetId);
		workerAssetIds.add(workerAssetId);
		const rawSource = exactReceiptRecord(receipt.source, [
			"contentType",
			"sizeBytes",
			"width",
			"height",
		]);
		const rawContentType = rawSource.contentType;
		if (
			rawContentType !== "image/jpeg" &&
			rawContentType !== "image/png" &&
			rawContentType !== "image/webp"
		) {
			throw new NormalizationError();
		}
		const contentType: TransferReceiptBinding["transferredSource"]["contentType"] = rawContentType;
		const transferredSource = {
			contentType,
			sizeBytes: receiptPositiveInteger(rawSource.sizeBytes, CATALOG_DISPLAY_SOURCE_MAX_BYTES),
			width: receiptPositiveInteger(rawSource.width, 100_000),
			height: receiptPositiveInteger(rawSource.height, 100_000),
		};
		const originalSource =
			transferredSource.contentType === sanitySource.contentType &&
			transferredSource.width === sanitySource.width &&
			transferredSource.height === sanitySource.height;
		const derivedWidth = Math.min(sanitySource.width, CATALOG_DISPLAY_SOURCE_MAX_WIDTH);
		const derivedHeight = Math.max(
			1,
			Math.round(sanitySource.height * (derivedWidth / sanitySource.width)),
		);
		const derivedSource =
			sanitySource.width > CATALOG_DISPLAY_SOURCE_MAX_WIDTH &&
			transferredSource.contentType === "image/jpeg" &&
			transferredSource.width === derivedWidth &&
			transferredSource.height === derivedHeight;
		if (!originalSource && !derivedSource) throw new NormalizationError();
		bindings.set(sanityAssetRef, { workerAssetId, sanitySource, transferredSource });
	}
	return bindings;
}

function convexPresentationAsset(value: unknown) {
	const asset = presentationRecord(value);
	if (typeof asset.assetId !== "string" || !CONVEX_ASSET_ID.test(asset.assetId)) {
		throw new PresentationNormalizationError("mediaStructure");
	}
	const source = presentationDimensions(asset);
	const derivatives = presentationRecord(asset.derivatives);
	for (const [name, maximumWidth] of Object.entries(CONVEX_DERIVATIVE_WIDTHS)) {
		const derivative = presentationRecord(derivatives[name]);
		if (derivative.contentType !== "image/webp") {
			throw new PresentationNormalizationError("mediaStructure");
		}
		const derivativeDimensions = presentationDimensions({ source: derivative });
		const width = Math.min(source.width, maximumWidth);
		const height = Math.max(1, Math.round(source.height * (width / source.width)));
		if (
			derivativeDimensions.width !== width ||
			Math.abs(derivativeDimensions.height - height) > 1
		) {
			throw new PresentationNormalizationError("dimensions");
		}
	}
	return { source, workerAssetId: asset.assetId };
}

function normalizeConvexPresentation(value: unknown): PresentationProduct[] {
	const products = presentationArray(value).map((raw) => {
		const product = presentationRecord(raw);
		let kind: string;
		let productSlug: string;
		try {
			kind = convexProductKind(product);
			productSlug = slug(product.slug);
		} catch {
			throw new PresentationNormalizationError("mediaStructure");
		}
		let title: string;
		let description: string | null;
		let seoDescription: string | null;
		try {
			title = slug(product.title);
			description = optionalString(product.description);
			seoDescription = optionalString(product.seoDescription);
		} catch {
			throw new PresentationNormalizationError("copy");
		}
		const rawMedia = presentationArray(product.media);
		if (rawMedia.length === 0 || rawMedia.length > 50) {
			throw new PresentationNormalizationError("mediaStructure");
		}
		const keys = new Set<string>();
		const roleOrders = new Map<string, number>();
		const media = rawMedia.map((rawItem) => {
			const item = presentationRecord(rawItem);
			let key: string;
			let role: string;
			try {
				key = slug(item.key);
				role = slug(item.role);
			} catch {
				throw new PresentationNormalizationError("mediaStructure");
			}
			if (
				keys.has(key) ||
				!MEDIA_ROLES.has(role) ||
				!Number.isSafeInteger(item.order) ||
				(item.order as number) !== (roleOrders.get(role) ?? 0)
			) {
				throw new PresentationNormalizationError("mediaStructure");
			}
			keys.add(key);
			roleOrders.set(role, (item.order as number) + 1);
			const altText = presentationAlt(item.altText);
			const asset = convexPresentationAsset(item.asset);
			return {
				role,
				order: item.order as number,
				altText,
				altValid: role === "social_share" || altText !== null,
				source: asset.source,
				sanityAssetRef: null,
				workerAssetId: asset.workerAssetId,
			};
		});
		const requiredRole = kind === "print" ? "primary" : kind === "print_set" ? "cover" : "gallery";
		if (
			!media.some(({ role }) => role === requiredRole) ||
			(kind === "print_set" && !media.some(({ role }) => role === "set_member"))
		) {
			throw new PresentationNormalizationError("mediaStructure");
		}
		return { slug: productSlug, kind, title, description, seoDescription, media };
	});
	try {
		return sortedUniqueFacet(products);
	} catch {
		throw new PresentationNormalizationError("mediaStructure");
	}
}

function ordinal(left: string, right: string) {
	return left < right ? -1 : left > right ? 1 : 0;
}

function matches(left: unknown, right: unknown) {
	return JSON.stringify(left) === JSON.stringify(right);
}

function facetParity(left: () => unknown, right: () => unknown): "match" | "mismatch" {
	try {
		return matches(left(), right()) ? "match" : "mismatch";
	} catch {
		return "mismatch";
	}
}

function emptyPresentationMismatchCounts(): PresentationMismatchCounts {
	return { copy: 0, mediaStructure: 0, altText: 0, dimensions: 0 };
}

function addPresentationMismatch(
	counts: PresentationMismatchCounts,
	classification: PresentationMismatchClass,
) {
	counts[classification] = Math.min(COMPLETE_CATALOG_PRODUCT_COUNT, counts[classification] + 1);
}

function sortedPresentationMedia(media: PresentationMedia[]) {
	return [...media].sort(
		(left, right) => ordinal(left.role, right.role) || left.order - right.order,
	);
}

function receiptBackedTransferEquivalent(
	sanityMedia: PresentationMedia,
	convexMedia: PresentationMedia,
	bindings: Map<string, TransferReceiptBinding> | null,
) {
	if (!bindings || !sanityMedia.sanityAssetRef || !convexMedia.workerAssetId) return false;
	const binding = bindings.get(sanityMedia.sanityAssetRef);
	return (
		binding !== undefined &&
		binding.workerAssetId === convexMedia.workerAssetId &&
		binding.sanitySource.width === sanityMedia.source.width &&
		binding.sanitySource.height === sanityMedia.source.height &&
		binding.transferredSource.width === convexMedia.source.width &&
		binding.transferredSource.height === convexMedia.source.height
	);
}

function presentationComparison(primary: unknown, secondary: unknown, transferReceipts: unknown) {
	const counts = emptyPresentationMismatchCounts();
	let transferEquivalentDimensionCount = 0;
	let transferBindings: Map<string, TransferReceiptBinding> | null = null;
	try {
		transferBindings = parseTransferReceiptBindings(transferReceipts);
	} catch {
		transferBindings = null;
	}
	let sanity: PresentationProduct[] | null = null;
	let convex: PresentationProduct[] | null = null;
	try {
		sanity = normalizeSanityPresentation(primary);
	} catch (cause) {
		addPresentationMismatch(
			counts,
			cause instanceof PresentationNormalizationError ? cause.classification : "mediaStructure",
		);
	}
	try {
		convex = normalizeConvexPresentation(secondary);
	} catch (cause) {
		addPresentationMismatch(
			counts,
			cause instanceof PresentationNormalizationError ? cause.classification : "mediaStructure",
		);
	}
	if (sanity && convex) {
		const sanityBySlug = new Map(sanity.map((product) => [product.slug, product]));
		const convexBySlug = new Map(convex.map((product) => [product.slug, product]));
		const productSlugs = new Set([...sanityBySlug.keys(), ...convexBySlug.keys()]);
		for (const productSlug of productSlugs) {
			const left = sanityBySlug.get(productSlug);
			const right = convexBySlug.get(productSlug);
			if (!left || !right || left.kind !== right.kind) {
				addPresentationMismatch(counts, "mediaStructure");
				continue;
			}
			if (
				left.title !== right.title ||
				left.description !== right.description ||
				left.seoDescription !== right.seoDescription
			) {
				addPresentationMismatch(counts, "copy");
			}
			const leftMedia = sortedPresentationMedia(left.media);
			const rightMedia = sortedPresentationMedia(right.media);
			if (
				leftMedia.length !== rightMedia.length ||
				leftMedia.some(
					(item, index) =>
						item.role !== rightMedia[index]?.role || item.order !== rightMedia[index]?.order,
				)
			) {
				addPresentationMismatch(counts, "mediaStructure");
				continue;
			}
			if (
				leftMedia.some(
					(item, index) =>
						!item.altValid ||
						!rightMedia[index]?.altValid ||
						item.altText !== rightMedia[index]?.altText,
				)
			) {
				addPresentationMismatch(counts, "altText");
			}
			let blockingDimensionMismatch = false;
			for (const [index, item] of leftMedia.entries()) {
				const other = rightMedia[index];
				if (
					other &&
					item.source.width === other.source.width &&
					item.source.height === other.source.height
				) {
					continue;
				}
				if (other && receiptBackedTransferEquivalent(item, other, transferBindings)) {
					transferEquivalentDimensionCount = Math.min(
						COMPLETE_CATALOG_PRODUCT_COUNT,
						transferEquivalentDimensionCount + 1,
					);
				} else {
					blockingDimensionMismatch = true;
				}
			}
			if (blockingDimensionMismatch) {
				addPresentationMismatch(counts, "dimensions");
			}
		}
	}
	return {
		parity: Object.values(counts).some((count) => count > 0)
			? ("mismatch" as const)
			: ("match" as const),
		counts,
		transferEquivalentDimensionCount,
	};
}

function sanityPrintSetCoverFallbackCount(value: unknown) {
	if (!Array.isArray(value)) return 0;
	let count = 0;
	for (const raw of value) {
		if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
		const product = raw as Record<string, unknown>;
		if (
			product._type === "lumaPrintSetV2" &&
			product.previewImage == null &&
			Array.isArray(product.images) &&
			product.images[0] != null
		) {
			count += 1;
		}
	}
	return Math.min(COMPLETE_CATALOG_KIND_COUNTS.print_set ?? 0, count);
}

function normalizeSanityAssociations(value: unknown) {
	return sortedUniqueFacet(
		array(value).map((raw) => {
			const product = record(raw);
			return {
				slug: slug(product.slug),
				association:
					requiredBoolean(product.hasCollection) || requiredBoolean(product.hasParent)
						? "present"
						: "absent",
			};
		}),
	);
}

function normalizeConvexAssociations(value: unknown) {
	return sortedUniqueFacet(
		array(value).map((raw) => ({ slug: slug(record(raw).slug), association: "absent" })),
	);
}

function sanityOrderProduct(
	product: Record<string, unknown>,
	kind = sanityProductKind(product),
): OrderProduct {
	return {
		slug: slug(product.slug),
		kind,
		title: slug(product.title),
		availability: requiredBoolean(product.inStock) ? "available" : "unavailable",
		featured: optionalBoolean(product.featured, false),
		orderRank: kind === "print" || kind === "print_set" ? null : optionalString(product.orderRank),
	};
}

function convexOrderProduct(
	product: Record<string, unknown>,
	kind = convexProductKind(product),
): OrderProduct {
	const placement = record(product.shopPlacement);
	if (typeof placement.featured !== "boolean") throw new NormalizationError();
	const availability = product.saleAvailability;
	if (availability !== "available" && availability !== "unavailable") {
		throw new NormalizationError();
	}
	return {
		slug: slug(product.slug),
		kind,
		title: slug(product.title),
		availability,
		featured: placement.featured,
		orderRank: optionalString(placement.orderRank),
	};
}

function comparePresentationOrder(left: OrderProduct, right: OrderProduct) {
	if (left.featured !== right.featured) return left.featured ? -1 : 1;
	if (left.orderRank === null && right.orderRank !== null) return 1;
	if (left.orderRank !== null && right.orderRank === null) return -1;
	const byRank = ordinal(left.orderRank ?? "", right.orderRank ?? "");
	return byRank || ordinal(left.title, right.title) || ordinal(left.slug, right.slug);
}

function productIndexOrder(products: OrderProduct[]) {
	const available = products.filter(
		(product) => product.availability === "available" && product.kind !== "print_set",
	);
	const bucket = (featured: boolean) => {
		const selected = available.filter((product) => product.featured === featured);
		const prints = selected
			.filter((product) => product.kind === "print")
			.sort((left, right) => ordinal(left.title, right.title) || ordinal(left.slug, right.slug));
		const general = selected
			.filter((product) => product.kind !== "print")
			.sort(comparePresentationOrder);
		return [...prints, ...general];
	};
	return [...bucket(true), ...bucket(false)].map(({ slug }) => slug);
}

function normalizeProductOrder(value: unknown, provider: "sanity" | "convex") {
	const products = array(value).flatMap((raw) => {
		const recordValue = record(raw);
		const kind =
			provider === "sanity" ? sanityProductKind(recordValue) : convexProductKind(recordValue);
		if (kind === "print_set") return [];
		return [
			provider === "sanity"
				? sanityOrderProduct(recordValue, kind)
				: convexOrderProduct(recordValue, kind),
		];
	});
	return productIndexOrder(sortedUniqueFacet(products));
}

function normalizeSanityPrintSetOrder(value: unknown) {
	return sortedUniqueFacet(
		array(value).flatMap((raw) => {
			const recordValue = record(raw);
			const kind = sanityProductKind(recordValue);
			return kind === "print_set" ? [sanityOrderProduct(recordValue, kind)] : [];
		}),
	)
		.filter((product) => product.availability === "available")
		.sort(
			(left, right) =>
				Number(right.featured) - Number(left.featured) ||
				ordinal(left.title, right.title) ||
				ordinal(left.slug, right.slug),
		)
		.map(({ slug }) => slug);
}

function normalizeConvexPrintSetOrder(value: unknown) {
	const products = array(value).flatMap((raw) => {
		const recordValue = record(raw);
		const kind = convexProductKind(recordValue);
		return kind === "print_set" ? [convexOrderProduct(recordValue, kind)] : [];
	});
	if (new Set(products.map(({ slug }) => slug)).size !== products.length) {
		throw new NormalizationError();
	}
	return products.filter((product) => product.availability === "available").map(({ slug }) => slug);
}

export function compareShopCatalogSentinel(
	primary: unknown,
	secondary: unknown,
	transferReceipts: unknown = committedCatalogDisplayMediaTransferReceipts,
): ShopCatalogSentinelComparison {
	const sanityCount = Array.isArray(primary) ? primary.length : 0;
	const convexCount = Array.isArray(secondary) ? secondary.length : 0;
	let distribution: "exact" | "mismatch" = "mismatch";
	try {
		const sanity = normalizeSanityDistribution(primary);
		const convex = normalizeConvexDistribution(secondary);
		distribution =
			distributionMatches(sanity) && distributionMatches(convex) ? "exact" : "mismatch";
	} catch {
		distribution = "mismatch";
	}
	let publicAdapterValidation: "exact" | "mismatch" = "mismatch";
	try {
		adaptConvexIndex(secondary);
		publicAdapterValidation = "exact";
	} catch {
		publicAdapterValidation = "mismatch";
	}
	const commerceParity = facetParity(
		() => normalizeSanityCommerce(primary),
		() => normalizeConvexCommerce(secondary),
	);
	const presentation = presentationComparison(primary, secondary, transferReceipts);
	const associationParity = facetParity(
		() => normalizeSanityAssociations(primary),
		() => normalizeConvexAssociations(secondary),
	);
	const productOrder = facetParity(
		() => normalizeProductOrder(primary, "sanity"),
		() => normalizeProductOrder(secondary, "convex"),
	);
	const setOrder = facetParity(
		() => normalizeSanityPrintSetOrder(primary),
		() => normalizeConvexPrintSetOrder(secondary),
	);
	const outcome =
		distribution === "exact" &&
		publicAdapterValidation === "exact" &&
		commerceParity === "match" &&
		presentation.parity === "match" &&
		associationParity === "match" &&
		productOrder === "match" &&
		setOrder === "match"
			? "exact"
			: "mismatch";
	return {
		outcome,
		sanityCount,
		convexCount,
		distribution,
		publicAdapterValidation,
		commerceParity,
		presentationParity: presentation.parity,
		presentationMismatchCounts: presentation.counts,
		sanityPrintSetCoverFallbackCount: sanityPrintSetCoverFallbackCount(primary),
		transferEquivalentDimensionCount: presentation.transferEquivalentDimensionCount,
		associationParity,
		productIndexOrder: productOrder,
		printSetOrder: setOrder,
	};
}

export async function readShopCatalogSentinel(
	dependencies: {
		fetchSanityCatalog?: (signal: AbortSignal) => Promise<unknown>;
		createReader?: () => CatalogReader;
		deadlineMs?: number;
	} = {},
): Promise<ShopCatalogSentinelRead> {
	const controller = new AbortController();
	const deadlineMs = dependencies.deadlineMs ?? 6_000;
	const fetchSanityCatalog =
		dependencies.fetchSanityCatalog ??
		((signal: AbortSignal) =>
			getFreshPublishedSanityClient().fetch(
				SANITY_COMPARISON_QUERY,
				{},
				{ perspective: "published", signal },
			));
	const createReaderDependency = dependencies.createReader ?? createCatalogReader;
	const reads = Promise.allSettled([
		Promise.resolve().then(() => fetchSanityCatalog(controller.signal)),
		Promise.resolve().then(() => createReaderDependency().listPublished(controller.signal)),
	]);
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timed = await Promise.race([
		reads.then((results) => ({ kind: "results" as const, results })),
		new Promise<{ kind: "timeout" }>((resolve) => {
			timer = setTimeout(() => {
				controller.abort();
				resolve({ kind: "timeout" });
			}, deadlineMs);
		}),
	]).finally(() => {
		controller.abort();
		clearTimeout(timer);
	});
	if (timed.kind === "timeout") return unavailableShopCatalogSentinel();
	const [sanity, convex] = timed.results;
	if (!sanity || !convex || sanity.status === "rejected" || convex.status === "rejected") {
		return unavailableShopCatalogSentinel(
			sanity?.status === "fulfilled" && Array.isArray(sanity.value) ? sanity.value.length : null,
			convex?.status === "fulfilled" && Array.isArray(convex.value) ? convex.value.length : null,
		);
	}
	return compareShopCatalogSentinel(sanity.value, convex.value);
}

function unavailableShopCatalogSentinel(
	sanityCount: number | null = null,
	convexCount: number | null = null,
): ShopCatalogSentinelRead {
	return {
		outcome: "unavailable",
		sanityCount,
		convexCount,
		distribution: "unavailable",
		publicAdapterValidation: "unavailable",
		commerceParity: "unavailable",
		presentationParity: "unavailable",
		presentationMismatchCounts: null,
		sanityPrintSetCoverFallbackCount: null,
		transferEquivalentDimensionCount: null,
		associationParity: "unavailable",
		productIndexOrder: "unavailable",
		printSetOrder: "unavailable",
	};
}

function createCatalogReader(): CatalogReader {
	const request = (signal: AbortSignal) =>
		new ConvexHttpClient(publicEnv.PUBLIC_CONVEX_URL || "", {
			logger: false,
			fetch: (input, init) => fetch(input, { ...init, signal }),
		});
	return {
		listPublished: (signal) =>
			request(signal).query(api.catalogProductGraphs.listPublished, {
				siteUrl: SITE_DOMAIN,
			}),
	};
}

export function createCatalogShopProvider(
	dependencies: {
		sanity?: typeof sanityShop;
		mode?: () => unknown;
		fetchSanityCatalog?: (signal: AbortSignal) => Promise<unknown>;
		createReader?: () => CatalogReader;
		log?: typeof logStructured;
		now?: () => number;
		deadlineMs?: number;
	} = {},
) {
	const sanity = dependencies.sanity ?? sanityShop;
	const mode = dependencies.mode ?? (() => privateEnv.SHOP_CATALOG_PROVIDER);
	const fetchSanityCatalog =
		dependencies.fetchSanityCatalog ??
		((signal) => getSanityClient(false).fetch(SANITY_COMPARISON_QUERY, {}, { signal }));
	const reader = dependencies.createReader ?? createCatalogReader;
	const log = dependencies.log ?? logStructured;
	const now = dependencies.now ?? Date.now;
	const deadlineMs = dependencies.deadlineMs ?? 750;

	async function compare(signal: AbortSignal): Promise<ComparisonOutcome> {
		const [primaryResult, secondaryResult] = await Promise.allSettled([
			Promise.resolve().then(() => fetchSanityCatalog(signal)),
			Promise.resolve().then(() => reader().listPublished(signal)),
		]);
		const primary = primaryResult.status === "fulfilled" ? primaryResult.value : undefined;
		const secondary = secondaryResult.status === "fulfilled" ? secondaryResult.value : undefined;
		if (primaryResult.status === "rejected" || secondaryResult.status === "rejected") {
			return {
				reason: "secondary_error",
				primaryCount: Array.isArray(primary) ? primary.length : null,
				secondaryCount: Array.isArray(secondary) ? secondary.length : null,
			};
		}
		try {
			return compareCatalogSemantics(primary, secondary);
		} catch (error) {
			return {
				reason: error instanceof NormalizationError ? "normalization_error" : "secondary_error",
				primaryCount: Array.isArray(primary) ? primary.length : null,
				secondaryCount: Array.isArray(secondary) ? secondary.length : null,
			};
		}
	}

	async function loadShadowIndex() {
		const startedAt = now();
		const controller = new AbortController();
		const primary = sanity.loadIndex(false);
		const secondary = compare(controller.signal);
		let timer: ReturnType<typeof setTimeout> | undefined;
		const bounded = Promise.race([
			secondary,
			new Promise<ComparisonOutcome>((resolve) => {
				timer = setTimeout(() => {
					controller.abort();
					resolve({ reason: "timeout", primaryCount: null, secondaryCount: null });
				}, deadlineMs);
			}),
		]).finally(() => clearTimeout(timer));
		try {
			const result = await primary;
			const outcome = await bounded;
			if (outcome.reason) {
				log({
					event: "catalog.shadow_closed",
					level: "warn",
					durationMs: Math.max(0, Math.min(deadlineMs, Math.round(now() - startedAt))),
					meta: {
						state: "closed",
						site: SITE_DOMAIN,
						reason: outcome.reason,
						primaryCount: outcome.primaryCount,
						secondaryCount: outcome.secondaryCount,
					},
				});
			}
			return result;
		} catch (error) {
			controller.abort();
			clearTimeout(timer);
			throw error;
		}
	}

	async function loadConvexIndex() {
		try {
			const adapted = adaptConvexIndex(await reader().listPublished(new AbortController().signal));
			return { ...adapted, collections: await sanity.loadCollectionIndex(false) };
		} catch {
			throw error(503, "Shop catalog is unavailable");
		}
	}

	async function loadConvexDetail<Result>(
		productSlug: string,
		adapt: (value: unknown, slug: string) => Result | null,
		notFound: string,
	) {
		try {
			const result = adapt(await reader().listPublished(new AbortController().signal), productSlug);
			if (result) return result;
		} catch {
			throw error(503, "Shop catalog is unavailable");
		}
		throw error(404, notFound);
	}

	return {
		loadIndex(isPreview: boolean) {
			if (isPreview) return sanity.loadIndex(true);
			const providerMode = parseCatalogProviderMode(mode());
			return providerMode === "shadow"
				? loadShadowIndex()
				: providerMode === "convex"
					? loadConvexIndex()
					: sanity.loadIndex(false);
		},
		loadProduct(productSlug: string, isPreview: boolean) {
			if (isPreview) return sanity.loadProduct(productSlug, true);
			return parseCatalogProviderMode(mode()) === "convex"
				? loadConvexDetail(productSlug, adaptConvexProduct, "Product not found")
				: sanity.loadProduct(productSlug, false);
		},
		loadPrintSet(productSlug: string, isPreview: boolean) {
			if (isPreview) return sanity.loadPrintSet(productSlug, true);
			return parseCatalogProviderMode(mode()) === "convex"
				? loadConvexDetail(productSlug, adaptConvexPrintSet, "Print set not found")
				: sanity.loadPrintSet(productSlug, false);
		},
		loadCollection(productSlug: string, isPreview: boolean) {
			return sanity.loadCollection(productSlug, isPreview);
		},
	};
}

export const catalogShop = createCatalogShopProvider();
