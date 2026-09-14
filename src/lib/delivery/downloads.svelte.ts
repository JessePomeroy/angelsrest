import {
	canSaveGalleryZipFile,
	saveGalleryImagesAsZipFile,
} from "@jessepomeroy/gallery-delivery/download-archive";
import {
	canChooseGalleryDownloadDirectory,
	saveGalleryImagesToDirectory,
} from "@jessepomeroy/gallery-delivery/download-destination";
import {
	createGalleryDownloadPlan,
	type GalleryDownloadImage,
	type GalleryDownloadPlan,
	submitGalleryZipDownloadForm,
} from "@jessepomeroy/gallery-delivery/download-plan";
import { chooseGalleryDownloadRoute } from "@jessepomeroy/gallery-delivery/download-route";
import {
	cancelPreparedZipDownload,
	type PreparedZipDownloadStep,
	type PreparedZipProgress,
	runPreparedZipDownload,
} from "@jessepomeroy/gallery-delivery/prepared-zip";
import { onDestroy, onMount } from "svelte";
import { toasts } from "$lib/stores/toast.svelte";

interface DownloadContext {
	token: string;
	accessGrant: string;
	workerUrl: string;
	gallery: { name: string };
}

/** One controller per mounted delivery page; transport rules remain in gallery-delivery. */
export function createDeliveryDownloads(getContext: () => DownloadContext) {
	let downloading = $state(false);
	let folderDownloadsSupported = $state(false);
	let zipFileDownloadsSupported = $state(false);
	let chooseDownloadFolder = $state(false);
	let folderDownloadStatus = $state<string | null>(null);
	let folderDownloadAbortController = $state<AbortController | null>(null);
	let preparedZipCancelRequestId = $state<string | null>(null);
	let preparedZipCancelingRequestId = $state<string | null>(null);
	let folderDownloadStatusToken = 0;
	let disposed = false;
	let activeContext: DownloadContext | undefined;
	const timers = new Set<number>();
	const formCleanups = new Set<() => void>();
	function later(callback: () => void, delay: number) {
		if (disposed) return;
		const timer = window.setTimeout(() => {
			timers.delete(timer);
			if (!disposed) callback();
		}, delay);
		timers.add(timer);
	}
	onMount(() => {
		folderDownloadsSupported = canChooseGalleryDownloadDirectory(window);
		zipFileDownloadsSupported = canSaveGalleryZipFile(window);
	});
	onDestroy(() => {
		disposed = true;
		for (const timer of timers) window.clearTimeout(timer);
		timers.clear();
		for (const cleanup of formCleanups) cleanup();
		formCleanups.clear();
		if (folderDownloadAbortController) cancelFolderDownload();
	});
	function triggerDownload(image: { downloadUrl: string | null; filename: string }) {
		if (!image.downloadUrl) {
			toasts.show("Downloads are disabled for this gallery.", { type: "error" });
			return;
		}

		const a = document.createElement("a");
		a.href = image.downloadUrl;
		a.download = image.filename;
		a.rel = "noopener";
		document.body.appendChild(a);
		a.click();
		a.remove();
	}

	function submitZipDownload(plan: Extract<GalleryDownloadPlan, { type: "zip" }>) {
		submitGalleryZipDownloadForm({
			plan,
			document,
			setTimeout: (cleanup, delay) => {
				formCleanups.add(cleanup);
				later(() => {
					formCleanups.delete(cleanup);
					cleanup();
				}, delay);
			},
		});
	}

	function setFolderDownloadStatus(message: string | null) {
		if (disposed) return folderDownloadStatusToken;
		folderDownloadStatus = message;
		folderDownloadStatusToken += 1;
		return folderDownloadStatusToken;
	}

	function clearFolderDownloadStatusLater(token: number, delayMs: number) {
		later(() => {
			if (folderDownloadStatusToken === token) {
				setFolderDownloadStatus(null);
			}
		}, delayMs);
	}

	async function saveImagesToFolder(targetImages: GalleryDownloadImage[]) {
		const controller = new AbortController();
		folderDownloadAbortController = controller;
		setFolderDownloadStatus("choose a folder to save this download.");
		try {
			await saveGalleryImagesToDirectory({
				images: targetImages,
				window,
				signal: controller.signal,
				onProgress(progress) {
					setFolderDownloadStatus(
						`saving ${progress.completed}/${progress.total} — ${progress.filename}`,
					);
				},
			});
			const statusToken = setFolderDownloadStatus(
				`saved ${targetImages.length} file${targetImages.length === 1 ? "" : "s"}.`,
			);
			clearFolderDownloadStatusLater(statusToken, 5000);
		} finally {
			if (folderDownloadAbortController === controller) {
				folderDownloadAbortController = null;
			}
		}
	}

	async function saveImagesToZip(targetImages: GalleryDownloadImage[], galleryName: string) {
		const controller = new AbortController();
		folderDownloadAbortController = controller;
		setFolderDownloadStatus("choose where to save this ZIP.");
		try {
			await saveGalleryImagesAsZipFile({
				images: targetImages,
				galleryName,
				window,
				signal: controller.signal,
				onProgress(progress) {
					setFolderDownloadStatus(
						`zipping ${progress.completed}/${progress.total} — ${progress.filename}`,
					);
				},
			});
			const statusToken = setFolderDownloadStatus(
				`saved ${targetImages.length} file${targetImages.length === 1 ? "" : "s"} as ZIP.`,
			);
			clearFolderDownloadStatusLater(statusToken, 5000);
		} finally {
			if (folderDownloadAbortController === controller) {
				folderDownloadAbortController = null;
			}
		}
	}

	function preparedZipStatusMessage(status: PreparedZipProgress) {
		if (status.status === "queued") return "queued ZIP build...";
		if (status.status === "building") {
			return `building ZIP ${status.processedBytes > 0 ? `${status.processedBytes} bytes processed` : `${status.imageCount} files`}`;
		}
		if (status.status === "ready") return "ZIP ready. starting download...";
		return "preparing ZIP...";
	}

	function formatDownloadBytes(bytes: number) {
		if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
		if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
		if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
		return `${bytes} B`;
	}

	function preparedZipSaveProgressMessage({
		filename,
		savedBytes,
		totalBytes,
	}: {
		filename: string;
		savedBytes: number;
		totalBytes?: number;
	}) {
		return totalBytes
			? `saving ${filename} — ${formatDownloadBytes(savedBytes)} / ${formatDownloadBytes(totalBytes)}`
			: `saving ${filename} — ${formatDownloadBytes(savedBytes)}`;
	}

	function preparedZipStepMessage(step: PreparedZipDownloadStep) {
		if (step === "chooseArchiveFile") return "choose where to save this ZIP.";
		if (step === "preparing") return "preparing ZIP...";
		if (step === "savedToFile") return "ZIP saved.";
		return "ZIP download started.";
	}

	async function savePreparedZip(
		plan: Extract<GalleryDownloadPlan, { type: "tooLarge" }>,
		galleryName: string,
		data: DownloadContext,
	) {
		let requestId: string | null = null;
		let activeController: AbortController | null = null;
		try {
			const result = await runPreparedZipDownload({
				accessGrant: data.accessGrant || undefined,
				document,
				galleryName,
				onController(controller) {
					activeController = controller;
					folderDownloadAbortController = controller;
				},
				onProgress(status) {
					setFolderDownloadStatus(preparedZipStatusMessage(status));
				},
				onRequestId(nextRequestId) {
					requestId = nextRequestId;
					preparedZipCancelRequestId = nextRequestId;
					if (disposed) cancelFolderDownload();
				},
				onSaveProgress(progress) {
					setFolderDownloadStatus(preparedZipSaveProgressMessage(progress));
				},
				onStep(step) {
					setFolderDownloadStatus(preparedZipStepMessage(step));
				},
				plan,
				saveToFile: chooseDownloadFolder && zipFileDownloadsSupported,
				token: data.token,
				window,
				workerUrl: data.workerUrl,
			});
			const statusToken = setFolderDownloadStatus(
				preparedZipStepMessage(result.mode === "file" ? "savedToFile" : "browserDownloadStarted"),
			);
			clearFolderDownloadStatusLater(statusToken, 5000);
		} finally {
			if (activeController && folderDownloadAbortController === activeController) {
				folderDownloadAbortController = null;
			}
			if (requestId && preparedZipCancelRequestId === requestId) {
				preparedZipCancelRequestId = null;
			}
		}
	}

	function isPickerAbort(error: unknown) {
		return error instanceof DOMException && error.name === "AbortError";
	}

	function cancelFolderDownload() {
		const data = activeContext;
		if (!data) return;
		setFolderDownloadStatus("canceling download...");
		const requestId = preparedZipCancelRequestId;
		if (requestId && preparedZipCancelingRequestId !== requestId) {
			preparedZipCancelingRequestId = requestId;
			void cancelPreparedZipDownload({
				accessGrant: data.accessGrant || undefined,
				fetch: window.fetch.bind(window),
				requestId,
				token: data.token,
				workerUrl: data.workerUrl,
			})
				.catch((error) => {
					console.warn("prepared ZIP cancellation failed", error);
					const statusToken = setFolderDownloadStatus(
						"download stopped locally. server cancel failed.",
					);
					clearFolderDownloadStatusLater(statusToken, 5000);
				})
				.finally(() => {
					if (preparedZipCancelingRequestId === requestId) {
						preparedZipCancelingRequestId = null;
					}
				});
		}
		folderDownloadAbortController?.abort(new DOMException("Download canceled.", "AbortError"));
	}

	async function downloadImages(
		targetImages: GalleryDownloadImage[],
		emptyMessage: string,
		galleryName = getContext().gallery.name,
	) {
		if (disposed || downloading) return;
		const data = getContext();
		activeContext = data;
		const plan = createGalleryDownloadPlan({
			accessGrant: data.accessGrant || undefined,
			images: targetImages,
			emptyMessage,
			galleryName,
			token: data.token,
			workerUrl: data.workerUrl,
		});

		if (plan.type === "empty") {
			toasts.show(plan.message, { type: "info" });
			return;
		}

		downloading = true;
		try {
			const route = chooseGalleryDownloadRoute({
				chooseLocation: chooseDownloadFolder,
				folderDownloadsSupported,
				planType: plan.type,
				targetCount: targetImages.length,
				zipFileDownloadsSupported,
			});

			if (route === "folder") {
				await saveImagesToFolder(targetImages);
			} else if (route === "browserZip") {
				await saveImagesToZip(targetImages, galleryName);
			} else if (route === "preparedZip" && plan.type === "tooLarge") {
				await savePreparedZip(plan, galleryName, data);
			} else if (plan.type === "single") {
				triggerDownload(plan.image);
			} else if (plan.type === "zip") {
				submitZipDownload(plan);
			}
		} catch (error) {
			if (disposed) return;
			if (isPickerAbort(error)) {
				const statusToken = setFolderDownloadStatus("download canceled.");
				clearFolderDownloadStatusLater(statusToken, 3000);
			} else {
				setFolderDownloadStatus(null);
				toasts.show("Download failed. Please try again.", { type: "error" });
			}
		} finally {
			later(() => {
				downloading = false;
			}, 1500);
		}
	}

	return {
		get downloading() {
			return downloading;
		},
		get folderDownloadInProgress() {
			return folderDownloadAbortController !== null;
		},
		get chosenLocationDownloadsSupported() {
			return folderDownloadsSupported || zipFileDownloadsSupported;
		},
		get chooseDownloadFolder() {
			return chooseDownloadFolder;
		},
		set chooseDownloadFolder(value: boolean) {
			chooseDownloadFolder = value;
		},
		get folderDownloadStatus() {
			return folderDownloadStatus;
		},
		get canceling() {
			return (
				preparedZipCancelRequestId !== null &&
				preparedZipCancelingRequestId === preparedZipCancelRequestId
			);
		},
		downloadImages,
		cancelFolderDownload,
	};
}
