import { describe, expect, it } from "vitest";
import {
	createGalleryDownloadPlan,
	type GalleryDownloadImage,
	submitGalleryZipDownloadForm,
} from "./downloadPlan";
import { DEFAULT_MAX_ON_DEMAND_ZIP_BYTES } from "./downloadPolicy";

const images: GalleryDownloadImage[] = [
	{
		downloadUrl: "https://gallery-worker.example.com/download/a?token=t",
		filename: "dscf0001.jpg",
		r2Key: "angelsrest.online/gallery/original/dscf0001.jpg",
		sizeBytes: 1000,
	},
	{
		downloadUrl: "https://gallery-worker.example.com/download/b?token=t",
		filename: "dscf0002.raf",
		r2Key: "angelsrest.online/gallery/original/dscf0002.raf",
		sizeBytes: 1400,
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

	it("returns tooLarge for multi-file ZIP requests above the configured byte cap", () => {
		expect(
			createGalleryDownloadPlan({
				images: [
					{ ...images[0], sizeBytes: 800 },
					{ ...images[1], sizeBytes: 500 },
				],
				emptyMessage: "unused",
				galleryName: "client gallery",
				token: "token-123",
				workerUrl: "https://gallery-worker.example.com/",
				maxZipBytes: 1024,
			}),
		).toEqual({
			type: "tooLarge",
			totalBytes: 1300,
			maxBytes: 1024,
			prepare: {
				action: "https://gallery-worker.example.com/download/zip/prepare",
				body: {
					token: "token-123",
					galleryName: "client gallery",
					imageKeys: images.map((img) => img.r2Key),
				},
			},
		});
	});

	it("uses prepared ZIP when multi-file size metadata is missing", () => {
		const plan = createGalleryDownloadPlan({
			images: [
				images[0],
				{ ...images[1], sizeBytes: undefined },
			] as unknown as GalleryDownloadImage[],
			emptyMessage: "unused",
			galleryName: "client gallery",
			token: "token-123",
			workerUrl: "https://gallery-worker.example.com/",
			maxZipBytes: 1024,
		});

		expect(plan).toEqual({
			type: "tooLarge",
			totalBytes: 1025,
			maxBytes: 1024,
			prepare: {
				action: "https://gallery-worker.example.com/download/zip/prepare",
				body: {
					token: "token-123",
					galleryName: "client gallery",
					imageKeys: images.map((img) => img.r2Key),
				},
			},
		});
	});

	it("uses prepared ZIP when multi-file size metadata is invalid", () => {
		const plan = createGalleryDownloadPlan({
			images: [images[0], { ...images[1], sizeBytes: Number.NaN }],
			emptyMessage: "unused",
			galleryName: "client gallery",
			token: "token-123",
			workerUrl: "https://gallery-worker.example.com/",
			maxZipBytes: 1024,
		});

		expect(plan.type).toBe("tooLarge");
		if (plan.type !== "tooLarge") return;
		expect(plan.totalBytes).toBe(1025);
		expect(plan.prepare.body.imageKeys).toEqual(images.map((img) => img.r2Key));
	});

	it("uses the extracted default ZIP cap boundary", () => {
		const atLimit = createGalleryDownloadPlan({
			images: [
				{ ...images[0], sizeBytes: DEFAULT_MAX_ON_DEMAND_ZIP_BYTES - 1 },
				{ ...images[1], sizeBytes: 1 },
			],
			emptyMessage: "unused",
			galleryName: "client gallery",
			token: "token-123",
			workerUrl: "https://gallery-worker.example.com/",
		});
		expect(atLimit.type).toBe("zip");

		expect(
			createGalleryDownloadPlan({
				images: [
					{ ...images[0], sizeBytes: DEFAULT_MAX_ON_DEMAND_ZIP_BYTES },
					{ ...images[1], sizeBytes: 1 },
				],
				emptyMessage: "unused",
				galleryName: "client gallery",
				token: "token-123",
				workerUrl: "https://gallery-worker.example.com/",
			}),
		).toEqual({
			type: "tooLarge",
			totalBytes: DEFAULT_MAX_ON_DEMAND_ZIP_BYTES + 1,
			maxBytes: DEFAULT_MAX_ON_DEMAND_ZIP_BYTES,
			prepare: {
				action: "https://gallery-worker.example.com/download/zip/prepare",
				body: {
					token: "token-123",
					galleryName: "client gallery",
					imageKeys: images.map((img) => img.r2Key),
				},
			},
		});
	});
});

class FakeElement {
	action = "";
	children: FakeElement[] = [];
	hidden = false;
	method = "";
	name = "";
	removed = false;
	submitted = false;
	type = "";
	value = "";

	constructor(readonly tagName: string) {}

	appendChild(child: FakeElement) {
		this.children.push(child);
		return child;
	}

	remove() {
		this.removed = true;
	}

	submit() {
		this.submitted = true;
	}
}

function createFakeDocument() {
	const appended: FakeElement[] = [];
	return {
		appended,
		document: {
			body: {
				appendChild(element: FakeElement) {
					appended.push(element);
					return element;
				},
			},
			createElement(tagName: string) {
				return new FakeElement(tagName);
			},
		} as unknown as Document,
	};
}

describe("submitGalleryZipDownloadForm", () => {
	it("creates and submits the Worker ZIP download form, then schedules cleanup", () => {
		const plan = createGalleryDownloadPlan({
			images,
			emptyMessage: "unused",
			galleryName: "client gallery favorites",
			token: "token/with?chars",
			workerUrl: "https://gallery-worker.example.com/",
		});
		if (plan.type !== "zip") throw new Error("expected zip plan");

		const fake = createFakeDocument();
		const scheduled: Array<{ callback: () => void; delay: number }> = [];

		submitGalleryZipDownloadForm({
			plan,
			document: fake.document,
			cleanupDelayMs: 1234,
			setTimeout(callback, delay) {
				scheduled.push({ callback, delay });
			},
		});

		const form = fake.appended[0];
		expect(form).toMatchObject({
			tagName: "form",
			method: "POST",
			action: "https://gallery-worker.example.com/download/zip",
			hidden: true,
			submitted: true,
			removed: false,
		});
		expect(form.children).toHaveLength(3);
		expect(form.children.map((input) => [input.type, input.name, input.value])).toEqual([
			["hidden", "token", "token/with?chars"],
			["hidden", "galleryName", "client gallery favorites"],
			["hidden", "imageKeys", JSON.stringify(images.map((img) => img.r2Key))],
		]);
		expect(scheduled).toHaveLength(1);
		expect(scheduled[0].delay).toBe(1234);

		scheduled[0].callback();
		expect(form.removed).toBe(true);
	});
});
