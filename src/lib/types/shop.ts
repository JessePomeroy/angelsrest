/**
 * TypeScript Types for Shop Data
 *
 * Shared types for product images and paper options.
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
