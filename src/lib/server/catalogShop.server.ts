import { getPaperBySlug, getSizeBySlug, getWholesaleCost } from "@jessepomeroy/print-catalog";
import { error } from "@sveltejs/kit";
import { ConvexHttpClient } from "convex/browser";
import type { FunctionReturnType } from "convex/server";
import { api } from "$convex/api";
import { env as privateEnv } from "$env/dynamic/private";
import { env as publicEnv } from "$env/dynamic/public";
import { SITE_DOMAIN } from "$lib/config/site";
import { getSanityClient } from "$lib/sanity/client.server";
import {
	adaptConvexIndex,
	adaptConvexPrintSet,
	adaptConvexProduct,
} from "$lib/server/convexShopAdapter";
import { logStructured } from "$lib/server/logger";
import { sanityShop } from "$lib/server/sanityShop.server";

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

const SANITY_COMPARISON_QUERY = `*[_type in ["lumaProductV2", "lumaPrintSetV2", "product"]]{_type,"slug":slug.current,category,orderRank,inStock,featured,price,variants[]{paper,size,retailPrice,enabled},bordersEnabled,framedEnabled,frameMarkupMultiplier,availablePapers,image{"source":asset->metadata.dimensions{width,height}},previewImage{"source":asset->metadata.dimensions{width,height}},images[]{"source":asset->metadata.dimensions{width,height}},seo{ogImage{"source":asset->metadata.dimensions{width,height}}}}`;

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
		return [
			{ role: "cover", order: 0, source: dimensions(value.previewImage) },
			...array(value.images).map((image, order) => ({
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
