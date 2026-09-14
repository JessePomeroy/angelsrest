import {
	galleryOriginalDownloadUrl,
	galleryPreparedZipArchiveUrl,
	galleryPreparedZipCancelUrl,
	galleryPreparedZipStatusUrl,
} from "@jessepomeroy/gallery-delivery/download-urls";
import { describe, expect, it } from "vitest";
import {
	filterPrivateCapabilityAnalytics,
	isPrivateCapabilityPagePath,
	isPrivateCapabilityResponsePath,
	redactPrivateCapabilityPaths,
	scrubPrivateCapabilityTelemetry,
} from "./capabilityPrivacy";
import { applyCapabilityResponsePrivacy } from "./server/capabilityResponsePrivacy";

describe("private capability path privacy", () => {
	it.each([
		"/portal/bearer-token",
		"/portal/bearer-token/",
		"/delivery/gallery-token",
	])("drops analytics for %s", (pathname) => {
		const event = { type: "pageview", url: `https://angelsrest.online${pathname}` };
		expect(isPrivateCapabilityPagePath(pathname)).toBe(true);
		expect(filterPrivateCapabilityAnalytics(event)).toBeNull();
	});

	it("preserves ordinary analytics events", () => {
		const event = { type: "pageview", url: "https://angelsrest.online/shop" };
		expect(filterPrivateCapabilityAnalytics(event)).toBe(event);
		expect(filterPrivateCapabilityAnalytics({ ...event, url: "http://%" })).toBeNull();
	});

	it.each([
		"/portal/bearer-token",
		"/delivery/gallery-token",
		"/api/portal/bearer-token/accept",
		"/api/portal/bearer-token/decline",
		"/api/portal/bearer-token/sign",
	])("sets no-store, no-referrer, and crawler denial on %s", (pathname) => {
		const headers = new Headers({ "Cache-Control": "public, max-age=300" });
		expect(isPrivateCapabilityResponsePath(pathname)).toBe(true);
		applyCapabilityResponsePrivacy(headers, pathname);
		expect(headers.get("X-Robots-Tag")).toBe("noindex, nofollow, noarchive");
		expect(headers.get("Referrer-Policy")).toBe("no-referrer");
		expect(headers.get("Cache-Control")).toBe("private, no-store");
	});

	it("does not change ordinary response headers", () => {
		const headers = new Headers({ "Cache-Control": "public, max-age=300" });
		applyCapabilityResponsePrivacy(headers, "/shop");
		expect(headers.get("X-Robots-Tag")).toBeNull();
		expect(headers.get("Referrer-Policy")).toBeNull();
		expect(headers.get("Cache-Control")).toBe("public, max-age=300");
	});

	it("redacts direct request URLs and transaction fields while retaining route labels", () => {
		const event = {
			request: {
				url: "https://angelsrest.online/portal/portal-secret?view=full",
			},
			transaction: "/delivery/delivery-secret",
			contexts: {
				route: {
					url: "https://angelsrest.online/api/portal/action-secret/sign",
				},
			},
		};

		const scrubbed = scrubPrivateCapabilityTelemetry(event);

		expect(scrubbed).toEqual({
			request: {
				url: "https://angelsrest.online/portal/[redacted]?view=full",
			},
			transaction: "/delivery/[redacted]",
			contexts: {
				route: {
					url: "https://angelsrest.online/api/portal/[redacted]/sign",
				},
			},
		});
		// The scrubber is pure; Sentry callers do not leave raw values mutated in
		// another observer's copy of the event.
		expect(event.request.url).toContain("portal-secret");
	});

	it("scrubs navigation from/to and nested breadcrumb data", () => {
		const scrubbed = scrubPrivateCapabilityTelemetry({
			breadcrumbs: [
				{
					category: "navigation",
					data: {
						from: "https://angelsrest.online/portal/old-secret",
						to: "/delivery/new-secret?download=1",
						nested: {
							requestUrl: "/api/portal/action-secret/accept",
						},
					},
				},
			],
		});

		expect(scrubbed.breadcrumbs[0]?.data).toEqual({
			from: "https://angelsrest.online/portal/[redacted]",
			to: "/delivery/[redacted]?download=1",
			nested: {
				requestUrl: "/api/portal/[redacted]/accept",
			},
		});
	});

	it("removes a persisted private breadcrumb from a later ordinary-page error", () => {
		const scrubbed = scrubPrivateCapabilityTelemetry({
			request: { url: "https://angelsrest.online/shop" },
			transaction: "/shop",
			breadcrumbs: [
				{
					category: "navigation",
					data: {
						from: "/portal/previous-secret",
						to: "/shop",
					},
				},
			],
		});

		expect(scrubbed.request.url).toBe("https://angelsrest.online/shop");
		expect(scrubbed.transaction).toBe("/shop");
		expect(scrubbed.breadcrumbs[0]?.data).toEqual({
			from: "/portal/[redacted]",
			to: "/shop",
		});
	});

	it("leaves ordinary telemetry strings unchanged", () => {
		const ordinary = {
			request: { url: "https://angelsrest.online/shop?kind=print" },
			transaction: "/shop/[kind]",
			breadcrumbs: [{ category: "navigation", data: { from: "/", to: "/shop" } }],
		};

		expect(scrubPrivateCapabilityTelemetry(ordinary)).toEqual(ordinary);
		expect(redactPrivateCapabilityPaths("ordinary /portfolio/client-work path")).toBe(
			"ordinary /portfolio/client-work path",
		);
	});

	it("bounds telemetry processing for long URLs without query assignments", () => {
		const url = `https://worker.test/image/file?${"?".repeat(64_000)}`;
		const started = performance.now();
		expect(scrubPrivateCapabilityTelemetry(url)).toBe(url);
		// A wide budget catches quadratic rescanning without timing normal work closely.
		expect(performance.now() - started).toBeLessThan(1_000);
	});

	it.each([
		galleryOriginalDownloadUrl,
		galleryPreparedZipStatusUrl,
		galleryPreparedZipCancelUrl,
		galleryPreparedZipArchiveUrl,
	])("scrubs capabilities from current delivery URL builder %s", (buildUrl) => {
		const url = buildUrl("https://worker.test", "/archive.zip", "gallery-secret", "grant+secret");
		const event = {
			request: { url: "https://angelsrest.online/shop" },
			breadcrumbs: [{ category: "fetch", data: { url, method: "GET", status_code: 200 } }],
		};

		const scrubbed = scrubPrivateCapabilityTelemetry(event);
		const scrubbedUrl = new URL(scrubbed.breadcrumbs[0].data.url);
		expect(scrubbedUrl.searchParams.get("token")).toBe("[redacted]");
		expect(scrubbedUrl.searchParams.get("accessGrant")).toBe("[redacted]");
		expect(scrubbedUrl.pathname).toBe(new URL(url).pathname);
		expect(scrubbed.request).toEqual(event.request);
		expect(scrubbed.breadcrumbs[0].data.method).toBe("GET");
		expect(scrubbed.breadcrumbs[0].data.status_code).toBe(200);
		expect(event.breadcrumbs[0].data.url).toBe(url);
		expect(JSON.stringify(scrubbed)).not.toMatch(/gallery-secret|grant(?:%2B|\+)secret/);
	});

	it.each([
		[
			"/image/file?v=2&token=first&token=second&accessGrant=grant#preview",
			"/image/file?v=2&token=[redacted]&token=[redacted]&accessGrant=[redacted]#preview",
		],
		[
			"/download/file?%74oken=secret&access%47rant=grant",
			"/download/file?%74oken=[redacted]&access%47rant=[redacted]",
		],
		[
			"/download/file?bad%=keep&token=secret&size=full",
			"/download/file?bad%=keep&token=[redacted]&size=full",
		],
		[
			'GET /delivery/path-secret?token=secret and "/image/file?accessGrant=grant"',
			'GET /delivery/[redacted]?token=[redacted] and "/image/file?accessGrant=[redacted]"',
		],
	])("scrubs query capabilities in telemetry strings: %s", (input, expected) => {
		expect(scrubPrivateCapabilityTelemetry(input)).toBe(expected);
	});
});
