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
		description:
			"Bright white archival paper with a matte finish. Smudge-resistant.",
	},
	{
		slug: "glossy",
		name: "Glossy",
		subcategoryId: 103007,
		description:
			"Ultra-smooth high-gloss finish. Vibrant color and deep blacks.",
	},
	{
		slug: "hot-press",
		name: "Hot Press",
		subcategoryId: 103002,
		description:
			"100% cotton rag fine art paper. Smooth, wide color gamut, archival.",
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
		description:
			"Satin finish with no glare and no fingerprints. Portrait standard.",
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

/** Look up paper metadata by slug. */
export function getPaper(slug: string): V2Paper | undefined {
	return V2_PAPERS.find((p) => p.slug === slug);
}

/** Look up size metadata by slug. */
export function getSize(slug: string): V2Size | undefined {
	return V2_SIZES.find((s) => s.slug === slug);
}

/** Look up border option by value. */
export function getBorder(value: string): V2BorderOption | undefined {
	return V2_BORDER_OPTIONS.find((b) => b.value === value);
}
