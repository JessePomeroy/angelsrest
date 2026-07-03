import { describe, expect, it, vi } from "vitest";
import {
	canChooseGalleryDownloadDirectory,
	saveGalleryImagesToDirectory,
} from "./downloadDestination";
import type { GalleryDownloadImage } from "./downloadPlan";

const images: GalleryDownloadImage[] = [
	{
		downloadUrl: "https://gallery-worker.example.com/download/a?token=t",
		filename: "dscf/0001.jpg",
		r2Key: "angelsrest.online/gallery/original/dscf0001.jpg",
	},
	{
		downloadUrl: "https://gallery-worker.example.com/download/b?token=t",
		filename: "dscf/0001.jpg",
		r2Key: "angelsrest.online/gallery/original/dscf0001-copy.jpg",
	},
];

function createDirectoryPickerWindow(
	fetchResponse = new Response("file bytes"),
	existingFiles = new Set<string>(),
	hooks: {
		onWrite?: (write: {
			filename: string;
			data: unknown[];
			closed: boolean;
			aborted: boolean;
		}) => void;
	} = {},
) {
	const writes: Array<{ filename: string; data: unknown[]; closed: boolean; aborted: boolean }> =
		[];
	const directory = {
		getFileHandle: vi.fn(async (filename: string, options?: { create?: boolean }) => {
			if (!options?.create && !existingFiles.has(filename.toLowerCase())) {
				throw new DOMException("Not found", "NotFoundError");
			}
			const writeRecord = { filename, data: [] as unknown[], closed: false, aborted: false };
			if (options?.create) writes.push(writeRecord);
			return {
				createWritable: vi.fn(async () => ({
					write: vi.fn(async (data: unknown) => {
						writeRecord.data.push(data);
						hooks.onWrite?.(writeRecord);
					}),
					close: vi.fn(async () => {
						writeRecord.closed = true;
					}),
					abort: vi.fn(async () => {
						writeRecord.aborted = true;
					}),
				})),
			};
		}),
	};

	const win = {
		showDirectoryPicker: vi.fn(async () => directory),
		fetch: vi.fn(async () => fetchResponse.clone()),
	} as unknown as Window & typeof globalThis;

	return { win, directory, writes };
}

describe("gallery folder downloads", () => {
	it("detects whether the browser can choose a download directory", () => {
		const supported = { showDirectoryPicker: vi.fn() } as unknown as Window & typeof globalThis;
		const unsupported = {} as Window & typeof globalThis;

		expect(canChooseGalleryDownloadDirectory(supported)).toBe(true);
		expect(canChooseGalleryDownloadDirectory(unsupported)).toBe(false);
	});

	it("writes selected files to a chosen folder with safe unique filenames", async () => {
		const { win, writes } = createDirectoryPickerWindow(new Response(new Blob(["file bytes"])));
		const progress = vi.fn();

		await saveGalleryImagesToDirectory({ images, window: win, onProgress: progress });

		expect(writes.map((write) => write.filename)).toEqual(["dscf_0001.jpg", "dscf_0001-2.jpg"]);
		expect(writes.map((write) => write.closed)).toEqual([true, true]);
		expect(progress).toHaveBeenLastCalledWith({
			completed: 2,
			total: 2,
			filename: "dscf_0001-2.jpg",
		});
	});

	it("passes an abort signal to direct file fetches", async () => {
		const controller = new AbortController();
		const { win } = createDirectoryPickerWindow(new Response(new Blob(["file bytes"])));

		await saveGalleryImagesToDirectory({
			images: [images[0]],
			window: win,
			signal: controller.signal,
		});

		expect(win.fetch).toHaveBeenCalledWith(images[0].downloadUrl, {
			signal: controller.signal,
		});
	});

	it("does not start fetching files when already canceled", async () => {
		const controller = new AbortController();
		controller.abort();
		const { win } = createDirectoryPickerWindow(new Response(new Blob(["file bytes"])));

		await expect(
			saveGalleryImagesToDirectory({
				images: [images[0]],
				window: win,
				signal: controller.signal,
			}),
		).rejects.toThrow();

		expect(win.fetch).not.toHaveBeenCalled();
	});

	it("aborts the active file and stops before the next image when canceled mid-save", async () => {
		const controller = new AbortController();
		const progress = vi.fn();
		const { win, writes } = createDirectoryPickerWindow(
			new Response(new Blob(["file bytes"])),
			new Set(),
			{
				onWrite() {
					controller.abort();
				},
			},
		);

		await expect(
			saveGalleryImagesToDirectory({
				images,
				window: win,
				onProgress: progress,
				signal: controller.signal,
			}),
		).rejects.toThrow();

		expect(writes).toHaveLength(1);
		expect(writes[0].closed).toBe(false);
		expect(writes[0].aborted).toBe(true);
		expect(progress).not.toHaveBeenCalled();
		expect(win.fetch).toHaveBeenCalledTimes(1);
	});

	it("does not overwrite existing files in the chosen folder", async () => {
		const { win, writes } = createDirectoryPickerWindow(
			new Response(new Blob(["file bytes"])),
			new Set(["dscf_0001.jpg", "dscf_0001-2.jpg"]),
		);

		await saveGalleryImagesToDirectory({ images: [images[0]], window: win });

		expect(writes.map((write) => write.filename)).toEqual(["dscf_0001-3.jpg"]);
	});

	it("fails before fetching when folder downloads are unsupported", async () => {
		await expect(
			saveGalleryImagesToDirectory({
				images,
				window: { fetch: vi.fn() } as unknown as Window & typeof globalThis,
			}),
		).rejects.toThrow("Folder downloads are not supported in this browser.");
	});

	it("surfaces failed direct downloads", async () => {
		const { win } = createDirectoryPickerWindow(new Response("forbidden", { status: 403 }));

		await expect(
			saveGalleryImagesToDirectory({ images: [images[0]], window: win }),
		).rejects.toThrow("Failed to download dscf/0001.jpg.");
	});
});
