import { describe, expect, it } from "vitest";
import { applyPublicPageCache } from "./publicPageCache";

function event(
	route = "/gallery",
	options: {
		method?: string;
		headers?: HeadersInit;
		search?: string;
		isDataRequest?: boolean;
	} = {},
) {
	return {
		route: { id: route },
		request: new Request("https://www.angelsrest.online/gallery", {
			method: options.method,
			headers: options.headers,
		}),
		url: new URL(`https://www.angelsrest.online/gallery${options.search ?? ""}`),
		isDataRequest: options.isDataRequest ?? false,
	};
}
function response(headers: Record<string, string> = {}, status = 200) {
	return new Response("public fixture", {
		status,
		headers: { "content-type": "text/html; charset=utf-8", ...headers },
	});
}

describe("public HTML CDN cache", () => {
	it.each([
		"/",
		"/gallery",
		"/gallery/[slug]",
		"/blog",
		"/blog/[slug]",
	])("caches the reviewed public route %s for at most a minute", (route) => {
		const result = response();
		applyPublicPageCache(event(route), result);
		expect(result.headers.get("Vercel-CDN-Cache-Control")).toBe("public, s-maxage=60");
		expect(result.headers.get("Cache-Control")).toBe("public, max-age=0, must-revalidate");
	});
	it.each([
		"/shop",
		"/shop/[slug]",
		"/admin",
		"/delivery/[token]",
		"/portal/[token]",
		"/api/auth/[...all]",
		"/api/download",
		"/orders",
		"/unknown",
	])("never enables CDN caching for %s", (route) => {
		const result = response();
		applyPublicPageCache(event(route), result);
		expect(result.headers.has("Vercel-CDN-Cache-Control")).toBe(false);
	});
	it.each<NonNullable<Parameters<typeof event>[1]>>([
		{ method: "POST" },
		{ headers: { cookie: "session=fixture" } },
		{ headers: { authorization: "Bearer fixture" } },
		{ search: "?preview=true" },
		{ isDataRequest: true },
	])("does not cache personalized, queried, data or mutating requests: %j", (options) => {
		const result = response();
		applyPublicPageCache(event("/", options), result);
		expect(result.headers.has("Vercel-CDN-Cache-Control")).toBe(false);
	});
	it.each<Record<string, string>>([
		{ "set-cookie": "session=fixture" },
		{ "cache-control": "private, no-store" },
		{ "cache-control": "no-cache" },
		{ vary: "Cookie" },
		{ vary: "*" },
		{ "content-type": "application/json" },
		{ "cdn-cache-control": "no-store" },
	])("preserves response restrictions: %j", (headers) => {
		const result = response(headers);
		applyPublicPageCache(event(), result);
		expect(result.headers.has("Vercel-CDN-Cache-Control")).toBe(false);
	});
	it.each([400, 404, 500])("does not cache a %s response", (status) => {
		const result = response({}, status);
		applyPublicPageCache(event(), result);
		expect(result.headers.has("Vercel-CDN-Cache-Control")).toBe(false);
	});
});
