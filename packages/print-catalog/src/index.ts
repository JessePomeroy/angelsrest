/**
 * Shared print catalog for LumaPrints-backed Shop V2 products.
 *
 * This is the source of truth for paper, size, border, frame, canvas, and
 * wholesale lookup metadata used by public shop pages, checkout, fulfillment,
 * and Sanity Studio margin fields.
 */

export interface V2Paper {
	slug: string;
	name: string;
	subcategoryId: number;
	gsm?: number | null;
	description: string;
}

export interface V2Size {
	slug: string;
	label: string;
	width: number;
	height: number;
}

export interface V2CatalogEntry {
	paperSlug: string;
	sizeSlug: string;
	wholesaleCost: number;
}

export interface V2BorderOption {
	value: string;
	label: string;
	inches: number;
}

export interface V2FrameOption {
	value: string;
	label: string;
	subcategoryId: number;
}

export interface CanvasPaperInfo {
	color: "black" | "white";
	thickness: string;
	subcategoryId: number;
	wrapOptionId: number;
	wrapHex: string;
}

export const V2_PAPERS: V2Paper[] = [
	{
		slug: "archival-matte",
		name: "Archival Matte",
		subcategoryId: 103001,
		gsm: 230,
		description: "Bright white archival paper with a matte finish. Smudge-resistant.",
	},
	{
		slug: "glossy",
		name: "Glossy",
		subcategoryId: 103007,
		gsm: 260,
		description: "Ultra-smooth high-gloss finish. Vibrant color and deep blacks.",
	},
	{
		slug: "hot-press",
		name: "Hot Press",
		subcategoryId: 103002,
		gsm: 330,
		description: "100% cotton rag fine art paper. Smooth, wide color gamut, archival.",
	},
	{
		slug: "cold-press",
		name: "Cold Press",
		subcategoryId: 103003,
		gsm: 340,
		description: "100% cotton rag with a textured, watercolor paper feel.",
	},
	{
		slug: "semi-glossy-luster",
		name: "Semi-Glossy (Luster)",
		subcategoryId: 103005,
		gsm: 250,
		description: "Satin finish with no glare and no fingerprints. Portrait standard.",
	},
	{
		slug: "somerset-velvet",
		name: "Somerset Velvet",
		subcategoryId: 103009,
		gsm: 255,
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

export const V2_WHOLESALE_COSTS: V2CatalogEntry[] = [
	{ paperSlug: "archival-matte", sizeSlug: "4x6", wholesaleCost: 1.71 },
	{ paperSlug: "archival-matte", sizeSlug: "5x7", wholesaleCost: 2.01 },
	{ paperSlug: "archival-matte", sizeSlug: "6x9", wholesaleCost: 2.53 },
	{ paperSlug: "archival-matte", sizeSlug: "8x10", wholesaleCost: 3.19 },
	{ paperSlug: "archival-matte", sizeSlug: "11x14", wholesaleCost: 5.01 },
	{ paperSlug: "archival-matte", sizeSlug: "16x20", wholesaleCost: 8.89 },
	{ paperSlug: "archival-matte", sizeSlug: "24x36", wholesaleCost: 21.1 },
	{ paperSlug: "archival-matte", sizeSlug: "30x40", wholesaleCost: 28.44 },
	{ paperSlug: "archival-matte", sizeSlug: "40x60", wholesaleCost: 54.43 },
	{ paperSlug: "glossy", sizeSlug: "4x6", wholesaleCost: 3.02 },
	{ paperSlug: "glossy", sizeSlug: "5x7", wholesaleCost: 3.45 },
	{ paperSlug: "glossy", sizeSlug: "6x9", wholesaleCost: 4.17 },
	{ paperSlug: "glossy", sizeSlug: "8x10", wholesaleCost: 5.09 },
	{ paperSlug: "glossy", sizeSlug: "11x14", wholesaleCost: 7.61 },
	{ paperSlug: "glossy", sizeSlug: "16x20", wholesaleCost: 12.99 },
	{ paperSlug: "glossy", sizeSlug: "24x36", wholesaleCost: 29.96 },
	{ paperSlug: "glossy", sizeSlug: "30x40", wholesaleCost: 40.16 },
	{ paperSlug: "glossy", sizeSlug: "40x60", wholesaleCost: 76.24 },
	{ paperSlug: "hot-press", sizeSlug: "4x6", wholesaleCost: 2.86 },
	{ paperSlug: "hot-press", sizeSlug: "5x7", wholesaleCost: 3.24 },
	{ paperSlug: "hot-press", sizeSlug: "6x9", wholesaleCost: 3.87 },
	{ paperSlug: "hot-press", sizeSlug: "8x10", wholesaleCost: 4.68 },
	{ paperSlug: "hot-press", sizeSlug: "11x14", wholesaleCost: 6.9 },
	{ paperSlug: "hot-press", sizeSlug: "16x20", wholesaleCost: 11.64 },
	{ paperSlug: "hot-press", sizeSlug: "24x36", wholesaleCost: 26.55 },
	{ paperSlug: "hot-press", sizeSlug: "30x40", wholesaleCost: 35.53 },
	{ paperSlug: "hot-press", sizeSlug: "40x60", wholesaleCost: 67.31 },
	{ paperSlug: "cold-press", sizeSlug: "4x6", wholesaleCost: 2.86 },
	{ paperSlug: "cold-press", sizeSlug: "5x7", wholesaleCost: 3.24 },
	{ paperSlug: "cold-press", sizeSlug: "6x9", wholesaleCost: 3.87 },
	{ paperSlug: "cold-press", sizeSlug: "8x10", wholesaleCost: 4.68 },
	{ paperSlug: "cold-press", sizeSlug: "11x14", wholesaleCost: 6.9 },
	{ paperSlug: "cold-press", sizeSlug: "16x20", wholesaleCost: 11.64 },
	{ paperSlug: "cold-press", sizeSlug: "24x36", wholesaleCost: 26.55 },
	{ paperSlug: "cold-press", sizeSlug: "30x40", wholesaleCost: 35.53 },
	{ paperSlug: "cold-press", sizeSlug: "40x60", wholesaleCost: 67.31 },
	{ paperSlug: "semi-glossy-luster", sizeSlug: "4x6", wholesaleCost: 1.71 },
	{ paperSlug: "semi-glossy-luster", sizeSlug: "5x7", wholesaleCost: 2.01 },
	{ paperSlug: "semi-glossy-luster", sizeSlug: "6x9", wholesaleCost: 2.53 },
	{ paperSlug: "semi-glossy-luster", sizeSlug: "8x10", wholesaleCost: 3.19 },
	{ paperSlug: "semi-glossy-luster", sizeSlug: "11x14", wholesaleCost: 5.01 },
	{ paperSlug: "semi-glossy-luster", sizeSlug: "16x20", wholesaleCost: 8.89 },
	{ paperSlug: "semi-glossy-luster", sizeSlug: "24x36", wholesaleCost: 21.1 },
	{ paperSlug: "semi-glossy-luster", sizeSlug: "30x40", wholesaleCost: 28.44 },
	{ paperSlug: "semi-glossy-luster", sizeSlug: "40x60", wholesaleCost: 54.43 },
	{ paperSlug: "somerset-velvet", sizeSlug: "4x6", wholesaleCost: 3.02 },
	{ paperSlug: "somerset-velvet", sizeSlug: "5x7", wholesaleCost: 3.45 },
	{ paperSlug: "somerset-velvet", sizeSlug: "6x9", wholesaleCost: 4.17 },
	{ paperSlug: "somerset-velvet", sizeSlug: "8x10", wholesaleCost: 5.09 },
	{ paperSlug: "somerset-velvet", sizeSlug: "11x14", wholesaleCost: 7.61 },
	{ paperSlug: "somerset-velvet", sizeSlug: "16x20", wholesaleCost: 12.99 },
	{ paperSlug: "somerset-velvet", sizeSlug: "24x36", wholesaleCost: 29.96 },
	{ paperSlug: "somerset-velvet", sizeSlug: "30x40", wholesaleCost: 40.16 },
	{ paperSlug: "somerset-velvet", sizeSlug: "40x60", wholesaleCost: 76.24 },
];

export const V2_BORDER_OPTIONS: V2BorderOption[] = [
	{ value: "none", label: "No border", inches: 0 },
	{ value: "0.25", label: "0.25\"", inches: 0.25 },
	{ value: "0.5", label: "0.5\"", inches: 0.5 },
	{ value: "1", label: "1\"", inches: 1 },
];

export const V2_FRAME_OPTIONS: V2FrameOption[] = [
	{ value: "none", label: "No frame", subcategoryId: 0 },
	{ value: "0.875-black", label: "0.875\" Black", subcategoryId: 105001 },
	{ value: "0.875-white", label: "0.875\" White", subcategoryId: 105002 },
	{ value: "0.875-oak", label: "0.875\" Oak", subcategoryId: 105003 },
	{ value: "1.25-black", label: "1.25\" Black", subcategoryId: 105005 },
	{ value: "1.25-white", label: "1.25\" White", subcategoryId: 105006 },
	{ value: "1.25-oak", label: "1.25\" Oak", subcategoryId: 105007 },
];

export const FRAMED_BORDER_INCHES = 0.25;
export const FRAMED_MAT_SIZE_OPTION_ID = 67;
export const FRAMED_MAT_COLOR_OPTION_ID = 96;

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

export const CANVAS_AVAILABLE_SIZES = ["8x10", "11x14", "16x20", "24x36", "30x40", "40x60"];

const CANVAS_NAMES: Record<string, string> = {
	"canvas-black-0.75": "Canvas Black — 0.75\" stretch",
	"canvas-black-1.25": "Canvas Black — 1.25\" stretch",
	"canvas-black-1.50": "Canvas Black — 1.50\" stretch",
	"canvas-black-rolled": "Canvas Black — rolled",
	"canvas-white-0.75": "Canvas White — 0.75\" stretch",
	"canvas-white-1.25": "Canvas White — 1.25\" stretch",
	"canvas-white-1.50": "Canvas White — 1.50\" stretch",
	"canvas-white-rolled": "Canvas White — rolled",
};

const CANVAS_SUBCATEGORY_IDS: Record<string, number> = {
	"0.75": 101001,
	"1.25": 101002,
	"1.50": 101003,
	rolled: 101005,
};

const CANVAS_WRAP_OPTION_ID = 3;

const CANVAS_WRAP_HEX: Record<CanvasPaperInfo["color"], string> = {
	black: "#000000",
	white: "#FFFFFF",
};

export function getPaper(slug: string): V2Paper | undefined {
	const paper = V2_PAPERS.find((candidate) => candidate.slug === slug);
	if (paper) return paper;

	const canvasName = CANVAS_NAMES[slug];
	if (canvasName) {
		return { slug, name: canvasName, subcategoryId: 0, gsm: null, description: "" };
	}

	return undefined;
}

export function getSize(slug: string): V2Size | undefined {
	return V2_SIZES.find((size) => size.slug === slug);
}

export function getBorder(value: string): V2BorderOption | undefined {
	return V2_BORDER_OPTIONS.find((border) => border.value === value);
}

export function getFrame(value: string): V2FrameOption | undefined {
	return V2_FRAME_OPTIONS.find((frame) => frame.value === value);
}

export function isCanvasPaper(slug: string): boolean {
	return slug.startsWith("canvas-");
}

export function parseCanvasSlug(slug: string): CanvasPaperInfo | null {
	const match = slug.match(/^canvas-(black|white)-(.+)$/);
	if (!match) return null;

	const color = match[1] as CanvasPaperInfo["color"];
	const thickness = match[2];
	const subcategoryId = CANVAS_SUBCATEGORY_IDS[thickness];
	const wrapHex = CANVAS_WRAP_HEX[color];
	if (!subcategoryId || !wrapHex) return null;

	return {
		color,
		thickness,
		subcategoryId,
		wrapOptionId: CANVAS_WRAP_OPTION_ID,
		wrapHex,
	};
}

export function getCanvasWholesaleCost(thickness: string, sizeSlug: string): number | null {
	return CANVAS_WHOLESALE_COSTS[thickness]?.[sizeSlug] ?? null;
}

export function getFrameWholesaleCost(sizeSlug: string): number | null;
export function getFrameWholesaleCost(frameValue: string, sizeSlug: string): number | null;
export function getFrameWholesaleCost(frameOrSize: string, maybeSizeSlug?: string): number | null {
	const thickness = maybeSizeSlug ? frameOrSize.split("-")[0] : "0.875";
	const sizeSlug = maybeSizeSlug ?? frameOrSize;
	return FRAME_WHOLESALE_COSTS[thickness]?.[sizeSlug] ?? null;
}

export function getWholesaleCost(paperSlug: string, sizeSlug: string): number | null {
	if (isCanvasPaper(paperSlug)) {
		const parsed = parseCanvasSlug(paperSlug);
		if (!parsed) return null;
		return getCanvasWholesaleCost(parsed.thickness, sizeSlug);
	}

	const entry = V2_WHOLESALE_COSTS.find(
		(cost) => cost.paperSlug === paperSlug && cost.sizeSlug === sizeSlug,
	);
	return entry?.wholesaleCost ?? null;
}

export function getPaperBySlug(slug: string): V2Paper | null {
	return getPaper(slug) ?? null;
}

export function getSizeBySlug(slug: string): V2Size | null {
	return getSize(slug) ?? null;
}

export const CANVAS_OPTIONS = Object.entries(CANVAS_NAMES).map(([value, title]) => ({
	title,
	value,
}));

export const PAPER_DROPDOWN_OPTIONS = [
	...V2_PAPERS.map((paper) => ({ title: paper.name, value: paper.slug })),
	...CANVAS_OPTIONS,
];

export const SIZE_DROPDOWN_OPTIONS = V2_SIZES.map((size) => ({
	title: size.label,
	value: size.slug,
}));

export type LumaPaper = V2Paper;
export type LumaSize = V2Size;
export type LumaCatalogEntry = V2CatalogEntry;

export const LUMA_PAPERS = V2_PAPERS;
export const LUMA_SIZES = V2_SIZES;
export const LUMA_WHOLESALE_COSTS = V2_WHOLESALE_COSTS;

export * from "./pricing";
