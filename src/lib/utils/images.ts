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
