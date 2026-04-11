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
 * - `q=100` — maximum quality Sanity's image CDN will serve. Below
 *   this is implicitly lossy. See `~/Documents/quilt/02_reference/sanity-cdn-quality.md`
 *   for the full explanation of how Sanity re-encodes uploaded assets.
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
 *   LumaPrints (current non-bordered prints + future Sharp-composited
 *   bordered prints).
 * - Inside the future Sharp processing pipeline (audit #24 PR #6) when
 *   fetching source images for compositing.
 *
 * **DO NOT call this function for:**
 * - Gallery display URLs on the public site (way too much data for web)
 * - Thumbnails, hero images, OG images (use Sanity's regular URL builder
 *   with `?w=` and `?fm=webp` instead)
 * - Anything customer-facing on the web — only print-pipeline submissions
 *
 * Decision history: `~/Documents/quilt/03_creating/angelsrest/lumaprints-expansion-2026-04-10.md`
 * + memory `project_print_quality_q100`.
 */

const PRINT_QUALITY_PARAMS = "max=8000&q=100";

/**
 * Strip any existing query params from a Sanity CDN URL and append the
 * print quality params (`?max=8000&q=100`).
 *
 * Pure function — no network, no env, no side effects. Safe to call
 * with any URL string. Non-Sanity URLs are passed through with the
 * same transformation (params stripped + print quality params added),
 * which is harmless because LumaPrints will just receive the URL as-is.
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
export function prepareSanityUrlForPrint(url: string): string {
	// Strip any existing query params and fragment so we have a clean base.
	const base = url.split("?")[0].split("#")[0];
	return `${base}?${PRINT_QUALITY_PARAMS}`;
}
