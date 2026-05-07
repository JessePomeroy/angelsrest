import { ApiErrorCode, apiError } from "$lib/server/apiError";
import {
	FRAMED_BORDER_INCHES,
	getBorder,
	getFrame,
	getFrameWholesaleCost,
	getPaper,
	getSize,
	isCanvasPaper,
	parseCanvasSlug,
} from "$lib/shop/v2Catalog";
import type { ParsedPaper } from "$lib/types/shop";
import { imageSet, originalUrl, parsePaperOption, previewUrl } from "$lib/utils/images";

type SanityFetcher = <T = unknown>(query: string, params?: Record<string, unknown>) => Promise<T>;

export interface CheckoutSelection {
	productId?: unknown;
	coupon?: unknown;
	isPrintSet?: unknown;
	paperSlug?: unknown;
	sizeSlug?: unknown;
	paperIndex?: unknown;
	borderWidth?: unknown;
	frame?: unknown;
	// Legacy fields are accepted only as a fallback selector for V1 paper
	// options. Prices, titles, and image URLs are intentionally ignored.
	paper?: unknown;
}

interface ResolvedPaper {
	name: string;
	subcategoryId: number;
	width: number;
	height: number;
	borderWidth?: number;
	frameSubcategoryId?: number;
	canvasSubcategoryId?: number;
	canvasWrapHex?: string;
}

export interface ResolvedCheckoutItem {
	productId: string;
	title: string;
	price: number;
	productCategory: string | null;
	isDigital: boolean;
	isPrintSet: boolean;
	image: string | null;
	images: string[];
	paper: ResolvedPaper | null;
}

const V2_PRODUCT_QUERY = `
  *[_type == "lumaProductV2" && slug.current == $slug][0]{
    title,
    image,
    variants[enabled == true]{paper, size, retailPrice},
    bordersEnabled,
    framedEnabled,
    frameMarkupMultiplier,
    inStock
  }
`;

const V1_PRODUCT_QUERY = `
  *[_type == "product" && slug.current == $slug][0]{
    title,
    price,
    category,
    inStock,
    images[],
    availablePapers[]{
      name,
      price,
      subcategoryId,
      width,
      height
    }
  }
`;

const V2_SET_QUERY = `
  *[_type == "lumaPrintSetV2" && slug.current == $slug][0]{
    title,
    previewImage,
    images,
    variants[enabled == true]{paper, size, retailPrice},
    bordersEnabled,
    framedEnabled,
    frameMarkupMultiplier,
    inStock
  }
`;

const V1_SET_QUERY = `
  *[_type == "printSet" && slug.current == $slug][0]{
    title,
    previewImage,
    images,
    price,
    availablePapers
  }
`;

function requireSlug(value: unknown): string {
	if (typeof value !== "string" || !value.trim()) {
		throw apiError(400, ApiErrorCode.MISSING_FIELD, "Missing required field: productId");
	}
	return value.trim();
}

function normalizePrice(value: unknown): number | null {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
	return Math.round(value * 100) / 100;
}

function selectedPaperIndex(value: unknown): number | null {
	if (typeof value !== "number" || !Number.isInteger(value) || value < 0) return null;
	return value;
}

function legacyPaperSelector(value: unknown): ParsedPaper | null {
	if (!value || typeof value !== "object") return null;
	const paper = value as Partial<ParsedPaper>;
	if (
		typeof paper.name !== "string" ||
		typeof paper.subcategoryId !== "string" ||
		typeof paper.width !== "number" ||
		typeof paper.height !== "number"
	) {
		return null;
	}
	return {
		name: paper.name,
		subcategoryId: paper.subcategoryId,
		width: paper.width,
		height: paper.height,
		price: typeof paper.price === "number" ? paper.price : null,
	};
}

function normalizeLegacyPaperOption(option: unknown): { name: string; price?: number } | null {
	if (typeof option === "string") return { name: option };
	if (!option || typeof option !== "object") return null;
	const candidate = option as { name?: unknown; price?: unknown };
	if (typeof candidate.name !== "string") return null;
	return {
		name: candidate.name,
		price: typeof candidate.price === "number" ? candidate.price : undefined,
	};
}

function resolveV1Paper(
	options: unknown[] | undefined,
	fallbackPrice: number | null,
	selection: CheckoutSelection,
): { paper: ResolvedPaper | null; price: number } {
	if (!options?.length) {
		if (fallbackPrice === null) {
			throw apiError(400, ApiErrorCode.INVALID_INPUT, "Product is missing a valid price");
		}
		return { paper: null, price: fallbackPrice };
	}

	const index = selectedPaperIndex(selection.paperIndex);
	const legacy = legacyPaperSelector(selection.paper);
	const normalizedOptions = options.map(normalizeLegacyPaperOption);
	const option =
		index !== null
			? normalizedOptions[index]
			: legacy
				? normalizedOptions.find((candidate) => {
						if (!candidate) return false;
						const parsed = parsePaperOption(candidate);
						return (
							parsed?.name === legacy.name &&
							parsed.subcategoryId === legacy.subcategoryId &&
							parsed.width === legacy.width &&
							parsed.height === legacy.height
						);
					})
				: null;
	const parsed = option ? parsePaperOption(option) : null;
	if (!parsed) {
		throw apiError(400, ApiErrorCode.INVALID_INPUT, "Invalid paper selection");
	}
	const price = normalizePrice(parsed.price) ?? fallbackPrice;
	if (price === null) {
		throw apiError(400, ApiErrorCode.INVALID_INPUT, "Selected paper is missing a valid price");
	}
	return {
		price,
		paper: {
			name: parsed.name,
			subcategoryId: Number.parseInt(parsed.subcategoryId, 10),
			width: parsed.width,
			height: parsed.height,
		},
	};
}

function resolveV2PaperAndPrice(
	product: {
		variants?: Array<{ paper?: string; size?: string; retailPrice?: number }>;
		bordersEnabled?: boolean;
		framedEnabled?: boolean;
		frameMarkupMultiplier?: number;
	},
	selection: CheckoutSelection,
): { paper: ResolvedPaper; price: number } {
	const paperSlug = typeof selection.paperSlug === "string" ? selection.paperSlug : "";
	const sizeSlug = typeof selection.sizeSlug === "string" ? selection.sizeSlug : "";
	const paper = getPaper(paperSlug);
	const size = getSize(sizeSlug);
	if (!paper || !size) {
		throw apiError(400, ApiErrorCode.INVALID_INPUT, "Invalid print material or size");
	}

	const variant = product.variants?.find(
		(item) => item.paper === paperSlug && item.size === sizeSlug,
	);
	const basePrice = normalizePrice(variant?.retailPrice);
	if (!variant || basePrice === null) {
		throw apiError(400, ApiErrorCode.INVALID_INPUT, "Selected print variant is unavailable");
	}

	const borderValue = typeof selection.borderWidth === "string" ? selection.borderWidth : "none";
	const border = getBorder(borderValue);
	if (!border) {
		throw apiError(400, ApiErrorCode.INVALID_INPUT, "Invalid border selection");
	}
	const frameValue = typeof selection.frame === "string" ? selection.frame : "none";
	const frame = getFrame(frameValue);
	if (!frame) {
		throw apiError(400, ApiErrorCode.INVALID_INPUT, "Invalid frame selection");
	}

	const isCanvas = isCanvasPaper(paperSlug);
	const bordersEnabled = product.bordersEnabled ?? true;
	const framedEnabled = product.framedEnabled ?? false;
	if (!bordersEnabled && border.inches > 0) {
		throw apiError(400, ApiErrorCode.INVALID_INPUT, "Borders are not available for this print");
	}
	if ((!framedEnabled || isCanvas) && frame.subcategoryId > 0) {
		throw apiError(400, ApiErrorCode.INVALID_INPUT, "Frames are not available for this print");
	}

	const frameSurcharge =
		frame.subcategoryId > 0
			? (getFrameWholesaleCost(frameValue, sizeSlug) ?? 0) * (product.frameMarkupMultiplier ?? 2)
			: 0;
	const price = Math.round((basePrice + frameSurcharge) * 100) / 100;
	const canvas = isCanvas ? parseCanvasSlug(paperSlug) : null;
	const effectiveBorder =
		frame.subcategoryId > 0 ? FRAMED_BORDER_INCHES : border.inches > 0 ? border.inches : undefined;

	return {
		price,
		paper: {
			name: paper.name,
			subcategoryId: canvas?.subcategoryId ?? paper.subcategoryId,
			width: size.width,
			height: size.height,
			borderWidth: effectiveBorder,
			frameSubcategoryId: frame.subcategoryId > 0 ? frame.subcategoryId : undefined,
			canvasSubcategoryId: canvas?.subcategoryId,
			canvasWrapHex: canvas?.wrapHex,
		},
	};
}

function imageUrlsFromSet(images: unknown): string[] {
	if (!Array.isArray(images)) return [];
	return images
		.map((image) => imageSet(image as any)?.original)
		.filter((url): url is string => typeof url === "string" && url.length > 0);
}

export async function resolveCheckoutItem(
	fetcher: SanityFetcher,
	selection: CheckoutSelection,
): Promise<ResolvedCheckoutItem> {
	const productId = requireSlug(selection.productId);
	const isPrintSet = selection.isPrintSet === true;

	if (isPrintSet) {
		const v2Set = await fetcher<any>(V2_SET_QUERY, { slug: productId });
		if (v2Set) {
			if (v2Set.inStock === false) {
				throw apiError(400, ApiErrorCode.INVALID_INPUT, "This print set is out of stock");
			}
			const resolved = resolveV2PaperAndPrice(v2Set, selection);
			return {
				productId,
				title: v2Set.title,
				price: resolved.price,
				productCategory: "print-set",
				isDigital: false,
				isPrintSet: true,
				image: previewUrl(v2Set.previewImage),
				images: imageUrlsFromSet(v2Set.images),
				paper: resolved.paper,
			};
		}

		const v1Set = await fetcher<any>(V1_SET_QUERY, { slug: productId });
		if (!v1Set) {
			throw apiError(404, ApiErrorCode.NOT_FOUND, "Print set not found");
		}
		const resolved = resolveV1Paper(v1Set.availablePapers, normalizePrice(v1Set.price), selection);
		return {
			productId,
			title: v1Set.title,
			price: resolved.price,
			productCategory: "print-set",
			isDigital: false,
			isPrintSet: true,
			image: previewUrl(v1Set.previewImage),
			images: imageUrlsFromSet(v1Set.images),
			paper: resolved.paper,
		};
	}

	const v2Product = await fetcher<any>(V2_PRODUCT_QUERY, { slug: productId });
	if (v2Product) {
		if (v2Product.inStock === false) {
			throw apiError(400, ApiErrorCode.INVALID_INPUT, "This print is out of stock");
		}
		const resolved = resolveV2PaperAndPrice(v2Product, selection);
		return {
			productId,
			title: v2Product.title,
			price: resolved.price,
			productCategory: "print",
			isDigital: false,
			isPrintSet: false,
			image: originalUrl(v2Product.image),
			images: [],
			paper: resolved.paper,
		};
	}

	const v1Product = await fetcher<any>(V1_PRODUCT_QUERY, { slug: productId });
	if (!v1Product) {
		throw apiError(404, ApiErrorCode.NOT_FOUND, "Product not found");
	}
	if (v1Product.inStock === false) {
		throw apiError(400, ApiErrorCode.INVALID_INPUT, "This product is out of stock");
	}
	const category = typeof v1Product.category === "string" ? v1Product.category : null;
	const resolved = resolveV1Paper(
		v1Product.availablePapers,
		normalizePrice(v1Product.price),
		selection,
	);
	return {
		productId,
		title: v1Product.title,
		price: resolved.price,
		productCategory: category,
		isDigital: category === "digital",
		isPrintSet: false,
		image: Array.isArray(v1Product.images) ? originalUrl(v1Product.images[0]) : null,
		images: [],
		paper: resolved.paper,
	};
}
