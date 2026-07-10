import { describe, expect, it, vi } from "vitest";
import { canSaveGalleryZipFile, saveGalleryImagesAsZipFile } from "./downloadArchive";
import type { GalleryDownloadImage } from "./downloadPlan";

const textDecoder = new TextDecoder();

const images: GalleryDownloadImage[] = [
	{
		downloadUrl: "https://gallery-worker.example.com/download/a?token=t",
		filename: "0001.jpg",
		r2Key: "angelsrest.online/gallery/original/dscf0001.jpg",
		sizeBytes: 1000,
	},
	{
		downloadUrl: "https://gallery-worker.example.com/download/b?token=t",
		filename: "0001.jpg",
		r2Key: "angelsrest.online/gallery/original/dscf0001-copy.jpg",
		sizeBytes: 1000,
	},
];

function uint16(view: DataView, offset: number) {
	return view.getUint16(offset, true);
}

function uint32(view: DataView, offset: number) {
	return view.getUint32(offset, true);
}

function uint64(view: DataView, offset: number) {
	return Number(view.getBigUint64(offset, true));
}

function findSignature(bytes: Uint8Array, signature: number, start = 0) {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	for (let offset = start; offset <= bytes.byteLength - 4; offset++) {
		if (uint32(view, offset) === signature) return offset;
	}
	return -1;
}

function readZip64StoredFiles(bytes: Uint8Array) {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const files = new Map<string, string>();
	let offset = findSignature(bytes, 0x02014b50);

	while (offset >= 0 && uint32(view, offset) === 0x02014b50) {
		const nameLength = uint16(view, offset + 28);
		const extraLength = uint16(view, offset + 30);
		const commentLength = uint16(view, offset + 32);
		const nameStart = offset + 46;
		const name = textDecoder.decode(bytes.slice(nameStart, nameStart + nameLength));
		const extraStart = nameStart + nameLength;
		const size = uint64(view, extraStart + 4);
		const localOffset = uint64(view, extraStart + 20);
		const localNameLength = uint16(view, localOffset + 26);
		const localExtraLength = uint16(view, localOffset + 28);
		const dataStart = localOffset + 30 + localNameLength + localExtraLength;
		files.set(name, textDecoder.decode(bytes.slice(dataStart, dataStart + size)));

		offset = extraStart + extraLength + commentLength;
	}

	return files;
}

function concatBytes(chunks: unknown[]) {
	const bytes = chunks.flatMap((chunk) => {
		if (chunk instanceof Uint8Array) return [chunk];
		if (chunk instanceof ArrayBuffer) return [new Uint8Array(chunk)];
		return [];
	});
	const length = bytes.reduce((sum, chunk) => sum + chunk.byteLength, 0);
	const output = new Uint8Array(length);
	let offset = 0;
	for (const chunk of bytes) {
		output.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return output;
}

function createSaveFilePickerWindow({
	onWrite,
}: {
	onWrite?: (write: { data: unknown[]; closed: boolean; aborted: boolean }) => void;
} = {}) {
	const writeRecord = { data: [] as unknown[], closed: false, aborted: false };
	const file = {
		createWritable: vi.fn(async () => ({
			write: vi.fn(async (data: unknown) => {
				writeRecord.data.push(data);
				onWrite?.(writeRecord);
			}),
			close: vi.fn(async () => {
				writeRecord.closed = true;
			}),
			abort: vi.fn(async () => {
				writeRecord.aborted = true;
			}),
		})),
	};
	const win = {
		showSaveFilePicker: vi.fn(async () => file),
		fetch: vi.fn(async (url: string) => new Response(`bytes for ${url}`)),
	} as unknown as Window & typeof globalThis;

	return { win, file, writeRecord };
}

describe("browser gallery ZIP downloads", () => {
	it("detects whether the browser can save a ZIP file", () => {
		const supported = { showSaveFilePicker: vi.fn() } as unknown as Window & typeof globalThis;
		const unsupported = {} as Window & typeof globalThis;

		expect(canSaveGalleryZipFile(supported)).toBe(true);
		expect(canSaveGalleryZipFile(unsupported)).toBe(false);
	});

	it("streams selected images into a user-chosen ZIP file", async () => {
		const { win, writeRecord } = createSaveFilePickerWindow();
		const progress = vi.fn();

		await saveGalleryImagesAsZipFile({
			images,
			galleryName: "avant alien",
			window: win,
			onProgress: progress,
		});

		expect(
			(win as typeof win & { showSaveFilePicker: ReturnType<typeof vi.fn> }).showSaveFilePicker,
		).toHaveBeenCalledWith(
			expect.objectContaining({
				suggestedName: "avant_alien.zip",
			}),
		);
		expect(writeRecord.closed).toBe(true);
		expect(writeRecord.aborted).toBe(false);
		expect(progress).toHaveBeenLastCalledWith({
			completed: 2,
			total: 2,
			filename: "0001-2.jpg",
		});
		expect(readZip64StoredFiles(concatBytes(writeRecord.data))).toEqual(
			new Map([
				["0001.jpg", "bytes for https://gallery-worker.example.com/download/a?token=t"],
				["0001-2.jpg", "bytes for https://gallery-worker.example.com/download/b?token=t"],
			]),
		);
	});

	it("aborts the active ZIP write and does not fetch the next image when canceled", async () => {
		const controller = new AbortController();
		const progress = vi.fn();
		let writeCount = 0;
		const { win, writeRecord } = createSaveFilePickerWindow({
			onWrite() {
				writeCount += 1;
				if (writeCount === 2) {
					controller.abort();
				}
			},
		});

		await expect(
			saveGalleryImagesAsZipFile({
				images,
				galleryName: "avant alien",
				window: win,
				onProgress: progress,
				signal: controller.signal,
			}),
		).rejects.toThrow();

		expect(writeRecord.closed).toBe(false);
		expect(writeRecord.aborted).toBe(true);
		expect(progress).not.toHaveBeenCalled();
		expect(win.fetch).toHaveBeenCalledTimes(1);
	});

	it("flattens unsafe ZIP entry names and de-dupes case-insensitively", async () => {
		const unsafeImages: GalleryDownloadImage[] = [
			{ ...images[0], filename: "../nested/DSCF0001.RAF" },
			{ ...images[1], filename: "nested/dscf0001.raf" },
			{ ...images[1], filename: "bad:name?.jpg" },
			{ ...images[1], filename: "bad_name_.jpg" },
		];
		const { win, writeRecord } = createSaveFilePickerWindow();

		await saveGalleryImagesAsZipFile({
			images: unsafeImages,
			galleryName: "avant alien",
			window: win,
		});

		expect([...readZip64StoredFiles(concatBytes(writeRecord.data)).keys()]).toEqual([
			"DSCF0001.RAF",
			"dscf0001-2.raf",
			"bad_name_.jpg",
			"bad_name_-2.jpg",
		]);
	});

	it("avoids generated suffix collisions on case-insensitive filesystems", async () => {
		const collisionImages: GalleryDownloadImage[] = [
			{ ...images[0], filename: "a.jpg" },
			{ ...images[1], filename: "A.jpg" },
			{ ...images[1], filename: "a-2.jpg" },
		];
		const { win, writeRecord } = createSaveFilePickerWindow();

		await saveGalleryImagesAsZipFile({
			images: collisionImages,
			galleryName: "avant alien",
			window: win,
		});

		expect([...readZip64StoredFiles(concatBytes(writeRecord.data)).keys()]).toEqual([
			"a.jpg",
			"A-2.jpg",
			"a-2-2.jpg",
		]);
	});
});
