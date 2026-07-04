export const DEFAULT_MAX_ON_DEMAND_ZIP_BYTES = 1024 * 1024 * 1024;

export type GalleryZipLimitMetadata = {
	totalBytes: number;
	maxBytes: number;
};

function parseNonNegativeFiniteNumber(value: string | null) {
	if (value === null || value.trim() === "") return null;
	if (!/^\d+$/.test(value)) return null;
	const number = Number(value);
	return Number.isSafeInteger(number) ? number : null;
}

export function parseGalleryZipLimitHeaders(headers: Headers): GalleryZipLimitMetadata | null {
	const totalBytes = parseNonNegativeFiniteNumber(headers.get("X-Gallery-Zip-Total-Bytes"));
	const maxBytes = parseNonNegativeFiniteNumber(headers.get("X-Gallery-Zip-Limit-Bytes"));

	if (totalBytes === null || maxBytes === null) return null;
	return { totalBytes, maxBytes };
}
