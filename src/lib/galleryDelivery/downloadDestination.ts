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

type FileSystemWritableFileStreamLike = {
	write: (data: Blob | BufferSource | string) => Promise<void>;
	close: () => Promise<void>;
	abort?: (reason?: unknown) => Promise<void>;
};

export type GalleryFolderDownloadProgress = {
	completed: number;
	total: number;
	filename: string;
};

export function canChooseGalleryDownloadDirectory(win: Window & typeof globalThis = window) {
	return typeof (win as DirectoryPickerWindow).showDirectoryPicker === "function";
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
}: {
	images: GalleryDownloadImage[];
	window: Window & typeof globalThis;
	onProgress?: (progress: GalleryFolderDownloadProgress) => void;
}) {
	const directoryPicker = (window as DirectoryPickerWindow).showDirectoryPicker;
	if (!directoryPicker) {
		throw new Error("Folder downloads are not supported in this browser.");
	}

	const directory = await directoryPicker();
	const seenNames = new Set<string>();

	for (const [index, image] of images.entries()) {
		if (!image.downloadUrl) {
			throw new Error(`Downloads are disabled for ${image.filename}.`);
		}

		const filename = await uniqueFilename(directory, image.filename, seenNames);
		const response = await window.fetch(image.downloadUrl);
		if (!response.ok) {
			throw new Error(`Failed to download ${image.filename}.`);
		}

		const file = await directory.getFileHandle(filename, { create: true });
		const writable = await file.createWritable();

		try {
			if (response.body) {
				const reader = response.body.getReader();
				while (true) {
					const { value, done } = await reader.read();
					if (done) break;
					if (value) await writable.write(value);
				}
				await writable.close();
			} else {
				await writable.write(await response.blob());
				await writable.close();
			}
		} catch (error) {
			await writable.abort?.(error);
			throw error;
		}

		onProgress?.({
			completed: index + 1,
			total: images.length,
			filename,
		});
	}
}
