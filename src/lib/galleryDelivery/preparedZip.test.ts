import { describe, expect, it, vi } from "vitest";
import type { GalleryDownloadPlan } from "./downloadPlan";
import {
	PreparedZipDownloadError,
	prepareGalleryZipDownload,
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
});
