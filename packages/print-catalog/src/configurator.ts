import {
	FRAMED_BORDER_INCHES,
	getBorder,
	getFrame,
	getFrameWholesaleCost,
	getPaper,
	getSize,
	isCanvasPaper,
	parseCanvasSlug,
	type CanvasPaperInfo,
	type V2BorderOption,
	type V2FrameOption,
	type V2Paper,
	type V2Size,
} from "./index";

/** A purchasable paper and size combination supplied by a product document. */
export interface PrintVariant {
	paper?: string;
	size?: string;
	retailPrice?: number;
	enabled?: boolean;
}

export interface PrintPaperOption {
	slug: string;
	name: string;
}

export interface PrintSizeOption {
	slug: string;
	label: string;
}

export interface PrintFinishSelection {
	paperSlug: string;
	borderWidthValue: string;
	frameValue: string;
}

export interface ResolvedPrintConfiguration extends PrintFinishSelection {
	sizeSlug: string;
	variant: PrintVariant;
	paper: V2Paper;
	size: V2Size;
	border: V2BorderOption;
	frame: V2FrameOption;
	canvas: CanvasPaperInfo | null;
	displayPrice: number;
	paperSubcategoryId: number;
	borderWidth?: number;
	frameSubcategoryId?: number;
}

export interface ResolvePrintConfigurationInput extends PrintFinishSelection {
	sizeSlug: string;
	variants: readonly PrintVariant[];
	bordersEnabled?: boolean;
	framedEnabled?: boolean;
	frameMarkupMultiplier?: number;
}

/** Preserve the product-document order while removing duplicate material slugs. */
export function getAvailablePrintPapers(
	variants: readonly PrintVariant[],
): PrintPaperOption[] {
	const slugs = uniqueEnabledSlugs(variants, (variant) => variant.paper);
	return slugs.map((slug) => ({ slug, name: getPaper(slug)?.name ?? slug }));
}

/** Preserve the product-document order while removing duplicate sizes. */
export function getAvailablePrintSizes(
	variants: readonly PrintVariant[],
	paperSlug: string,
): PrintSizeOption[] {
	const slugs = uniqueEnabledSlugs(
		variants.filter((variant) => variant.paper === paperSlug),
		(variant) => variant.size,
	);
	return slugs.map((slug) => ({ slug, label: getSize(slug)?.label ?? slug }));
}

/**
 * Apply the finish invariants shared by every Shop V2 configurator.
 * Canvas cannot be bordered or framed; a frame always requires a 0.25-inch mat.
 */
export function normalizePrintFinishSelection(
	selection: PrintFinishSelection,
): PrintFinishSelection {
	if (isCanvasPaper(selection.paperSlug)) {
		return { ...selection, borderWidthValue: "none", frameValue: "none" };
	}
	if (selection.frameValue !== "none") {
		return {
			...selection,
			borderWidthValue: String(FRAMED_BORDER_INCHES),
		};
	}
	return selection;
}

/**
 * Resolve display price and fulfillment metadata for a browser selection.
 * Checkout must still re-resolve the same selectors server-side; this helper is
 * for consistent display and cart snapshots, not an authorization boundary.
 */
export function resolvePrintConfiguration(
	input: ResolvePrintConfigurationInput,
): ResolvedPrintConfiguration | null {
	const normalized = normalizePrintFinishSelection(input);
	const paper = getPaper(normalized.paperSlug);
	const size = getSize(input.sizeSlug);
	const border = getBorder(normalized.borderWidthValue);
	const frame = getFrame(normalized.frameValue);
	if (!paper || !size || !border || !frame) return null;

	const variant = input.variants.find(
		(candidate) =>
			candidate.enabled !== false &&
			candidate.paper === normalized.paperSlug &&
			candidate.size === input.sizeSlug,
	);
	const basePrice = normalizeMoney(variant?.retailPrice);
	if (!variant || basePrice === null) return null;

	if (input.bordersEnabled === false && border.inches > 0) return null;
	if (input.framedEnabled !== true && frame.subcategoryId > 0) return null;

	const frameMarkupMultiplier = input.frameMarkupMultiplier ?? 2;
	const frameSurcharge =
		frame.subcategoryId > 0
			? (getFrameWholesaleCost(normalized.frameValue, input.sizeSlug) ?? 0) *
				frameMarkupMultiplier
			: 0;
	const canvas = isCanvasPaper(normalized.paperSlug)
		? parseCanvasSlug(normalized.paperSlug)
		: null;
	const effectiveBorderWidth =
		frame.subcategoryId > 0
			? FRAMED_BORDER_INCHES
			: border.inches > 0
				? border.inches
				: undefined;

	return {
		paperSlug: normalized.paperSlug,
		sizeSlug: input.sizeSlug,
		borderWidthValue: normalized.borderWidthValue,
		frameValue: normalized.frameValue,
		variant,
		paper,
		size,
		border,
		frame,
		canvas,
		displayPrice: Math.round((basePrice + frameSurcharge) * 100) / 100,
		paperSubcategoryId: canvas?.subcategoryId ?? paper.subcategoryId,
		borderWidth: effectiveBorderWidth,
		frameSubcategoryId:
			frame.subcategoryId > 0 ? frame.subcategoryId : undefined,
	};
}

function uniqueEnabledSlugs(
	variants: readonly PrintVariant[],
	select: (variant: PrintVariant) => string | undefined,
): string[] {
	return Array.from(
		new Set(
			variants
				.filter((variant) => variant.enabled !== false)
				.map(select)
				.filter((slug): slug is string => typeof slug === "string" && slug.length > 0),
		),
	);
}

function normalizeMoney(value: unknown): number | null {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
	return Math.round(value * 100) / 100;
}
