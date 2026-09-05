import {
	raceWithAbort,
	withGalleryWritable,
	type FileSystemWritableFileStreamLike,
} from "./downloadWritable";
import type { GalleryDownloadImage } from "./downloadPlan";

type DirectoryPickerWindow = Window &
	typeof globalThis & {
		showDirectoryPicker?: () => Promise<FileSystemDirectoryHandleLike>;
	};

type FileSystemDirectoryHandleLike = {
	getFileHandle: (
		name: string,
		options?: { create?: boolean },
	) => Promise<FileSystemFileHandleLike>;
};

type FileSystemFileHandleLike = {
	createWritable: () => Promise<FileSystemWritableFileStreamLike>;
};

export type GalleryFolderDownloadProgress = {
	completed: number;
	total: number;
	filename: string;
};

export function canChooseGalleryDownloadDirectory(win: Window & typeof globalThis = window) {
	return typeof (win as DirectoryPickerWindow).showDirectoryPicker === "function";
}

function galleryDownloadAbortError() {
	return new DOMException("Gallery download canceled.", "AbortError");
}

function throwIfAborted(signal?: AbortSignal) {
	if (signal?.aborted) {
		throw signal.reason ?? galleryDownloadAbortError();
	}
}

function abortReason(signal?: AbortSignal) {
	return signal?.reason ?? galleryDownloadAbortError();
}

function safeFilename(filename: string) {
	return filename.replace(/[\\/:*?"<>|]/g, "_").trim() || "download";
}

function candidateFilename(filename: string, index: number) {
	if (index === 0) return filename;

	const dotIndex = filename.lastIndexOf(".");
	if (dotIndex <= 0) return `${filename}-${index + 1}`;
	return `${filename.slice(0, dotIndex)}-${index + 1}${filename.slice(dotIndex)}`;
}

async function fileExists(directory: FileSystemDirectoryHandleLike, filename: string) {
	try {
		await directory.getFileHandle(filename);
		return true;
	} catch (error) {
		if (error instanceof DOMException && error.name === "NotFoundError") return false;
		throw error;
	}
}

async function uniqueFilename(
	directory: FileSystemDirectoryHandleLike,
	filename: string,
	seen: Set<string>,
) {
	const safeName = safeFilename(filename);

	for (let index = 0; index < 10_000; index++) {
		const candidate = candidateFilename(safeName, index);
		const normalized = candidate.toLowerCase();
		if (seen.has(normalized)) continue;
		if (await fileExists(directory, candidate)) continue;

		seen.add(normalized);
		return candidate;
	}

	throw new Error(`Could not find an unused filename for ${filename}.`);
}

export async function saveGalleryImagesToDirectory({
	images,
	window,
	onProgress,
	signal,
}: {
	images: GalleryDownloadImage[];
	window: Window & typeof globalThis;
	onProgress?: (progress: GalleryFolderDownloadProgress) => void;
	signal?: AbortSignal;
}) {
	const directoryPicker = (window as DirectoryPickerWindow).showDirectoryPicker;
	if (!directoryPicker) {
		throw new Error("Folder downloads are not supported in this browser.");
	}

	throwIfAborted(signal);
	const directory = await directoryPicker();
	const seenNames = new Set<string>();

	for (const [index, image] of images.entries()) {
		throwIfAborted(signal);
		if (!image.downloadUrl) {
			throw new Error(`Downloads are disabled for ${image.filename}.`);
		}

		const filename = await uniqueFilename(directory, image.filename, seenNames);
		throwIfAborted(signal);
		const response = await window.fetch(image.downloadUrl, { signal });
		if (!response.ok) {
			throw new Error(`Failed to download ${image.filename}.`);
		}

		const file = await directory.getFileHandle(filename, { create: true });
		const writable = await file.createWritable();

		await withGalleryWritable(
			writable,
			signal,
			async ({ write, abort }) => {
				if (response.body) {
					const reader = response.body.getReader();
					const abortReader = async () => {
						await Promise.allSettled([reader.cancel(abortReason(signal)), abort()]);
					};
					try {
						while (true) {
							throwIfAborted(signal);
							const { value, done } = await raceWithAbort(
								reader.read(),
								signal,
								abortReader,
								"Gallery download canceled.",
							);
							if (done) break;
							throwIfAborted(signal);
							if (value) await write(value);
						}
					} finally {
						reader.releaseLock();
					}
				} else {
					throwIfAborted(signal);
					await write(await response.blob());
				}
			},
			"Gallery download canceled.",
		);

		throwIfAborted(signal);
		onProgress?.({
			completed: index + 1,
			total: images.length,
			filename,
		});
	}
}
