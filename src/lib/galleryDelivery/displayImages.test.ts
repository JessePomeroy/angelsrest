import { describe, expect, it } from "vitest";
import { resolveGalleryDisplayImages } from "./displayImages";

const workerUrl = "https://gallery-worker.example.com/";

describe("resolveGalleryDisplayImages", () => {
	it("uses browser-previewable images as their own thumbnail and preview source", () => {
		const [image] = resolveGalleryDisplayImages(
			[
				{
					filename: "dscf1443.jpg",
					r2Key: "angelsrest.online/galleries/test/original/dscf1443.jpg",
				},
			],
			workerUrl,
		);

		expect(image.canPreview).toBe(true);
		expect(image.previewSource).toBe("self");
		expect(image.thumbUrl).toBe(
			"https://gallery-worker.example.com/image/angelsrest.online%2Fgalleries%2Ftest%2Fthumb%2Fdscf1443.jpg",
		);
		expect(image.previewUrl).toBe(
			"https://gallery-worker.example.com/image/angelsrest.online%2Fgalleries%2Ftest%2Fpreview%2Fdscf1443.jpg",
		);
	});

	it("uses same-stem JPEG sidecars as RAW thumbnails and previews", () => {
		const images = resolveGalleryDisplayImages(
			[
				{
					filename: "dscf1443.jpg",
					r2Key: "angelsrest.online/galleries/test/original/dscf1443.jpg",
				},
				{
					filename: "dscf1443.raf",
					r2Key: "angelsrest.online/galleries/test/original/dscf1443.raf",
				},
			],
			workerUrl,
		);

		const raw = images[1];

		expect(raw.canPreview).toBe(true);
		expect(raw.fileLabel).toBe("raf");
		expect(raw.previewSource).toBe("sidecar");
		expect(raw.thumbUrl).toBe(
			"https://gallery-worker.example.com/image/angelsrest.online%2Fgalleries%2Ftest%2Fthumb%2Fdscf1443.jpg",
		);
		expect(raw.previewUrl).toBe(
			"https://gallery-worker.example.com/image/angelsrest.online%2Fgalleries%2Ftest%2Fpreview%2Fdscf1443.jpg",
		);
	});

	it("encodes preview keys with URL-significant characters", () => {
		const [image] = resolveGalleryDisplayImages(
			[
				{
					filename: "dscf 01?#.jpg",
					r2Key: "angelsrest.online/galleries/test/original/dscf 01?#.jpg",
				},
			],
			workerUrl,
		);

		expect(image.thumbUrl).toBe(
			"https://gallery-worker.example.com/image/angelsrest.online%2Fgalleries%2Ftest%2Fthumb%2Fdscf%2001%3F%23.jpg",
		);
	});

	it("keeps unmatched RAW files as non-previewable file tiles", () => {
		const [raw] = resolveGalleryDisplayImages(
			[
				{
					filename: "dscf9999.raf",
					r2Key: "angelsrest.online/galleries/test/original/dscf9999.raf",
				},
			],
			workerUrl,
		);

		expect(raw.canPreview).toBe(false);
		expect(raw.previewSource).toBe("none");
		expect(raw.fileLabel).toBe("raf");
	});
});
