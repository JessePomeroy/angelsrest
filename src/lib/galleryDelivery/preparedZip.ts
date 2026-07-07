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
