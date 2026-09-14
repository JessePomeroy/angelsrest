/**
 * Product image with multiple URL variants
 */
export interface ProductImage {
	full: string; // 1200px webp for display
	thumb: string; // 400px webp for thumbnails
	original: string; // Full original for LumaPrints
	alt: string;
}
