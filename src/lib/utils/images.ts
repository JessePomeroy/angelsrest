/**
 * Image URL Builder Utilities
 * 
 * Centralized image URL generation for Sanity images.
 * Provides consistent sizing and format across the app.
 */

import { urlFor } from '$lib/sanity/client';

/**
 * Image URL options
 */
export interface ImageUrlOptions {
	width?: number;
	height?: number;
	quality?: number;
	format?: 'webp' | 'jpg' | 'png';
}

/**
 * Default options for different use cases
 */
const defaults = {
	preview: { width: 600, quality: 80, format: 'webp' as const },
	thumbnail: { width: 400, quality: 80, format: 'webp' as const },
	display: { width: 1200, quality: 90, format: 'webp' as const },
	full: { quality: 90, format: 'jpg' as const },
};

/**
 * Build an optimized image URL from a Sanity image
 */
export function buildImageUrl(
	image: any,
	options: ImageUrlOptions = {}
): string | null {
	if (!image) return null;

	const builder = urlFor(image);
	const { width, quality, format } = { ...defaults.display, ...options };

	let result = builder;

	if (width) result = result.width(width);
	if (height) result = result.height(height);
	if (quality) result = result.quality(quality);
	if (format) result = result.format(format);

	return result.url();
}

/**
 * Build preview image URL (600px, webp, 80%)
 */
export function previewUrl(image: any): string | null {
	return buildImageUrl(image, defaults.preview);
}

/**
 * Build thumbnail URL (400px, webp, 80%)
 */
export function thumbnailUrl(image: any): string | null {
	return buildImageUrl(image, defaults.thumbnail);
}

/**
 * Build display image URL (1200px, webp, 90%)
 */
export function displayUrl(image: any): string | null {
	return buildImageUrl(image, defaults.display);
}

/**
 * Build original full quality URL (jpg)
 */
export function originalUrl(image: any): string | null {
	return buildImageUrl(image, defaults.full);
}

/**
 * Build set of URLs for a product image
 * Used when you need multiple sizes
 */
export function imageSet(image: any): { full: string; thumb: string; original: string; alt: string } | null {
	if (!image) return null;
	
	return {
		full: displayUrl(image),
		thumb: thumbnailUrl(image),
		original: originalUrl(image),
		alt: image.alt || '',
	};
}

/**
 * Parse paper option string from Sanity
 * Format: "Name|subcategoryId|width|height"
 * Example: "Archival Matte 4×6|103001|4|6"
 */
export function parsePaperOption(paper: { name: string; price?: number }): {
	name: string;
	subcategoryId: string;
	width: number;
	height: number;
	price: number | null;
} {
	const parts = paper.name.split('|');
	return {
		name: parts[0] || '',
		subcategoryId: parts[1] || '',
		width: parseInt(parts[2], 10) || 8,
		height: parseInt(parts[3], 10) || 10,
		price: paper.price || null,
	};
}
