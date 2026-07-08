import { describe, expect, it, vi } from "vitest";
import type { GalleryDownloadPlan } from "./downloadPlan";
import {
	cancelPreparedZipDownload,
	PreparedZipDownloadError,
	prepareGalleryZipDownload,
	savePreparedZipArchiveToFile,
	triggerPreparedZipArchiveDownload,
	waitForPreparedZipArchive,
} from "./preparedZip";

const plan: Extract<GalleryDownloadPlan, { type: "tooLarge" }> = {
	type: "tooLarge",
	totalBytes: 1300,
	maxBytes: 1024,
	prepare: {
		action: "https://gallery-worker.example.com/download/zip/prepare",
		body: {
			token: "token/with?chars",
			galleryName: "client gallery",
			imageKeys: [
				"angelsrest.online/gallery/original/dscf0001.jpg",
				"angelsrest.online/gallery/original/dscf0002.raf",
			],
		},
	},
};

function readyStatus() {
	return {
		status: "ready",
		requestId: "request-123",
		imageCount: 2,
		totalBytes: 1300,
		archiveBytes: 1400,
		processedBytes: 1300,
		archiveDownloadPath: "/download/zip/prepare/request-123/archive",
	};
}

function textFromWrites(writes: unknown[]) {
	return writes
		.map((write) => {
			if (write instanceof ArrayBuffer) return new TextDecoder().decode(write);
			if (write instanceof Uint8Array) return new TextDecoder().decode(write);
			if (write instanceof Blob) return "";
			return String(write);
		})
		.join("");
}

function createSaveFilePickerWindow(
	response = new Response("zip-bytes", {
		headers: { "content-length": "9" },
	}),
) {
	const writes: unknown[] = [];
	const writable = {
		write: vi.fn(async (chunk: unknown) => {
			writes.push(chunk);
		}),
		close: vi.fn(async () => {}),
		abort: vi.fn(async () => {}),
	};
	const file = {
		createWritable: vi.fn(async () => writable),
	};
	const showSaveFilePicker = vi.fn(async () => file);
	const win = {
		fetch: vi.fn(async () => response),
		showSaveFilePicker,
	} as unknown as Window & typeof globalThis;

	return { file, showSaveFilePicker, win, writable, writes };
}

describe("prepared ZIP download client", () => {
	it("posts oversized download plans to the Worker prepare route", async () => {
		const fetch = vi.fn(async () =>
			Response.json({
				...readyStatus(),
				status: "queued",
				archiveDownloadPath: undefined,
			}),
		);

		const response = await prepareGalleryZipDownload({ fetch, plan });

		expect(response).toMatchObject({ status: "queued", requestId: "request-123" });
		expect(fetch).toHaveBeenCalledWith(plan.prepare.action, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(plan.prepare.body),
			signal: undefined,
		});
	});

	it("posts cancellation to the prepared ZIP Worker cancel route", async () => {
		const fetch = vi.fn(async () =>
			Response.json({
				...readyStatus(),
				status: "canceled",
				archiveDownloadPath: undefined,
			}),
		);

		const response = await cancelPreparedZipDownload({
			fetch,
			requestId: "request/with spaces",
			token: "token/with?chars",
			workerUrl: "https://gallery-worker.example.com/",
		});

		expect(response).toMatchObject({ status: "canceled", requestId: "request-123" });
		expect(fetch).toHaveBeenCalledWith(
			"https://gallery-worker.example.com/download/zip/prepare/request%2Fwith%20spaces/cancel?token=token%2Fwith%3Fchars",
			{ method: "POST", signal: undefined },
		);
	});

	it("polls until the prepared ZIP archive is ready", async () => {
		const fetch = vi.fn(async () => Response.json(readyStatus()));
		const scheduled: Array<() => void> = [];
		const statuses: string[] = [];
		const promise = waitForPreparedZipArchive({
			clearTimeout: vi.fn(),
			fetch,
			initialStatus: {
				...readyStatus(),
				status: "building",
				archiveDownloadPath: undefined,
			},
			onStatus(status) {
				statuses.push(status.status);
			},
			pollIntervalMs: 25,
			setTimeout(callback) {
				scheduled.push(callback);
				return scheduled.length as unknown as ReturnType<typeof globalThis.setTimeout>;
			},
			token: "token/with?chars",
			workerUrl: "https://gallery-worker.example.com/",
		});

		expect(scheduled).toHaveLength(1);
		scheduled[0]();
		await expect(promise).resolves.toBe(
			"https://gallery-worker.example.com/download/zip/prepare/request-123/archive?token=token%2Fwith%3Fchars",
		);
		expect(statuses).toEqual(["building", "ready"]);
		expect(fetch).toHaveBeenCalledWith(
			"https://gallery-worker.example.com/download/zip/prepare/request-123?token=token%2Fwith%3Fchars",
			{ signal: undefined },
		);
	});

	it("throws when the prepared ZIP build fails", async () => {
		await expect(
			waitForPreparedZipArchive({
				clearTimeout: vi.fn(),
				fetch: vi.fn(),
				initialStatus: {
					...readyStatus(),
					status: "failed",
					error: "source changed",
					archiveDownloadPath: undefined,
				},
				setTimeout: vi.fn(),
				token: "token",
				workerUrl: "https://gallery-worker.example.com",
			}),
		).rejects.toThrow(new PreparedZipDownloadError("source changed"));
	});

	it("treats canceled prepared ZIP status as user cancellation", async () => {
		await expect(
			waitForPreparedZipArchive({
				clearTimeout: vi.fn(),
				fetch: vi.fn(),
				initialStatus: {
					...readyStatus(),
					status: "canceled",
					archiveDownloadPath: undefined,
				},
				setTimeout: vi.fn(),
				token: "token",
				workerUrl: "https://gallery-worker.example.com",
			}),
		).rejects.toMatchObject({ name: "AbortError" });
	});

	it("aborts while waiting for the next prepared ZIP status poll", async () => {
		const controller = new AbortController();
		const clearTimeout = vi.fn();
		const fetch = vi.fn();
		const scheduled: Array<() => void> = [];
		const promise = waitForPreparedZipArchive({
			clearTimeout,
			fetch,
			initialStatus: {
				...readyStatus(),
				status: "building",
				archiveDownloadPath: undefined,
			},
			pollIntervalMs: 25,
			setTimeout(callback) {
				scheduled.push(callback);
				return 123 as unknown as ReturnType<typeof globalThis.setTimeout>;
			},
			signal: controller.signal,
			token: "token",
			workerUrl: "https://gallery-worker.example.com",
		});

		controller.abort(new DOMException("Download canceled.", "AbortError"));

		await expect(promise).rejects.toMatchObject({ name: "AbortError" });
		expect(clearTimeout).toHaveBeenCalledWith(123);
		expect(fetch).not.toHaveBeenCalled();
	});

	it("passes abort signals into in-flight prepared ZIP status fetches", async () => {
		const controller = new AbortController();
		const abortError = new DOMException("Download canceled.", "AbortError");
		const fetch = vi.fn(
			() =>
				new Promise<Response>((_, reject) => {
					controller.signal.addEventListener("abort", () => reject(controller.signal.reason), {
						once: true,
					});
				}),
		);
		const scheduled: Array<() => void> = [];
		const promise = waitForPreparedZipArchive({
			clearTimeout: vi.fn(),
			fetch,
			initialStatus: {
				...readyStatus(),
				status: "building",
				archiveDownloadPath: undefined,
			},
			pollIntervalMs: 25,
			setTimeout(callback) {
				scheduled.push(callback);
				return scheduled.length as unknown as ReturnType<typeof globalThis.setTimeout>;
			},
			signal: controller.signal,
			token: "token",
			workerUrl: "https://gallery-worker.example.com",
		});

		scheduled[0]();
		await Promise.resolve();
		expect(fetch).toHaveBeenCalledWith(
			"https://gallery-worker.example.com/download/zip/prepare/request-123?token=token",
			{ signal: controller.signal },
		);
		controller.abort(abortError);

		await expect(promise).rejects.toBe(abortError);
	});

	it("triggers a browser download for ready prepared ZIP archives", () => {
		const anchor = {
			click: vi.fn(),
			remove: vi.fn(),
			href: "",
			download: "",
			rel: "",
		};
		const document = {
			body: { appendChild: vi.fn() },
			createElement: vi.fn(() => anchor),
		} as unknown as Document;

		triggerPreparedZipArchiveDownload({
			document,
			filename: "client gallery.zip",
			url: "https://gallery-worker.example.com/download/zip/prepare/request-123/archive?token=t",
		});

		expect(anchor).toMatchObject({
			href: "https://gallery-worker.example.com/download/zip/prepare/request-123/archive?token=t",
			download: "client gallery.zip",
			rel: "noopener",
		});
		expect(document.body.appendChild).toHaveBeenCalledWith(anchor);
		expect(anchor.click).toHaveBeenCalled();
		expect(anchor.remove).toHaveBeenCalled();
	});

	it("streams a ready prepared ZIP archive into a user-chosen file", async () => {
		const { showSaveFilePicker, win, writable, writes } = createSaveFilePickerWindow();
		const progress: Array<{ savedBytes: number; totalBytes?: number; filename: string }> = [];

		await savePreparedZipArchiveToFile({
			filename: "client/gallery",
			onProgress: (next) => progress.push(next),
			url: "https://gallery-worker.example.com/download/zip/prepare/request-123/archive?token=t",
			window: win,
		});

		expect(showSaveFilePicker).toHaveBeenCalledWith({
			suggestedName: "client_gallery.zip",
			types: [{ description: "ZIP archive", accept: { "application/zip": [".zip"] } }],
		});
		expect(win.fetch).toHaveBeenCalledWith(
			"https://gallery-worker.example.com/download/zip/prepare/request-123/archive?token=t",
			{ signal: undefined },
		);
		expect(textFromWrites(writes)).toBe("zip-bytes");
		expect(writable.close).toHaveBeenCalledTimes(1);
		expect(writable.abort).not.toHaveBeenCalled();
		expect(progress.at(-1)).toEqual({
			savedBytes: 9,
			totalBytes: 9,
			filename: "client_gallery.zip",
		});
	});

	it("aborts the chosen file when prepared ZIP saving is canceled mid-write", async () => {
		const controller = new AbortController();
		const abortError = new DOMException("Download canceled.", "AbortError");
		const { win, writable } = createSaveFilePickerWindow();
		writable.write.mockImplementationOnce(async () => {
			controller.abort(abortError);
			await Promise.resolve();
		});

		await expect(
			savePreparedZipArchiveToFile({
				filename: "client.zip",
				signal: controller.signal,
				url: "https://gallery-worker.example.com/archive.zip",
				window: win,
			}),
		).rejects.toBe(abortError);

		expect(writable.abort).toHaveBeenCalledWith(abortError);
		expect(writable.close).not.toHaveBeenCalled();
	});
});
