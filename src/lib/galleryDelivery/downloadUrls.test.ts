import { describe, expect, it } from "vitest";
import {
	galleryOriginalDownloadUrl,
	galleryPreparedZipArchiveUrl,
	galleryPreparedZipStatusUrl,
	galleryPrepareZipDownloadUrl,
	galleryZipDownloadUrl,
} from "./downloadUrls";

describe("galleryOriginalDownloadUrl", () => {
	it("encodes the object key and token for Worker download routes", () => {
		expect(
			galleryOriginalDownloadUrl(
				"https://gallery-worker.example.com/",
				"angelsrest.online/galleries/a b/original/dscf1443.raf",
				"token/with?chars",
			),
		).toBe(
			"https://gallery-worker.example.com/download/angelsrest.online%2Fgalleries%2Fa%20b%2Foriginal%2Fdscf1443.raf?token=token%2Fwith%3Fchars",
		);
	});

	it("normalizes ZIP download routes for trailing-slash Worker URLs", () => {
		expect(galleryZipDownloadUrl("https://gallery-worker.example.com/")).toBe(
			"https://gallery-worker.example.com/download/zip",
		);
	});

	it("normalizes prepared ZIP routes and encodes request tokens", () => {
		expect(galleryPrepareZipDownloadUrl("https://gallery-worker.example.com/")).toBe(
			"https://gallery-worker.example.com/download/zip/prepare",
		);
		expect(
			galleryPreparedZipStatusUrl(
				"https://gallery-worker.example.com/",
				"request/with spaces",
				"token/with?chars",
			),
		).toBe(
			"https://gallery-worker.example.com/download/zip/prepare/request%2Fwith%20spaces?token=token%2Fwith%3Fchars",
		);
		expect(
			galleryPreparedZipArchiveUrl(
				"https://gallery-worker.example.com/",
				"/download/zip/prepare/request-123/archive",
				"token/with?chars",
			),
		).toBe(
			"https://gallery-worker.example.com/download/zip/prepare/request-123/archive?token=token%2Fwith%3Fchars",
		);
	});
});
