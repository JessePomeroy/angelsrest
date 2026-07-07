import { describe, expect, it } from "vitest";
import { DEFAULT_MAX_ON_DEMAND_ZIP_BYTES, parseGalleryZipLimitHeaders } from "./downloadPolicy";

describe("gallery download policy", () => {
	it("keeps the client-side on-demand ZIP cap aligned with the Worker default", () => {
		expect(DEFAULT_MAX_ON_DEMAND_ZIP_BYTES).toBe(1024 * 1024 * 1024);
	});

	it("parses oversized ZIP response metadata headers", () => {
		const headers = new Headers({
			"X-Gallery-Zip-Total-Bytes": "2147483648",
			"X-Gallery-Zip-Limit-Bytes": "1073741824",
		});

		expect(parseGalleryZipLimitHeaders(headers)).toEqual({
			totalBytes: 2147483648,
			maxBytes: 1073741824,
		});
	});

	it("ignores missing or malformed oversized ZIP response metadata", () => {
		expect(parseGalleryZipLimitHeaders(new Headers())).toBeNull();
		expect(
			parseGalleryZipLimitHeaders(
				new Headers({
					"X-Gallery-Zip-Total-Bytes": "-1",
					"X-Gallery-Zip-Limit-Bytes": "1073741824",
				}),
			),
		).toBeNull();
		expect(
			parseGalleryZipLimitHeaders(
				new Headers({
					"X-Gallery-Zip-Total-Bytes": "2147483648",
					"X-Gallery-Zip-Limit-Bytes": "not-a-number",
				}),
			),
		).toBeNull();
		expect(
			parseGalleryZipLimitHeaders(
				new Headers({
					"X-Gallery-Zip-Total-Bytes": "1.5",
					"X-Gallery-Zip-Limit-Bytes": "1073741824",
				}),
			),
		).toBeNull();
		expect(
			parseGalleryZipLimitHeaders(
				new Headers({
					"X-Gallery-Zip-Total-Bytes": "1e9",
					"X-Gallery-Zip-Limit-Bytes": "1073741824",
				}),
			),
		).toBeNull();
		expect(
			parseGalleryZipLimitHeaders(
				new Headers({
					"X-Gallery-Zip-Total-Bytes": "0x40000000",
					"X-Gallery-Zip-Limit-Bytes": "1073741824",
				}),
			),
		).toBeNull();
		expect(
			parseGalleryZipLimitHeaders(
				new Headers({
					"X-Gallery-Zip-Total-Bytes": String(Number.MAX_SAFE_INTEGER + 1),
					"X-Gallery-Zip-Limit-Bytes": "1073741824",
				}),
			),
		).toBeNull();
		expect(
			parseGalleryZipLimitHeaders(
				new Headers({
					"X-Gallery-Zip-Total-Bytes": " 2147483648 ",
					"X-Gallery-Zip-Limit-Bytes": "1073741824",
				}),
			),
		).toEqual({ totalBytes: 2147483648, maxBytes: 1073741824 });
	});
});
