import { describe, expect, it, vi } from "vitest";
import { saveGalleryImagesAsZipFile } from "./downloadArchive";
import { saveGalleryImagesToDirectory } from "./downloadDestination";
import type { GalleryDownloadImage } from "./downloadPlan";
import { savePreparedZipArchiveResponseToFile } from "./preparedZip";

const images: GalleryDownloadImage[] = [
	{
		downloadUrl: "https://gallery.example/download/photo",
		filename: "photo.jpg",
		r2Key: "gallery/photo.jpg",
		sizeBytes: 5,
	},
];

function destination(response = new Response("bytes")) {
	const writable = {
		write: vi.fn(async (_data: Blob | BufferSource | string) => {}),
		close: vi.fn(async () => {}),
		abort: vi.fn(async (_reason?: unknown) => {}),
	};
	const file = { createWritable: vi.fn(async () => writable) };
	const window = {
		fetch: vi.fn(async () => response),
		showSaveFilePicker: vi.fn(async () => file),
		showDirectoryPicker: vi.fn(async () => ({
			getFileHandle: async (_name: string, options?: { create?: boolean }) => {
				if (!options?.create) throw new DOMException("Not found", "NotFoundError");
				return file;
			},
		})),
	} as unknown as Window & typeof globalThis;
	return { writable, file, window };
}

const strategies = ["zip", "folder", "prepared"] as const;

function deferred() {
	let resolve = () => {};
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

function save(
	strategy: (typeof strategies)[number],
	target: ReturnType<typeof destination>,
	signal?: AbortSignal,
) {
	if (strategy === "zip") {
		return saveGalleryImagesAsZipFile({
			images,
			galleryName: "gallery",
			window: target.window,
			signal,
		});
	}
	if (strategy === "folder") {
		return saveGalleryImagesToDirectory({ images, window: target.window, signal });
	}
	return savePreparedZipArchiveResponseToFile({
		archiveFile: { file: target.file, filename: "gallery.zip" },
		url: "https://gallery.example/archive.zip",
		window: target.window,
		signal,
	});
}

describe.each(strategies)("%s chosen-file lifecycle", (strategy) => {
	it("aborts once and preserves a write failure even if cleanup fails", async () => {
		const target = destination();
		const failure = new Error("disk full");
		target.writable.write.mockRejectedValueOnce(failure);
		target.writable.abort.mockRejectedValueOnce(new Error("cleanup failed"));
		await expect(save(strategy, target)).rejects.toBe(failure);
		expect(target.writable.abort).toHaveBeenCalledExactlyOnceWith(failure);
		expect(target.writable.close).not.toHaveBeenCalled();
	});

	it("aborts once and preserves a close failure", async () => {
		const target = destination();
		const failure = new Error("close failed");
		target.writable.close.mockRejectedValueOnce(failure);
		await expect(save(strategy, target)).rejects.toBe(failure);
		expect(target.writable.close).toHaveBeenCalledTimes(1);
		expect(target.writable.abort).toHaveBeenCalledExactlyOnceWith(failure);
	});

	it("preserves the failure when the destination has no optional abort method", async () => {
		const target = destination();
		const failure = new Error("write failed");
		Reflect.deleteProperty(target.writable, "abort");
		target.writable.write.mockRejectedValueOnce(failure);
		await expect(save(strategy, target)).rejects.toBe(failure);
		expect(target.writable.close).not.toHaveBeenCalled();
	});

	it.each([
		"write",
		"close",
	] as const)("cancels a stalled %s with the original reason", async (operation) => {
		const target = destination();
		const controller = new AbortController();
		const reason = new DOMException("User stopped this download", "AbortError");
		const started = deferred();
		target.writable[operation].mockImplementationOnce(() => {
			started.resolve();
			return new Promise<void>(() => {});
		});
		const saving = save(strategy, target, controller.signal);
		const rejected = expect(saving).rejects.toBe(reason);
		await started.promise;
		controller.abort(reason);
		await rejected;
		expect(target.writable.abort).toHaveBeenCalledExactlyOnceWith(reason);
		if (operation === "write") expect(target.writable.close).not.toHaveBeenCalled();
	});

	it("cancels a stalled reader and releases its lock", async () => {
		const started = deferred();
		const cancel = vi.fn();
		const body = new ReadableStream<Uint8Array>(
			{
				pull() {
					started.resolve();
				},
				cancel,
			},
			{ highWaterMark: 0 },
		);
		const target = destination(new Response(body));
		const controller = new AbortController();
		const reason = new Error("download stopped");
		const rejected = expect(save(strategy, target, controller.signal)).rejects.toBe(reason);
		await started.promise;
		controller.abort(reason);
		await rejected;
		expect(cancel).toHaveBeenCalledExactlyOnceWith(reason);
		expect(target.writable.abort).toHaveBeenCalledExactlyOnceWith(reason);
		expect(target.writable.close).not.toHaveBeenCalled();
		expect(body.locked).toBe(false);
	});

	it("closes successfully without aborting when cancellation arrives later", async () => {
		const target = destination();
		const controller = new AbortController();
		await save(strategy, target, controller.signal);
		controller.abort();
		expect(target.writable.close).toHaveBeenCalledTimes(1);
		expect(target.writable.abort).not.toHaveBeenCalled();
	});
});

it.each([
	"folder",
	"prepared",
] as const)("%s closes a blob fallback exactly once", async (strategy) => {
	const blob = new Blob(["fallback bytes"]);
	const response = new Response();
	vi.spyOn(response, "blob").mockResolvedValue(blob);
	const target = destination(response);
	await save(strategy, target);
	expect(target.writable.write).toHaveBeenCalledExactlyOnceWith(blob);
	expect(target.writable.close).toHaveBeenCalledTimes(1);
	expect(target.writable.abort).not.toHaveBeenCalled();
});
