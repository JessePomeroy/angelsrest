import { describe, expect, it } from "vitest";
import { createGalleryDownloadPlan, type GalleryDownloadImage } from "./downloadPlan";

const images: GalleryDownloadImage[] = [
	{
		downloadUrl: "https://gallery-worker.example.com/download/a?token=t",
		filename: "dscf0001.jpg",
		r2Key: "angelsrest.online/gallery/original/dscf0001.jpg",
	},
	{
		downloadUrl: "https://gallery-worker.example.com/download/b?token=t",
		filename: "dscf0002.raf",
		r2Key: "angelsrest.online/gallery/original/dscf0002.raf",
	},
];

describe("createGalleryDownloadPlan", () => {
	it("returns an empty plan with the caller-provided message", () => {
		expect(
			createGalleryDownloadPlan({
				images: [],
				emptyMessage: "no photos selected yet.",
				galleryName: "client gallery",
				token: "token-123",
				workerUrl: "https://gallery-worker.example.com/",
			}),
		).toEqual({ type: "empty", message: "no photos selected yet." });
	});

	it("uses direct download for one image", () => {
		expect(
			createGalleryDownloadPlan({
				images: [images[0]],
				emptyMessage: "unused",
				galleryName: "client gallery",
				token: "token-123",
				workerUrl: "https://gallery-worker.example.com/",
			}),
		).toEqual({ type: "single", image: images[0] });
	});

	it("uses the Worker ZIP route for multiple images", () => {
		expect(
			createGalleryDownloadPlan({
				images,
				emptyMessage: "unused",
				galleryName: "client gallery favorites",
				token: "token/with?chars",
				workerUrl: "https://gallery-worker.example.com/",
			}),
		).toEqual({
			type: "zip",
			action: "https://gallery-worker.example.com/download/zip",
			fields: {
				token: "token/with?chars",
				galleryName: "client gallery favorites",
				imageKeys: JSON.stringify(images.map((img) => img.r2Key)),
			},
		});
	});
});
