/**
 * Sanity CDN URL helpers for the LumaPrints submission pipeline.
 *
 * Centralizes the rule that **every image submitted to LumaPrints for
 * printing must use `?max=8000&q=100`** as its source URL parameters.
 * Without these params, Sanity's CDN serves a default ~q80 compressed
 * version that's noticeably below print quality. With them, Sanity
 * returns the highest-quality version it offers (capped at 8000 pixels
 * on the long edge to bound source file size regardless of camera
 * resolution).
 *
 * Why these specific values:
 * - `q=100` — maximum quality requested from Sanity's image CDN. Lower
 *   values introduce additional lossy compression before printing.
 * - `max=8000` — caps the image's longest edge at 8000 pixels. Still
 *   300 DPI for prints up to 26.67 inches and 200 DPI for prints up
 *   to 40 inches — print-quality for every LumaPrints product. Bounds
 *   source file size at ~30-40 MB regardless of the photographer's
 *   camera resolution. Future-proofs the platform for high-res cameras
 *   (60+ MP Sony A7R V, 100+ MP Fujifilm GFX) without architectural
 *   changes to the webhook budget.
 *
 * **Use cases (call this function):**
 * - Inside `buildLumaPrintsOrder()` for every order item URL going to
 *   LumaPrints.
 * - In image-compositing paths that fetch source images for print.
 *
 * **DO NOT call this function for:**
 * - Gallery display URLs on the public site (way too much data for web)
 * - Thumbnails, hero images, OG images (use Sanity's regular URL builder
 *   with `?w=` and `?fm=webp` instead)
 * - Anything customer-facing on the web — only print-pipeline submissions
 *
 */

const PRINT_QUALITY_PARAMS = "max=8000&q=100";

/**
 * Strip any existing query params from a Sanity CDN URL and append the
 * print quality params (`?max=8000&q=100`).
 *
 * Pure function — no network, no env, no side effects. Only exact HTTPS
 * `cdn.sanity.io` image sources are transformed. Every other URL is returned
 * byte-for-byte so opaque capabilities and bordered R2 outputs are preserved.
 *
 * Examples:
 *   prepareSanityUrlForPrint("https://cdn.sanity.io/.../photo.jpg")
 *     → "https://cdn.sanity.io/.../photo.jpg?max=8000&q=100"
 *
 *   prepareSanityUrlForPrint("https://cdn.sanity.io/.../photo.jpg?w=1200&fm=webp&q=80")
 *     → "https://cdn.sanity.io/.../photo.jpg?max=8000&q=100"
 *
 *   prepareSanityUrlForPrint("https://cdn.sanity.io/.../photo.jpg?max=8000&q=100")
 *     → "https://cdn.sanity.io/.../photo.jpg?max=8000&q=100"  (idempotent)
 */
export function isSanityPrintSource(url: string) {
	try {
		const parsed = new URL(url);
		return parsed.protocol === "https:" && parsed.hostname === "cdn.sanity.io";
	} catch {
		return false;
	}
}

export function prepareSanityUrlForPrint(url: string): string {
	if (!isSanityPrintSource(url)) return url;
	const base = url.split("?")[0].split("#")[0];
	return `${base}?${PRINT_QUALITY_PARAMS}`;
}
