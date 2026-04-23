import type { SanityImageSource } from "@sanity/image-url";
import { urlFor } from "$lib/sanity/client";

export interface ImageUrlOptions {
	width?: number;
	height?: number;
	quality?: number;
	format?: "webp" | "jpg" | "png";
}

const defaults = {
	preview: { width: 600, quality: 80, format: "webp" as const },
	thumbnail: { width: 400, quality: 80, format: "webp" as const },
	display: { width: 1200, quality: 90, format: "webp" as const },
	full: { quality: 90, format: "jpg" as const },
};

export function buildImageUrl(
	image: SanityImageSource,
	options: ImageUrlOptions = {},
): string | null {
	if (!image) return null;

	const builder = urlFor(image);
	const { width, height, quality, format } = {
		...defaults.display,
		...options,
	};

	let result = builder;

	if (width) result = result.width(width);
	if (height) result = result.height(height);
	if (quality) result = result.quality(quality);
	if (format) result = result.format(format);

	return result.url();
}

export function previewUrl(image: SanityImageSource): string | null {
	return buildImageUrl(image, defaults.preview);
}

export function thumbnailUrl(image: SanityImageSource): string | null {
	return buildImageUrl(image, defaults.thumbnail);
}

export function displayUrl(image: SanityImageSource): string | null {
	return buildImageUrl(image, defaults.display);
}

export function originalUrl(image: SanityImageSource): string | null {
	return buildImageUrl(image, defaults.full);
}

export function imageSet(
	image: SanityImageSource & { alt?: string },
): { full: string; thumb: string; original: string; alt: string } | null {
	if (!image) return null;

	return {
		full: displayUrl(image) || "",
		thumb: thumbnailUrl(image) || "",
		original: originalUrl(image) || "",
		alt: image.alt || "",
	};
}

/**
 * Format: "Name|subcategoryId|width|height" e.g. "Archival Matte 4x6|103001|4|6"
 *
 * Audit H40: returns `null` on malformed input rather than silently
 * defaulting to 8×10. The previous default could send a customer through
 * checkout with the wrong size metadata. Callers must handle the null
 * branch (existing `$derived.by` call sites already do).
 */
export function parsePaperOption(paper: { name: string; price?: number }): {
	name: string;
	subcategoryId: string;
	width: number;
	height: number;
	price: number | null;
} | null {
	if (!paper?.name || typeof paper.name !== "string") return null;
	const parts = paper.name.split("|");
	const name = parts[0];
	const subcategoryId = parts[1];
	const width = parseInt(parts[2], 10);
	const height = parseInt(parts[3], 10);
	if (!name || !subcategoryId) return null;
	if (!Number.isFinite(width) || width <= 0) return null;
	if (!Number.isFinite(height) || height <= 0) return null;
	return {
		name,
		subcategoryId,
		width,
		height,
		price: paper.price || null,
	};
}
