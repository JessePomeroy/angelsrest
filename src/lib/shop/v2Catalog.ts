/**
 * V2 Print Catalog — frontend lookup tables for paper and size metadata.
 *
 * Maps the paper/size slugs stored in lumaProductV2/lumaPrintSetV2 variants
 * to the display names, LumaPrints subcategory IDs, and physical dimensions
 * needed by the cart, checkout, and webhook systems.
 *
 * This is the frontend counterpart of the studio's
 * `schemaTypes/constants/lumaprintsCatalog.ts`. It shares the same slugs
 * but omits wholesale costs (photographer-only data).
 *
 * Keep in sync when adding new papers or sizes to the studio catalog.
 */

export interface V2Paper {
	slug: string;
	name: string;
	subcategoryId: number;
	description: string;
}

export interface V2Size {
	slug: string;
	label: string;
	width: number;
	height: number;
}

export const V2_PAPERS: V2Paper[] = [
	{
		slug: "archival-matte",
		name: "Archival Matte",
		subcategoryId: 103001,
		description: "Bright white archival paper with a matte finish. Smudge-resistant.",
	},
	{
		slug: "glossy",
		name: "Glossy",
		subcategoryId: 103007,
		description: "Ultra-smooth high-gloss finish. Vibrant color and deep blacks.",
	},
	{
		slug: "hot-press",
		name: "Hot Press",
		subcategoryId: 103002,
		description: "100% cotton rag fine art paper. Smooth, wide color gamut, archival.",
	},
	{
		slug: "cold-press",
		name: "Cold Press",
		subcategoryId: 103003,
		description: "100% cotton rag with a textured, watercolor paper feel.",
	},
	{
		slug: "semi-glossy-luster",
		name: "Semi-Glossy (Luster)",
		subcategoryId: 103005,
		description: "Satin finish with no glare and no fingerprints. Portrait standard.",
	},
	{
		slug: "somerset-velvet",
		name: "Somerset Velvet",
		subcategoryId: 103009,
		description: "100% cotton rag with a soft velvet surface and rich blacks.",
	},
];

export const V2_SIZES: V2Size[] = [
	{ slug: "4x6", label: "4×6", width: 4, height: 6 },
	{ slug: "5x7", label: "5×7", width: 5, height: 7 },
	{ slug: "6x9", label: "6×9", width: 6, height: 9 },
	{ slug: "8x10", label: "8×10", width: 8, height: 10 },
	{ slug: "11x14", label: "11×14", width: 11, height: 14 },
	{ slug: "16x20", label: "16×20", width: 16, height: 20 },
	{ slug: "24x36", label: "24×36", width: 24, height: 36 },
	{ slug: "30x40", label: "30×40", width: 30, height: 40 },
	{ slug: "40x60", label: "40×60", width: 40, height: 60 },
];

export interface V2BorderOption {
	value: string;
	label: string;
	inches: number;
}

export const V2_BORDER_OPTIONS: V2BorderOption[] = [
	{ value: "none", label: "No border", inches: 0 },
	{ value: "0.25", label: '0.25"', inches: 0.25 },
	{ value: "0.5", label: '0.5"', inches: 0.5 },
	{ value: "1", label: '1"', inches: 1 },
];

/** Display names for canvas paper slugs. */
const CANVAS_NAMES: Record<string, string> = {
	"canvas-black-0.75": 'Canvas Black — 0.75" stretch',
	"canvas-black-1.25": 'Canvas Black — 1.25" stretch',
	"canvas-black-1.50": 'Canvas Black — 1.50" stretch',
	"canvas-black-rolled": "Canvas Black — rolled",
	"canvas-white-0.75": 'Canvas White — 0.75" stretch',
	"canvas-white-1.25": 'Canvas White — 1.25" stretch',
	"canvas-white-1.50": 'Canvas White — 1.50" stretch',
	"canvas-white-rolled": "Canvas White — rolled",
};

/** Look up paper metadata by slug. Returns a synthetic entry for canvas slugs. */
export function getPaper(slug: string): V2Paper | undefined {
	const paper = V2_PAPERS.find((p) => p.slug === slug);
	if (paper) return paper;
	const canvasName = CANVAS_NAMES[slug];
	if (canvasName) {
		return { slug, name: canvasName, subcategoryId: 0, description: "" };
	}
	return undefined;
}

/** Look up size metadata by slug. */
export function getSize(slug: string): V2Size | undefined {
	return V2_SIZES.find((s) => s.slug === slug);
}

export interface V2FrameOption {
	value: string;
	label: string;
	subcategoryId: number;
}

export const V2_FRAME_OPTIONS: V2FrameOption[] = [
	{ value: "none", label: "No frame", subcategoryId: 0 },
	{ value: "0.875-black", label: '0.875" Black', subcategoryId: 105001 },
	{ value: "0.875-white", label: '0.875" White', subcategoryId: 105002 },
	{ value: "0.875-oak", label: '0.875" Oak', subcategoryId: 105003 },
	{ value: "1.25-black", label: '1.25" Black', subcategoryId: 105005 },
	{ value: "1.25-white", label: '1.25" White', subcategoryId: 105006 },
	{ value: "1.25-oak", label: '1.25" Oak', subcategoryId: 105007 },
];

/** When framed, border is locked to 0.25" and mat to 2" white. */
export const FRAMED_BORDER_INCHES = 0.25;
export const FRAMED_MAT_SIZE_OPTION_ID = 67; // 2" mat (LumaPrints option ID)
export const FRAMED_MAT_COLOR_OPTION_ID = 96; // White mat (LumaPrints option ID)

/**
 * Frame wholesale costs by thickness and size. All colors within a
 * thickness are the same price. Queried from LumaPrints product
 * pricing API on 2026-04-12.
 */
export const FRAME_WHOLESALE_COSTS: Record<string, Record<string, number>> = {
	"0.875": {
		"4x6": 15.94,
		"5x7": 16.85,
		"6x9": 18.33,
		"8x10": 20.08,
		"11x14": 24.65,
		"16x20": 35.12,
		"24x36": 66.4,
		"30x40": 84.26,
		"40x60": 146.31,
	},
	"1.25": {
		"4x6": 16.35,
		"5x7": 17.34,
		"6x9": 18.94,
		"8x10": 20.8,
		"11x14": 25.66,
		"16x20": 36.58,
		"24x36": 68.84,
		"30x40": 87.12,
		"40x60": 150.37,
	},
};

/** Get the frame wholesale cost for a frame option + size combo. */
export function getFrameWholesaleCost(frameValue: string, sizeSlug: string): number | null {
	// frameValue is e.g. "0.875-black" → thickness is "0.875"
	const thickness = frameValue.split("-")[0];
	return FRAME_WHOLESALE_COSTS[thickness]?.[sizeSlug] ?? null;
}

/** Check if a paper slug is a canvas type. */
export function isCanvasPaper(slug: string): boolean {
	return slug.startsWith("canvas-");
}

/**
 * Canvas subcategory IDs by thickness. Color doesn't affect the subcategory —
 * wrap color is an orderItemOption, not a subcategory dimension.
 */
const CANVAS_SUBCATEGORY_IDS: Record<string, number> = {
	"0.75": 101001,
	"1.25": 101002,
	"1.50": 101003,
	rolled: 101005,
};

/**
 * LumaPrints "Solid Color" wrap is option ID 3 for all colors.
 * The actual color is specified via solidColorHexCode in the order payload.
 * Defaults to black (#000000) if omitted.
 */
const CANVAS_WRAP_OPTION_ID = 3;

const CANVAS_WRAP_HEX: Record<string, string> = {
	black: "#000000",
	white: "#FFFFFF",
};

/**
 * Parse a canvas paper slug into its subcategory ID, wrap option ID, and hex.
 * e.g. "canvas-black-0.75" → { subcategoryId: 101001, wrapOptionId: 3, wrapHex: "#000000" }
 */
export function parseCanvasSlug(
	slug: string,
): { subcategoryId: number; wrapOptionId: number; wrapHex: string } | null {
	const match = slug.match(/^canvas-(black|white)-(.+)$/);
	if (!match) return null;
	const color = match[1];
	const thickness = match[2];
	const subcategoryId = CANVAS_SUBCATEGORY_IDS[thickness];
	const wrapHex = CANVAS_WRAP_HEX[color];
	if (!subcategoryId || !wrapHex) return null;
	return { subcategoryId, wrapOptionId: CANVAS_WRAP_OPTION_ID, wrapHex };
}

export const CANVAS_WHOLESALE_COSTS: Record<string, Record<string, number>> = {
	"0.75": {
		"8x10": 9.89,
		"11x14": 12.09,
		"16x20": 24.35,
		"24x36": 39.56,
		"30x40": 66.85,
		"40x60": 120.12,
	},
	"1.25": {
		"8x10": 10.99,
		"11x14": 13.19,
		"16x20": 25.95,
		"24x36": 42.21,
		"30x40": 50.99,
		"40x60": 112.07,
	},
	"1.50": {
		"8x10": 12.09,
		"11x14": 14.29,
		"16x20": 30.73,
		"24x36": 50.19,
		"30x40": 60.29,
		"40x60": 131.03,
	},
	rolled: {
		"8x10": 9.13,
		"11x14": 12.2,
		"16x20": 14.92,
		"24x36": 24.8,
		"30x40": 32.83,
		"40x60": 51.51,
	},
};

/** Get canvas wholesale cost for a thickness + size combo. */
export function getCanvasWholesaleCost(thickness: string, sizeSlug: string): number | null {
	return CANVAS_WHOLESALE_COSTS[thickness]?.[sizeSlug] ?? null;
}

/** Look up border option by value. */
export function getBorder(value: string): V2BorderOption | undefined {
	return V2_BORDER_OPTIONS.find((b) => b.value === value);
}

/** Look up frame option by value. */
export function getFrame(value: string): V2FrameOption | undefined {
	return V2_FRAME_OPTIONS.find((f) => f.value === value);
}
