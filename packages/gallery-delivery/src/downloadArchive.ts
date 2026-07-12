import type { GalleryDownloadImage } from "./downloadPlan";

type SaveFilePickerWindow = Window &
	typeof globalThis & {
		showSaveFilePicker?: (options?: {
			suggestedName?: string;
			types?: Array<{
				description: string;
				accept: Record<string, string[]>;
			}>;
		}) => Promise<FileSystemFileHandleLike>;
	};

type FileSystemFileHandleLike = {
	createWritable: () => Promise<FileSystemWritableFileStreamLike>;
};

type FileSystemWritableFileStreamLike = {
	write: (data: Blob | BufferSource | string) => Promise<void>;
	close: () => Promise<void>;
	abort?: (reason?: unknown) => Promise<void>;
};

type ZipEntry = {
	name: string;
	open: () => Promise<ReadableStream<Uint8Array>>;
};

type CentralDirectoryEntry = {
	nameBytes: Uint8Array;
	crc32: number;
	size: bigint;
	offset: bigint;
};

export type GalleryZipSaveProgress = {
	completed: number;
	total: number;
	filename: string;
};

const ZIP64_VERSION = 45;
const UTF8_DATA_DESCRIPTOR_FLAG = 0x0808;
const UINT16_MAX = 0xffff;
const UINT32_MAX = 0xffffffff;
const textEncoder = new TextEncoder();

let crcTable: Uint32Array | null = null;

export function canSaveGalleryZipFile(win: Window & typeof globalThis = window) {
	return typeof (win as SaveFilePickerWindow).showSaveFilePicker === "function";
}

function galleryDownloadAbortError() {
	return new DOMException("Gallery ZIP download canceled.", "AbortError");
}

function abortReason(signal?: AbortSignal) {
	return signal?.reason ?? galleryDownloadAbortError();
}

function throwIfAborted(signal?: AbortSignal) {
	if (signal?.aborted) {
		throw abortReason(signal);
	}
}

async function raceWithAbort<T>(
	operation: Promise<T>,
	signal: AbortSignal | undefined,
	onAbort?: () => Promise<void> | void,
) {
	if (!signal) return operation;
	throwIfAborted(signal);

	let abortHandler: (() => void) | undefined;
	const abort = new Promise<never>((_, reject) => {
		abortHandler = () => {
			void Promise.resolve(onAbort?.())
				.catch(() => {
					// Surface the user cancellation instead of a best-effort cleanup failure.
				})
				.then(() => {
					reject(abortReason(signal));
				});
		};
		signal.addEventListener("abort", abortHandler, { once: true });
	});

	try {
		return await Promise.race([operation, abort]);
	} finally {
		if (abortHandler) signal.removeEventListener("abort", abortHandler);
	}
}

function getCrcTable() {
	if (crcTable) return crcTable;
	const table = new Uint32Array(256);
	for (let i = 0; i < 256; i++) {
		let c = i;
		for (let j = 0; j < 8; j++) {
			c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		}
		table[i] = c >>> 0;
	}
	crcTable = table;
	return table;
}

function updateCrc32(crc: number, chunk: Uint8Array) {
	const table = getCrcTable();
	let next = crc;
	for (const byte of chunk) {
		next = table[(next ^ byte) & 0xff] ^ (next >>> 8);
	}
	return next >>> 0;
}

function clampUint16(value: number) {
	return Math.min(value, UINT16_MAX);
}

function clampUint32(value: bigint) {
	return value > BigInt(UINT32_MAX) ? UINT32_MAX : Number(value);
}

function writeUint16(view: DataView, offset: number, value: number) {
	view.setUint16(offset, value, true);
}

function writeUint32(view: DataView, offset: number, value: number) {
	view.setUint32(offset, value >>> 0, true);
}

function writeUint64(view: DataView, offset: number, value: bigint) {
	view.setBigUint64(offset, value, true);
}

function concatChunks(chunks: Uint8Array[]) {
	const length = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
	const output = new Uint8Array(length);
	let offset = 0;
	for (const chunk of chunks) {
		output.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return output;
}

function writableChunk(chunk: Uint8Array) {
	return chunk.buffer instanceof ArrayBuffer &&
		chunk.byteOffset === 0 &&
		chunk.byteLength === chunk.buffer.byteLength
		? chunk.buffer
		: chunk.slice().buffer;
}

function zipSafeName(name: string) {
	const filename = name.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? "";
	const safeName = [...filename]
		.map((char) => (char.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(char) ? "_" : char))
		.join("")
		.replace(/^\.+$/, "")
		.trim();
	return safeName || "download";
}

function zip64ExtraForCentralDirectory(entry: CentralDirectoryEntry) {
	const extra = new Uint8Array(28);
	const view = new DataView(extra.buffer);
	writeUint16(view, 0, 0x0001);
	writeUint16(view, 2, 24);
	writeUint64(view, 4, entry.size);
	writeUint64(view, 12, entry.size);
	writeUint64(view, 20, entry.offset);
	return extra;
}

function localFileHeader(nameBytes: Uint8Array) {
	const header = new Uint8Array(30);
	const view = new DataView(header.buffer);
	writeUint32(view, 0, 0x04034b50);
	writeUint16(view, 4, ZIP64_VERSION);
	writeUint16(view, 6, UTF8_DATA_DESCRIPTOR_FLAG);
	writeUint16(view, 8, 0);
	writeUint16(view, 10, 0);
	writeUint16(view, 12, 0);
	writeUint32(view, 14, 0);
	writeUint32(view, 18, 0);
	writeUint32(view, 22, 0);
	writeUint16(view, 26, nameBytes.byteLength);
	writeUint16(view, 28, 0);
	return concatChunks([header, nameBytes]);
}

function dataDescriptor(crc32: number, size: bigint) {
	const descriptor = new Uint8Array(24);
	const view = new DataView(descriptor.buffer);
	writeUint32(view, 0, 0x08074b50);
	writeUint32(view, 4, crc32);
	writeUint64(view, 8, size);
	writeUint64(view, 16, size);
	return descriptor;
}

function centralDirectoryHeader(entry: CentralDirectoryEntry) {
	const extra = zip64ExtraForCentralDirectory(entry);
	const header = new Uint8Array(46);
	const view = new DataView(header.buffer);
	writeUint32(view, 0, 0x02014b50);
	writeUint16(view, 4, ZIP64_VERSION);
	writeUint16(view, 6, ZIP64_VERSION);
	writeUint16(view, 8, UTF8_DATA_DESCRIPTOR_FLAG);
	writeUint16(view, 10, 0);
	writeUint16(view, 12, 0);
	writeUint16(view, 14, 0);
	writeUint32(view, 16, entry.crc32);
	writeUint32(view, 20, UINT32_MAX);
	writeUint32(view, 24, UINT32_MAX);
	writeUint16(view, 28, entry.nameBytes.byteLength);
	writeUint16(view, 30, extra.byteLength);
	writeUint16(view, 32, 0);
	writeUint16(view, 34, 0);
	writeUint16(view, 36, 0);
	writeUint32(view, 38, 0);
	writeUint32(view, 42, UINT32_MAX);
	return concatChunks([header, entry.nameBytes, extra]);
}

function endOfCentralDirectory(
	entryCount: number,
	centralDirectorySize: bigint,
	centralDirectoryOffset: bigint,
	zip64EocdOffset: bigint,
) {
	const zip64Eocd = new Uint8Array(56);
	const zip64View = new DataView(zip64Eocd.buffer);
	writeUint32(zip64View, 0, 0x06064b50);
	writeUint64(zip64View, 4, 44n);
	writeUint16(zip64View, 12, ZIP64_VERSION);
	writeUint16(zip64View, 14, ZIP64_VERSION);
	writeUint32(zip64View, 16, 0);
	writeUint32(zip64View, 20, 0);
	writeUint64(zip64View, 24, BigInt(entryCount));
	writeUint64(zip64View, 32, BigInt(entryCount));
	writeUint64(zip64View, 40, centralDirectorySize);
	writeUint64(zip64View, 48, centralDirectoryOffset);

	const locator = new Uint8Array(20);
	const locatorView = new DataView(locator.buffer);
	writeUint32(locatorView, 0, 0x07064b50);
	writeUint32(locatorView, 4, 0);
	writeUint64(locatorView, 8, zip64EocdOffset);
	writeUint32(locatorView, 16, 1);

	const eocd = new Uint8Array(22);
	const eocdView = new DataView(eocd.buffer);
	writeUint32(eocdView, 0, 0x06054b50);
	writeUint16(eocdView, 4, 0);
	writeUint16(eocdView, 6, 0);
	writeUint16(eocdView, 8, clampUint16(entryCount));
	writeUint16(eocdView, 10, clampUint16(entryCount));
	writeUint32(eocdView, 12, clampUint32(centralDirectorySize));
	writeUint32(eocdView, 16, clampUint32(centralDirectoryOffset));
	writeUint16(eocdView, 20, 0);

	return concatChunks([zip64Eocd, locator, eocd]);
}

function uniqueZipName(filename: string, seen: Map<string, number>) {
	const safeName = zipSafeName(filename);
	for (let index = 0; index < 10_000; index++) {
		const candidate = candidateFilename(safeName, index);
		const normalized = candidate.toLowerCase();
		if (seen.has(normalized)) continue;

		seen.set(normalized, 1);
		return candidate;
	}

	throw new Error(`Could not find an unused ZIP filename for ${filename}.`);
}

function candidateFilename(filename: string, index: number) {
	if (index === 0) return filename;

	const dotIndex = filename.lastIndexOf(".");
	if (dotIndex <= 0) return `${filename}-${index + 1}`;
	return `${filename.slice(0, dotIndex)}-${index + 1}${filename.slice(dotIndex)}`;
}

function safeArchiveFilename(galleryName: string) {
	const base = galleryName.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/^_+|_+$/g, "");
	return `${base || "gallery"}.zip`;
}

async function* zipChunks(
	entries: ZipEntry[],
	signal: AbortSignal | undefined,
	onProgress?: (progress: GalleryZipSaveProgress) => void,
) {
	let written = 0n;
	const centralDirectoryEntries: CentralDirectoryEntry[] = [];

	function record(chunk: Uint8Array) {
		written += BigInt(chunk.byteLength);
		return chunk;
	}

	for (const [index, entry] of entries.entries()) {
		throwIfAborted(signal);
		const nameBytes = textEncoder.encode(zipSafeName(entry.name));
		const offset = written;
		yield record(localFileHeader(nameBytes));

		const stream = await entry.open();
		let crc = 0xffffffff;
		let size = 0n;
		const reader = stream.getReader();
		try {
			while (true) {
				throwIfAborted(signal);
				const { value, done } = await raceWithAbort(reader.read(), signal, () => {
					return reader.cancel(abortReason(signal));
				});
				if (done) break;
				throwIfAborted(signal);
				if (!value) continue;
				crc = updateCrc32(crc, value);
				size += BigInt(value.byteLength);
				yield record(value);
			}
		} finally {
			reader.releaseLock();
		}

		throwIfAborted(signal);
		const crc32 = (crc ^ 0xffffffff) >>> 0;
		yield record(dataDescriptor(crc32, size));
		centralDirectoryEntries.push({ nameBytes, crc32, size, offset });
		onProgress?.({
			completed: index + 1,
			total: entries.length,
			filename: entry.name,
		});
	}

	const centralDirectoryOffset = written;
	for (const entry of centralDirectoryEntries) {
		yield record(centralDirectoryHeader(entry));
	}
	const centralDirectorySize = written - centralDirectoryOffset;
	const zip64EocdOffset = written;
	yield record(
		endOfCentralDirectory(
			centralDirectoryEntries.length,
			centralDirectorySize,
			centralDirectoryOffset,
			zip64EocdOffset,
		),
	);
}

export async function saveGalleryImagesAsZipFile({
	images,
	galleryName,
	window,
	onProgress,
	signal,
}: {
	images: GalleryDownloadImage[];
	galleryName: string;
	window: Window & typeof globalThis;
	onProgress?: (progress: GalleryZipSaveProgress) => void;
	signal?: AbortSignal;
}) {
	const saveFilePicker = (window as SaveFilePickerWindow).showSaveFilePicker;
	if (!saveFilePicker) {
		throw new Error("ZIP file downloads are not supported in this browser.");
	}

	throwIfAborted(signal);
	const file = await saveFilePicker({
		suggestedName: safeArchiveFilename(galleryName),
		types: [
			{
				description: "ZIP archive",
				accept: { "application/zip": [".zip"] },
			},
		],
	});
	const writable = await file.createWritable();
	let writableClosed = false;
	let writableAborted = false;
	const abortWritable = async (reason: unknown = abortReason(signal)) => {
		if (writableClosed || writableAborted) return;
		writableAborted = true;
		await writable.abort?.(reason);
	};
	const seenNames = new Map<string, number>();
	const entries = images.map((image) => ({
		name: uniqueZipName(image.filename, seenNames),
		open: async () => {
			if (!image.downloadUrl) {
				throw new Error(`Downloads are disabled for ${image.filename}.`);
			}

			const response = await raceWithAbort(window.fetch(image.downloadUrl, { signal }), signal);
			if (!response.ok) {
				throw new Error(`Failed to download ${image.filename}.`);
			}
			if (response.body) return response.body;
			return (await response.blob()).stream();
		},
	}));

	try {
		for await (const chunk of zipChunks(entries, signal, onProgress)) {
			throwIfAborted(signal);
			await raceWithAbort(writable.write(writableChunk(chunk)), signal, () => {
				return abortWritable(abortReason(signal));
			});
		}
		throwIfAborted(signal);
		await raceWithAbort(writable.close(), signal, () => {
			return abortWritable(abortReason(signal));
		});
		writableClosed = true;
	} catch (error) {
		if (signal?.aborted) {
			await abortWritable(abortReason(signal)).catch(() => {
				// Best-effort cleanup; surface the cancellation reason to the UI.
			});
			throw abortReason(signal);
		}
		await abortWritable(error).catch(() => {
			// Best-effort cleanup; surface the original download/write failure.
		});
		throw error;
	}
}
