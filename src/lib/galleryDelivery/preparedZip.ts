import type { GalleryDownloadPlan } from "./downloadPlan";
import {
	galleryPreparedZipArchiveUrl,
	galleryPreparedZipCancelUrl,
	galleryPreparedZipStatusUrl,
} from "./downloadUrls";

export type PreparedZipStatus = "queued" | "building" | "ready" | "failed" | "canceled" | "expired";

export type PreparedZipStatusResponse = {
	status: PreparedZipStatus;
	requestId: string;
	imageCount: number;
	totalBytes: number;
	archiveBytes: number;
	processedBytes: number;
	archiveDownloadPath?: string;
	error?: string;
};

export type PreparedZipProgress = PreparedZipStatusResponse;

type FetchLike = typeof fetch;

type SaveFilePickerWindow = Window &
	typeof globalThis & {
		showSaveFilePicker?: (options?: {
			suggestedName?: string;
			types?: Array<{
				description: string;
				accept: Record<string, string[]>;
			}>;
		}) => Promise<PreparedZipArchiveFileHandle>;
	};

export type PreparedZipArchiveFileHandle = {
	createWritable: () => Promise<FileSystemWritableFileStreamLike>;
};

export type FileSystemWritableFileStreamLike = {
	write: (data: Blob | BufferSource | string) => Promise<void>;
	close: () => Promise<void>;
	abort?: (reason?: unknown) => Promise<void>;
};

export type PreparedZipArchiveFile = {
	file: PreparedZipArchiveFileHandle;
	filename: string;
};

export type PreparedZipArchiveSaveProgress = {
	savedBytes: number;
	totalBytes?: number;
	filename: string;
};

export type PreparedZipDownloadStep =
	| "chooseArchiveFile"
	| "preparing"
	| "savedToFile"
	| "browserDownloadStarted";

export type PreparedZipDownloadResult = {
	controller: AbortController;
	mode: "browser" | "file";
	requestId: string;
};

export class PreparedZipDownloadError extends Error {
	constructor(
		message: string,
		readonly status?: number,
	) {
		super(message);
		this.name = "PreparedZipDownloadError";
	}
}

export async function prepareGalleryZipDownload({
	fetch,
	plan,
	signal,
}: {
	fetch: FetchLike;
	plan: Extract<GalleryDownloadPlan, { type: "tooLarge" }>;
	signal?: AbortSignal;
}) {
	const response = await fetch(plan.prepare.action, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(plan.prepare.body),
		signal,
	});
	return readPreparedZipStatusResponse(response);
}

export async function runPreparedZipDownload({
	controller = new AbortController(),
	document,
	galleryName,
	onController,
	onProgress,
	onRequestId,
	onSaveProgress,
	onStep,
	plan,
	saveToFile,
	token,
	window,
	workerUrl,
}: {
	controller?: AbortController;
	document: Document;
	galleryName: string;
	onController?: (controller: AbortController) => void;
	onProgress?: (status: PreparedZipProgress) => void;
	onRequestId?: (requestId: string) => void;
	onSaveProgress?: (progress: PreparedZipArchiveSaveProgress) => void;
	onStep?: (step: PreparedZipDownloadStep) => void;
	plan: Extract<GalleryDownloadPlan, { type: "tooLarge" }>;
	saveToFile: boolean;
	token: string;
	window: Window & typeof globalThis;
	workerUrl: string;
}): Promise<PreparedZipDownloadResult> {
	const archiveFilename = `${galleryName}.zip`;
	onController?.(controller);

	const archiveFile = saveToFile
		? await choosePreparedZipArchiveFileWithStep({
				filename: archiveFilename,
				onStep,
				window,
			})
		: null;
	throwIfAborted(controller.signal);

	onStep?.("preparing");
	const initialStatus = await prepareGalleryZipDownload({
		fetch: window.fetch.bind(window),
		plan,
		signal: controller.signal,
	});
	onRequestId?.(initialStatus.requestId);

	const archiveUrl = await waitForPreparedZipArchive({
		clearTimeout: window.clearTimeout,
		fetch: window.fetch.bind(window),
		initialStatus,
		onStatus: onProgress,
		setTimeout: window.setTimeout,
		signal: controller.signal,
		token,
		workerUrl,
	});
	if (controller.signal.aborted) {
		throw controller.signal.reason ?? new DOMException("Download canceled.", "AbortError");
	}

	if (archiveFile) {
		await savePreparedZipArchiveResponseToFile({
			archiveFile,
			onProgress: onSaveProgress,
			signal: controller.signal,
			url: archiveUrl,
			window,
		});
		onStep?.("savedToFile");
		return { controller, mode: "file", requestId: initialStatus.requestId };
	}

	triggerPreparedZipArchiveDownload({
		document,
		filename: archiveFilename,
		url: archiveUrl,
	});
	onStep?.("browserDownloadStarted");
	return { controller, mode: "browser", requestId: initialStatus.requestId };
}

async function choosePreparedZipArchiveFileWithStep({
	filename,
	onStep,
	window,
}: {
	filename: string;
	onStep?: (step: PreparedZipDownloadStep) => void;
	window: Window & typeof globalThis;
}) {
	onStep?.("chooseArchiveFile");
	return choosePreparedZipArchiveFile({ filename, window });
}

export async function cancelPreparedZipDownload({
	fetch,
	requestId,
	signal,
	token,
	workerUrl,
}: {
	fetch: FetchLike;
	requestId: string;
	signal?: AbortSignal;
	token: string;
	workerUrl: string;
}) {
	const response = await fetch(galleryPreparedZipCancelUrl(workerUrl, requestId, token), {
		method: "POST",
		signal,
	});
	return readPreparedZipStatusResponse(response);
}

export async function waitForPreparedZipArchive({
	clearTimeout,
	fetch,
	initialStatus,
	onStatus,
	pollIntervalMs = 2000,
	setTimeout,
	signal,
	token,
	workerUrl,
}: {
	clearTimeout: (id: ReturnType<typeof globalThis.setTimeout>) => void;
	fetch: FetchLike;
	initialStatus: PreparedZipStatusResponse;
	onStatus?: (status: PreparedZipProgress) => void;
	pollIntervalMs?: number;
	setTimeout: (callback: () => void, delay: number) => ReturnType<typeof globalThis.setTimeout>;
	signal?: AbortSignal;
	token: string;
	workerUrl: string;
}) {
	let status = initialStatus;

	while (true) {
		onStatus?.(status);
		if (status.status === "ready") {
			if (!status.archiveDownloadPath) {
				throw new PreparedZipDownloadError("Prepared ZIP is ready but missing its archive path.");
			}
			return galleryPreparedZipArchiveUrl(workerUrl, status.archiveDownloadPath, token);
		}
		if (status.status === "canceled") {
			throw new DOMException("Download canceled.", "AbortError");
		}
		if (status.status === "failed" || status.status === "expired") {
			throw new PreparedZipDownloadError(status.error ?? `Prepared ZIP ${status.status}.`);
		}

		await abortableDelay({ clearTimeout, delayMs: pollIntervalMs, setTimeout, signal });
		const response = await fetch(galleryPreparedZipStatusUrl(workerUrl, status.requestId, token), {
			signal,
		});
		status = await readPreparedZipStatusResponse(response);
	}
}

export function triggerPreparedZipArchiveDownload({
	document,
	filename,
	url,
}: {
	document: Document;
	filename: string;
	url: string;
}) {
	const a = document.createElement("a");
	a.href = url;
	a.download = filename;
	a.rel = "noopener";
	document.body.appendChild(a);
	a.click();
	a.remove();
}

export async function choosePreparedZipArchiveFile({
	filename,
	window,
}: {
	filename: string;
	window: Window & typeof globalThis;
}): Promise<PreparedZipArchiveFile> {
	const saveFilePicker = (window as SaveFilePickerWindow).showSaveFilePicker;
	if (!saveFilePicker) {
		throw new Error("ZIP file downloads are not supported in this browser.");
	}

	const safeFilename = preparedZipArchiveFilename(filename);
	const file = await saveFilePicker({
		suggestedName: safeFilename,
		types: [
			{
				description: "ZIP archive",
				accept: { "application/zip": [".zip"] },
			},
		],
	});
	return { file, filename: safeFilename };
}

export async function savePreparedZipArchiveToFile({
	filename,
	onProgress,
	signal,
	url,
	window,
}: {
	filename: string;
	onProgress?: (progress: PreparedZipArchiveSaveProgress) => void;
	signal?: AbortSignal;
	url: string;
	window: Window & typeof globalThis;
}) {
	const archiveFile = await choosePreparedZipArchiveFile({ filename, window });
	return savePreparedZipArchiveResponseToFile({
		archiveFile,
		onProgress,
		signal,
		url,
		window,
	});
}

export async function savePreparedZipArchiveResponseToFile({
	archiveFile,
	onProgress,
	signal,
	url,
	window,
}: {
	archiveFile: PreparedZipArchiveFile;
	onProgress?: (progress: PreparedZipArchiveSaveProgress) => void;
	signal?: AbortSignal;
	url: string;
	window: Window & typeof globalThis;
}) {
	throwIfAborted(signal);

	const response = await raceWithAbort(window.fetch(url, { signal }), signal);
	if (!response.ok) {
		throw new PreparedZipDownloadError("Prepared ZIP archive download failed.", response.status);
	}

	const writable = await archiveFile.file.createWritable();
	let writableClosed = false;
	let writableAborted = false;
	const abortWritable = async (reason: unknown = abortReason(signal)) => {
		if (writableClosed || writableAborted) return;
		writableAborted = true;
		await writable.abort?.(reason);
	};

	const totalBytes = parseContentLength(response.headers.get("content-length"));
	let savedBytes = 0;

	try {
		if (response.body) {
			const reader = response.body.getReader();
			const abortReader = async () => {
				await Promise.allSettled([
					reader.cancel(abortReason(signal)),
					abortWritable(abortReason(signal)),
				]);
			};
			try {
				while (true) {
					throwIfAborted(signal);
					const { value, done } = await raceWithAbort(reader.read(), signal, abortReader);
					if (done) break;
					throwIfAborted(signal);
					if (!value) continue;
					await raceWithAbort(writable.write(writableChunk(value)), signal, () => {
						return abortWritable(abortReason(signal));
					});
					savedBytes += value.byteLength;
					onProgress?.({ savedBytes, totalBytes, filename: archiveFile.filename });
				}
			} finally {
				reader.releaseLock();
			}
		} else {
			throwIfAborted(signal);
			const blob = await response.blob();
			await raceWithAbort(writable.write(blob), signal, () => {
				return abortWritable(abortReason(signal));
			});
			savedBytes = blob.size;
			onProgress?.({ savedBytes, totalBytes, filename: archiveFile.filename });
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

async function readPreparedZipStatusResponse(
	response: Response,
): Promise<PreparedZipStatusResponse> {
	let parsed: unknown;
	try {
		parsed = await response.json();
	} catch {
		throw new PreparedZipDownloadError(
			"Prepared ZIP returned an invalid response.",
			response.status,
		);
	}

	if (!response.ok) {
		throw new PreparedZipDownloadError(messageFromPreparedZipResponse(parsed), response.status);
	}
	if (!isPreparedZipStatusResponse(parsed)) {
		throw new PreparedZipDownloadError(
			"Prepared ZIP returned an invalid response.",
			response.status,
		);
	}
	return parsed;
}

function messageFromPreparedZipResponse(value: unknown) {
	if (value && typeof value === "object") {
		const message =
			(value as { message?: unknown; error?: unknown }).message ??
			(value as { error?: unknown }).error;
		if (typeof message === "string" && message) return message;
	}
	return "Prepared ZIP request failed.";
}

function isPreparedZipStatusResponse(value: unknown): value is PreparedZipStatusResponse {
	if (!value || typeof value !== "object") return false;
	const status = value as Partial<PreparedZipStatusResponse>;
	return (
		isPreparedZipStatus(status.status) &&
		typeof status.requestId === "string" &&
		typeof status.imageCount === "number" &&
		typeof status.totalBytes === "number" &&
		typeof status.archiveBytes === "number" &&
		typeof status.processedBytes === "number" &&
		(status.archiveDownloadPath === undefined || typeof status.archiveDownloadPath === "string") &&
		(status.error === undefined || typeof status.error === "string")
	);
}

function isPreparedZipStatus(value: unknown): value is PreparedZipStatus {
	return (
		value === "queued" ||
		value === "building" ||
		value === "ready" ||
		value === "failed" ||
		value === "canceled" ||
		value === "expired"
	);
}

function preparedZipArchiveFilename(filename: string) {
	const safeName = filename
		.replace(/[\\/:*?"<>|]/g, "_")
		.split("")
		.map((char) => (char.charCodeAt(0) < 32 ? "_" : char))
		.join("")
		.trim();
	const base = safeName || "gallery.zip";
	return base.toLowerCase().endsWith(".zip") ? base : `${base}.zip`;
}

function parseContentLength(value: string | null) {
	if (!value) return undefined;
	const bytes = Number(value);
	if (!Number.isSafeInteger(bytes) || bytes < 0) return undefined;
	return bytes;
}

function writableChunk(chunk: Uint8Array) {
	return chunk.buffer instanceof ArrayBuffer &&
		chunk.byteOffset === 0 &&
		chunk.byteLength === chunk.buffer.byteLength
		? chunk.buffer
		: chunk.slice().buffer;
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

function abortableDelay({
	clearTimeout,
	delayMs,
	setTimeout,
	signal,
}: {
	clearTimeout: (id: ReturnType<typeof globalThis.setTimeout>) => void;
	delayMs: number;
	setTimeout: (callback: () => void, delay: number) => ReturnType<typeof globalThis.setTimeout>;
	signal?: AbortSignal;
}) {
	if (signal?.aborted) {
		return Promise.reject(signal.reason ?? new DOMException("Download canceled.", "AbortError"));
	}

	return new Promise<void>((resolve, reject) => {
		const timeout = setTimeout(() => {
			signal?.removeEventListener("abort", abort);
			resolve();
		}, delayMs);
		function abort() {
			clearTimeout(timeout);
			reject(signal?.reason ?? new DOMException("Download canceled.", "AbortError"));
		}
		signal?.addEventListener("abort", abort, { once: true });
	});
}
