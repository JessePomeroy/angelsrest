/**
 * TypeScript Types for Shop Data
 *
 * Shared types for products, print collections, print sets, and paper options.
 */

/**
 * Normalized paper option at the public Shop boundary
 * Format: "Name|subcategoryId|width|height"
 * Example: "Archival Matte 4×6|103001|4|6"
 */
export interface PaperOption {
	name: string;
	price?: number;
	subcategoryId?: string;
	width?: number;
	height?: number;
}

/**
 * Parsed paper option with extracted values
 */
export interface ParsedPaper {
	name: string;
	subcategoryId: string;
	width: number;
	height: number;
	price: number | null;
}

/**
 * Product image with multiple URL variants
 */
export interface ProductImage {
	full: string; // 1200px webp for display
	thumb: string; // 400px webp for thumbnails
	original: string; // Full original for LumaPrints
	alt: string;
}

/**
 * Individual product in the shop
 */
export interface Product {
	title: string;
	slug: string;
	preview: string | null;
	price: number;
	category: string;
	featured: boolean;
	inStock: boolean;
	collection?: {
		slug: string;
		title: string;
	} | null;
}

/**
 * Print collection (groups of prints)
 */
export interface PrintCollection {
	title: string;
	slug: string;
	previewImage: string | null;
	alt: string;
	description?: string;
	parent?: {
		title: string;
		slug: string;
	} | null;
}

/**
 * Print set (bundle of multiple images sold together)
 */
export interface PrintSet {
	title: string;
	slug: string;
	previewImage: string | null;
	preview1?: string;
	preview2?: string;
	price: number;
	description?: string;
	availablePapers: PaperOption[];
	parent?: {
		title: string;
		slug: string;
	} | null;
}
