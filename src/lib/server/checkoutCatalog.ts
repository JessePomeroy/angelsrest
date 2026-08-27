import {
	FRAMED_BORDER_INCHES,
	getBorder,
	getFrame,
	getFrameWholesaleCost,
	getPaper,
	getSize,
	isCanvasPaper,
	parseCanvasSlug,
} from "@jessepomeroy/print-catalog";
import type { SanityImageSource } from "@sanity/image-url";
import { ApiErrorCode, apiError } from "$lib/server/apiError";
import type { ParsedPaper } from "$lib/types/shop";
import { imageSet, originalUrl, parsePaperOption, previewUrl } from "$lib/utils/images";

type SanityFetcher = <T = unknown>(query: string, params?: Record<string, unknown>) => Promise<T>;

type ProductKind =
	| "print"
	| "print_set"
	| "postcard"
	| "tapestry"
	| "digital_download"
	| "merchandise";

export interface CheckoutSelection {
	readonly productId?: unknown;
	readonly isPrintSet?: unknown;
	readonly paperSlug?: unknown;
	readonly sizeSlug?: unknown;
	readonly paperIndex?: unknown;
	readonly borderWidth?: unknown;
	readonly frame?: unknown;
	readonly paper?: unknown;
}

interface ResolvedPaper {
	readonly name: string;
	readonly subcategoryId: number;
	readonly width: number;
	readonly height: number;
	readonly borderWidth?: number;
	readonly frameSubcategoryId?: number;
	readonly canvasSubcategoryId?: number;
	readonly canvasWrapHex?: string;
}

export interface CheckoutSnapshotItem {
	readonly productKey: string;
	readonly revisionId: string;
	readonly productKind: ProductKind;
	readonly variantKey: string | null;
	readonly materialOptionKey: string | null;
	readonly sizeOptionKey: string | null;
	readonly borderOptionKey: string | null;
	readonly frameOptionKey: string | null;
}

export interface LegacyCheckoutFulfillment {
	readonly isDigital: boolean;
	readonly isPrintSet: boolean;
	readonly imageUrl: string | null;
	readonly imageUrls: readonly string[];
	readonly paper: ResolvedPaper | null;
}

export interface ResolvedCheckoutItem {
	readonly productId: string;
	readonly title: string;
	readonly unitPriceCents: number;
	readonly productCategory: string | null;
	readonly publicImage: string | null;
	readonly snapshot: CheckoutSnapshotItem | null;
	readonly legacyFulfillment: LegacyCheckoutFulfillment;
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

function snapshotQuery(query: string, keyedProjection: string) {
	return query
		.replace("    title,", "    _id,\n    _rev,\n    title,")
		.replace(keyedProjection, keyedProjection.replace("{", "{_key, "));
}

const SNAPSHOT_V2_PRODUCT_QUERY = snapshotQuery(
	V2_PRODUCT_QUERY,
	"variants[enabled == true]{paper",
);
const SNAPSHOT_V1_PRODUCT_QUERY = snapshotQuery(V1_PRODUCT_QUERY, "availablePapers[]{\n      name");
const SNAPSHOT_V2_SET_QUERY = snapshotQuery(V2_SET_QUERY, "variants[enabled == true]{paper");

function requireSlug(value: unknown) {
	if (typeof value !== "string" || !value.trim()) {
		throw apiError(400, ApiErrorCode.MISSING_FIELD, "Missing required field: productId");
	}
	return value.trim();
}

function requireIdentity(value: unknown, label: string) {
	if (typeof value !== "string" || !value || value.length > 128 || value.startsWith("drafts.")) {
		throw apiError(400, ApiErrorCode.INVALID_INPUT, `Product is missing a valid ${label}`);
	}
	return value;
}

function requireTitle(value: unknown) {
	if (typeof value !== "string" || !value.trim()) {
		throw apiError(400, ApiErrorCode.INVALID_INPUT, "Product is missing a valid title");
	}
	return value;
}

function priceCents(value: unknown): number | null {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
	const cents = Math.round(value * 100);
	return Number.isSafeInteger(cents) ? cents : null;
}

function selectedPaperIndex(value: unknown): number | null {
	return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function legacyPaperSelector(value: unknown): ParsedPaper | null {
	if (!value || typeof value !== "object") return null;
	const paper = value as Partial<ParsedPaper>;
	if (
		typeof paper.name !== "string" ||
		typeof paper.subcategoryId !== "string" ||
		typeof paper.width !== "number" ||
		typeof paper.height !== "number"
	)
		return null;
	return {
		name: paper.name,
		subcategoryId: paper.subcategoryId,
		width: paper.width,
		height: paper.height,
		price: typeof paper.price === "number" ? paper.price : null,
	};
}

function normalizeLegacyPaperOption(option: unknown) {
	if (typeof option === "string") return { key: null, value: { name: option } };
	if (!option || typeof option !== "object") return null;
	const candidate = option as { _key?: unknown; name?: unknown; price?: unknown };
	if (typeof candidate.name !== "string") return null;
	return {
		key: typeof candidate._key === "string" && candidate._key ? candidate._key : null,
		value: {
			name: candidate.name,
			price: typeof candidate.price === "number" ? candidate.price : undefined,
		},
	};
}

function resolveV1Paper(
	options: unknown[] | undefined,
	fallbackCents: number | null,
	selection: CheckoutSelection,
) {
	if (!options?.length) {
		if (fallbackCents === null) {
			throw apiError(400, ApiErrorCode.INVALID_INPUT, "Product is missing a valid price");
		}
		return { paper: null, unitPriceCents: fallbackCents, variantKey: null };
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
						const parsed = parsePaperOption(candidate.value);
						return (
							parsed?.name === legacy.name &&
							parsed.subcategoryId === legacy.subcategoryId &&
							parsed.width === legacy.width &&
							parsed.height === legacy.height
						);
					})
				: null;
	const parsed = option ? parsePaperOption(option.value) : null;
	if (!parsed) throw apiError(400, ApiErrorCode.INVALID_INPUT, "Invalid paper selection");
	const unitPriceCents = priceCents(parsed.price) ?? fallbackCents;
	if (unitPriceCents === null) {
		throw apiError(400, ApiErrorCode.INVALID_INPUT, "Selected paper is missing a valid price");
	}
	return {
		unitPriceCents,
		variantKey: option?.key ? requireIdentity(option.key, "paper identity") : null,
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
		variants?: Array<{ _key?: unknown; paper?: string; size?: string; retailPrice?: number }>;
		bordersEnabled?: boolean;
		framedEnabled?: boolean;
		frameMarkupMultiplier?: number;
	},
	selection: CheckoutSelection,
	captureSnapshot: boolean,
) {
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
	const basePriceCents = priceCents(variant?.retailPrice);
	if (!variant || basePriceCents === null) {
		throw apiError(400, ApiErrorCode.INVALID_INPUT, "Selected print variant is unavailable");
	}

	const borderValue = typeof selection.borderWidth === "string" ? selection.borderWidth : "none";
	const border = getBorder(borderValue);
	const frameValue = typeof selection.frame === "string" ? selection.frame : "none";
	const frame = getFrame(frameValue);
	if (!border) throw apiError(400, ApiErrorCode.INVALID_INPUT, "Invalid border selection");
	if (!frame) throw apiError(400, ApiErrorCode.INVALID_INPUT, "Invalid frame selection");

	const isCanvas = isCanvasPaper(paperSlug);
	if (!(product.bordersEnabled ?? true) && border.inches > 0) {
		throw apiError(400, ApiErrorCode.INVALID_INPUT, "Borders are not available for this print");
	}
	if ((!(product.framedEnabled ?? false) || isCanvas) && frame.subcategoryId > 0) {
		throw apiError(400, ApiErrorCode.INVALID_INPUT, "Frames are not available for this print");
	}
	const frameSurchargeCents =
		frame.subcategoryId > 0
			? Math.round(
					(getFrameWholesaleCost(frameValue, sizeSlug) ?? 0) *
						(product.frameMarkupMultiplier ?? 2) *
						100,
				)
			: 0;
	const canvas = isCanvas ? parseCanvasSlug(paperSlug) : null;
	const effectiveBorder =
		frame.subcategoryId > 0 ? FRAMED_BORDER_INCHES : border.inches > 0 ? border.inches : undefined;
	return {
		unitPriceCents: basePriceCents + frameSurchargeCents,
		variantKey: captureSnapshot ? requireIdentity(variant._key, "variant identity") : null,
		materialOptionKey: paperSlug,
		sizeOptionKey: sizeSlug,
		borderOptionKey: borderValue,
		frameOptionKey: frameValue,
		paper: {
			name: paper.name,
			subcategoryId: canvas?.subcategoryId ?? paper.subcategoryId,
			width: size.width,
			height: size.height,
			borderWidth: effectiveBorder,
			frameSubcategoryId: frame.subcategoryId > 0 ? frame.subcategoryId : undefined,
			canvasSubcategoryId: canvas?.subcategoryId,
			canvasWrapHex: canvas?.wrapHex,
		} satisfies ResolvedPaper,
	};
}

function imageUrlsFromSet(images: unknown) {
	if (!Array.isArray(images)) return [];
	return images
		.map((image) => imageSet(image as SanityImageSource & { alt?: string })?.original)
		.filter((url): url is string => typeof url === "string" && url.length > 0);
}

const GENERAL_KINDS: Readonly<Record<string, ProductKind>> = {
	prints: "print",
	postcards: "postcard",
	tapestries: "tapestry",
	digital: "digital_download",
	merchandise: "merchandise",
};

function generalProductKind(category: string | null) {
	const kind = category ? GENERAL_KINDS[category] : undefined;
	if (!kind) throw apiError(400, ApiErrorCode.INVALID_INPUT, "Product category is unsupported");
	return kind;
}

function snapshotIdentity(
	product: { _id?: unknown; _rev?: unknown },
	productKind: ProductKind,
	selection: {
		variantKey: string | null;
		materialOptionKey?: string | null;
		sizeOptionKey?: string | null;
		borderOptionKey?: string | null;
		frameOptionKey?: string | null;
	},
): CheckoutSnapshotItem {
	return {
		productKey: requireIdentity(product._id, "published identity"),
		revisionId: requireIdentity(product._rev, "published revision"),
		productKind,
		variantKey: selection.variantKey,
		materialOptionKey: selection.materialOptionKey ?? null,
		sizeOptionKey: selection.sizeOptionKey ?? null,
		borderOptionKey: selection.borderOptionKey ?? null,
		frameOptionKey: selection.frameOptionKey ?? null,
	};
}

export async function resolveCheckoutItem(
	fetcher: SanityFetcher,
	selection: CheckoutSelection,
	captureSnapshot = false,
): Promise<ResolvedCheckoutItem> {
	const productId = requireSlug(selection.productId);
	if (selection.isPrintSet === true) {
		const product = await fetcher<Record<string, unknown> | null>(
			captureSnapshot ? SNAPSHOT_V2_SET_QUERY : V2_SET_QUERY,
			{ slug: productId },
		);
		if (!product) throw apiError(404, ApiErrorCode.NOT_FOUND, "Print set not found");
		if (product.inStock === false) {
			throw apiError(400, ApiErrorCode.INVALID_INPUT, "This print set is out of stock");
		}
		const resolved = resolveV2PaperAndPrice(product, selection, captureSnapshot);
		const publicImage = previewUrl(product.previewImage as SanityImageSource);
		return {
			productId,
			title: captureSnapshot ? requireTitle(product.title) : (product.title as string),
			unitPriceCents: resolved.unitPriceCents,
			productCategory: "print-set",
			publicImage,
			snapshot: captureSnapshot ? snapshotIdentity(product, "print_set", resolved) : null,
			legacyFulfillment: {
				isDigital: false,
				isPrintSet: true,
				imageUrl: publicImage,
				imageUrls: imageUrlsFromSet(product.images),
				paper: resolved.paper,
			},
		};
	}

	const v2Product = await fetcher<Record<string, unknown> | null>(
		captureSnapshot ? SNAPSHOT_V2_PRODUCT_QUERY : V2_PRODUCT_QUERY,
		{ slug: productId },
	);
	if (v2Product !== null) {
		if (v2Product.inStock === false) {
			throw apiError(400, ApiErrorCode.INVALID_INPUT, "This print is out of stock");
		}
		const resolved = resolveV2PaperAndPrice(v2Product, selection, captureSnapshot);
		const publicImage = originalUrl(v2Product.image as SanityImageSource);
		return {
			productId,
			title: captureSnapshot ? requireTitle(v2Product.title) : (v2Product.title as string),
			unitPriceCents: resolved.unitPriceCents,
			productCategory: "print",
			publicImage,
			snapshot: captureSnapshot ? snapshotIdentity(v2Product, "print", resolved) : null,
			legacyFulfillment: {
				isDigital: false,
				isPrintSet: false,
				imageUrl: publicImage,
				imageUrls: [],
				paper: resolved.paper,
			},
		};
	}

	const product = await fetcher<Record<string, unknown> | null>(
		captureSnapshot ? SNAPSHOT_V1_PRODUCT_QUERY : V1_PRODUCT_QUERY,
		{ slug: productId },
	);
	if (!product) throw apiError(404, ApiErrorCode.NOT_FOUND, "Product not found");
	if (product.inStock === false) {
		throw apiError(400, ApiErrorCode.INVALID_INPUT, "This product is out of stock");
	}
	const category = typeof product.category === "string" ? product.category : null;
	const kind = captureSnapshot ? generalProductKind(category) : null;
	const resolved = resolveV1Paper(
		Array.isArray(product.availablePapers) ? product.availablePapers : undefined,
		priceCents(product.price),
		selection,
	);
	const firstImage = Array.isArray(product.images) ? product.images[0] : undefined;
	const publicImage = originalUrl(firstImage as SanityImageSource);
	return {
		productId,
		title: captureSnapshot ? requireTitle(product.title) : (product.title as string),
		unitPriceCents: resolved.unitPriceCents,
		productCategory: category,
		publicImage,
		snapshot:
			captureSnapshot && kind
				? snapshotIdentity(product, kind, { variantKey: resolved.variantKey })
				: null,
		legacyFulfillment: {
			isDigital: captureSnapshot ? kind === "digital_download" : category === "digital",
			isPrintSet: false,
			imageUrl: publicImage,
			imageUrls: [],
			paper: resolved.paper,
		},
	};
}
