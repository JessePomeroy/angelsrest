import type { RequestEvent } from "@sveltejs/kit";

// These loaders return published public content only. Shop, auth and capability
// routes are intentionally excluded. Add a route only after reviewing its loader.
const PUBLIC_PAGE_ROUTES = new Set(["/", "/gallery", "/gallery/[slug]", "/blog", "/blog/[slug]"]);
type CacheEvent = Pick<RequestEvent, "request" | "url" | "isDataRequest"> & {
	route: { id: string | null };
};

export function applyPublicPageCache(event: CacheEvent, response: Response): void {
	if (!PUBLIC_PAGE_ROUTES.has(event.route.id ?? "") || event.isDataRequest || event.url.search)
		return;
	if (!["GET", "HEAD"].includes(event.request.method) || response.status !== 200) return;
	if (event.request.headers.has("authorization") || event.request.headers.has("cookie")) return;
	if (
		response.headers.has("set-cookie") ||
		!response.headers.get("content-type")?.startsWith("text/html")
	)
		return;
	if (/\b(private|no-store|no-cache)\b/i.test(response.headers.get("cache-control") ?? "")) return;
	const vary = (response.headers.get("vary") ?? "")
		.toLowerCase()
		.split(",")
		.map((value) => value.trim())
		.filter(Boolean);
	if (vary.some((value) => value !== "accept-encoding")) return;
	if (response.headers.has("cdn-cache-control") || response.headers.has("vercel-cdn-cache-control"))
		return;
	// Only Vercel's CDN caches the HTML. Browsers must revalidate, and no stale
	// window extends the maximum one-minute delay for newly published content.
	response.headers.set("Cache-Control", "public, max-age=0, must-revalidate");
	response.headers.set("Vercel-CDN-Cache-Control", "public, s-maxage=60");
}
