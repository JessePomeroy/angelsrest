<script lang="ts">
import { onMount } from "svelte";
import { setupConvex, useConvexClient } from "convex-svelte";
import { api } from "$convex/api";
import type { Id } from "$convex/dataModel";
import { PUBLIC_CONVEX_URL } from "$env/static/public";
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
	applyGalleryFavoriteOverrides,
	beginGalleryFavoriteMutation,
	completeGalleryFavoriteMutation,
	createGalleryFavoriteState,
	rollbackGalleryFavoriteMutation,
} from "@jessepomeroy/gallery-delivery/favorite-state";
import {
	cancelPreparedZipDownload,
	runPreparedZipDownload,
	type PreparedZipDownloadStep,
	type PreparedZipProgress,
} from "@jessepomeroy/gallery-delivery/prepared-zip";
import { toasts } from "$lib/stores/toast.svelte";
import { trapFocus } from "$lib/utils/focusTrap";

let { data, form } = $props();

setupConvex(PUBLIC_CONVEX_URL);
const client = useConvexClient();

// The server remains the source of truth; the pure state helper owns
// per-image optimistic updates and concurrency-safe rollback.
let favoriteState = $state(createGalleryFavoriteState());
let images = $derived(applyGalleryFavoriteOverrides(data.images, favoriteState));
let lightboxIndex = $state(-1);
let lightboxOpen = $derived(lightboxIndex >= 0);
let downloading = $state(false);
let folderDownloadsSupported = $state(false);
let zipFileDownloadsSupported = $state(false);
let chooseDownloadFolder = $state(false);
let folderDownloadStatus = $state<string | null>(null);
let folderDownloadAbortController = $state<AbortController | null>(null);
let preparedZipCancelRequestId = $state<string | null>(null);
let preparedZipCancelingRequestId = $state<string | null>(null);
let folderDownloadStatusToken = 0;
let selectedImageIds = $state(new Set<string>());
let galleryView = $state<"grid" | "list">("grid");
let selectedImages = $derived(images.filter((img) => selectedImageIds.has(img._id)));
let selectedCount = $derived(selectedImages.length);
let allImagesSelected = $derived(
	images.length > 0 && selectedCount === images.length,
);
let folderDownloadInProgress = $derived(folderDownloadAbortController !== null);
let chosenLocationDownloadsSupported = $derived(
	folderDownloadsSupported || zipFileDownloadsSupported,
);
let lightboxEl = $state<HTMLDivElement | null>(null);
let previouslyFocused: HTMLElement | null = null;

onMount(() => {
	folderDownloadsSupported = canChooseGalleryDownloadDirectory(window);
	zipFileDownloadsSupported = canSaveGalleryZipFile(window);
});

function openLightbox(index: number) {
	previouslyFocused = document.activeElement as HTMLElement;
	lightboxIndex = index;
	requestAnimationFrame(() => {
		lightboxEl?.querySelector<HTMLElement>(".lb-close")?.focus();
	});
}

function closeLightbox() {
	lightboxIndex = -1;
	previouslyFocused?.focus();
}

function handleKeydown(e: KeyboardEvent) {
	if (!lightboxOpen) return;
	if (e.key === "Escape") closeLightbox();
	if (e.key === "ArrowRight" && lightboxIndex < images.length - 1)
		lightboxIndex++;
	if (e.key === "ArrowLeft" && lightboxIndex > 0) lightboxIndex--;
	if (lightboxEl) trapFocus(e, lightboxEl);
}

async function toggleFavorite(index: number) {
	if (!data.gallery.favoritesEnabled) return;
	const image = images[index];
	const started = beginGalleryFavoriteMutation(
		favoriteState,
		image._id,
		image.isFavorite,
	);
	if (!started) return;
	favoriteState = started.state;

	try {
		await client.mutation(api.galleries.updateImage, {
			id: image._id as Id<"galleryImages">,
			token: data.token,
			accessGrant: data.accessGrant || undefined,
			isFavorite: started.mutation.nextValue,
		});
		favoriteState = completeGalleryFavoriteMutation(
			favoriteState,
			started.mutation,
		);
	} catch (err) {
		console.error("favorite toggle failed", err);
		favoriteState = rollbackGalleryFavoriteMutation(
			favoriteState,
			started.mutation,
		);
		toasts.show("Couldn't update favorite. Please try again.", { type: "error" });
	}
}

function toggleImageSelection(imageId: string) {
	const next = new Set(selectedImageIds);
	if (next.has(imageId)) {
		next.delete(imageId);
	} else {
		next.add(imageId);
	}
	selectedImageIds = next;
}

function selectAllImages() {
	selectedImageIds = new Set(images.map((img) => img._id));
}

function clearSelection() {
	selectedImageIds = new Set();
}

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
		setTimeout: window.setTimeout,
	});
}

function setFolderDownloadStatus(message: string | null) {
	folderDownloadStatus = message;
	folderDownloadStatusToken += 1;
	return folderDownloadStatusToken;
}

function clearFolderDownloadStatusLater(token: number, delayMs: number) {
	window.setTimeout(() => {
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
	setFolderDownloadStatus("canceling download...");
	const requestId = preparedZipCancelRequestId;
	if (requestId) {
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
	galleryName = data.gallery.name,
) {
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
			await savePreparedZip(plan, galleryName);
		} else if (plan.type === "single") {
			triggerDownload(plan.image);
		} else if (plan.type === "zip") {
			submitZipDownload(plan);
		}
	} catch (error) {
		if (isPickerAbort(error)) {
			const statusToken = setFolderDownloadStatus("download canceled.");
			clearFolderDownloadStatusLater(statusToken, 3000);
		} else {
			setFolderDownloadStatus(null);
			toasts.show("Download failed. Please try again.", { type: "error" });
		}
	} finally {
		window.setTimeout(() => {
			downloading = false;
		}, 1500);
	}
}

function downloadAll() {
	return downloadImages(images, "No photos are available to download yet.");
}

function downloadSelected() {
	return downloadImages(selectedImages, "No photos selected yet.");
}

function downloadFavorites() {
	return downloadImages(
		images.filter((img) => img.isFavorite),
		"No favorites selected yet.",
		`${data.gallery.name}-favorites`,
	);
}

let favoriteCount = $derived(
	images.filter((img) => img.isFavorite).length,
);
</script>

<svelte:head>
	<title>{data.gallery.name} | Gallery</title>
</svelte:head>

<svelte:window onkeydown={handleKeydown} />

{#if data.requiresPassword}
	<section class="password-gate" aria-labelledby="gallery-password-title">
		<h1 id="gallery-password-title">{data.gallery.name}</h1>
		<p>This gallery is password protected.</p>
		<form method="POST" action="?/unlock">
			<label for="gallery-password">gallery password</label>
			<input id="gallery-password" name="password" type="password" autocomplete="current-password" required />
			{#if form?.message}<p class="password-error" role="alert">{form.message}</p>{/if}
			<button type="submit">open gallery</button>
		</form>
	</section>
{:else}
<div class="gallery-page">
	<header class="gallery-header">
		<h1>{data.gallery.name}</h1>
		<p class="gallery-meta">
			{data.gallery.imageCount} photo{data.gallery.imageCount !== 1 ? "s" : ""}
			{#if data.client}
				<span class="separator">&middot;</span> for {data.client.name}
			{/if}
		</p>
		{#if data.gallery.downloadEnabled}
			<div class="download-bar">
				<button class="download-btn" onclick={downloadAll} disabled={downloading}>
					{folderDownloadInProgress ? "saving..." : downloading ? "starting..." : "download all"}
				</button>
				<button
					class="download-btn secondary"
					onclick={downloadSelected}
					disabled={downloading || selectedCount === 0}
				>
					download selected ({selectedCount})
				</button>
				{#if data.gallery.favoritesEnabled && favoriteCount > 0}
					<button class="download-btn secondary" onclick={downloadFavorites} disabled={downloading}>
						download favorites ({favoriteCount})
					</button>
				{/if}
				<button
					class="download-btn tertiary"
					onclick={allImagesSelected ? clearSelection : selectAllImages}
					disabled={downloading || images.length === 0}
				>
					{allImagesSelected ? "clear selection" : "select all"}
				</button>
				<label class="folder-download-toggle" aria-disabled={!chosenLocationDownloadsSupported}>
					<input
						type="checkbox"
						bind:checked={chooseDownloadFolder}
						disabled={!chosenLocationDownloadsSupported || downloading}
					/>
					<span>choose location</span>
				</label>
				{#if folderDownloadInProgress}
					<button
						class="download-btn danger"
						type="button"
						onclick={cancelFolderDownload}
						disabled={preparedZipCancelRequestId !== null &&
							preparedZipCancelingRequestId === preparedZipCancelRequestId}
					>
						{preparedZipCancelRequestId !== null &&
						preparedZipCancelingRequestId === preparedZipCancelRequestId
							? "canceling..."
							: "cancel download"}
					</button>
				{/if}
			</div>
			{#if folderDownloadStatus}
				<p class="download-status" role="status">{folderDownloadStatus}</p>
			{:else if !chosenLocationDownloadsSupported}
				<p class="download-status subtle">chosen-location downloads require a Chromium browser.</p>
			{/if}
		{/if}
		<div class="view-toggle" aria-label="Gallery view">
			<button
				type="button"
				class:active={galleryView === "grid"}
				aria-pressed={galleryView === "grid"}
				onclick={() => {
					galleryView = "grid";
				}}
			>
				grid
			</button>
			<button
				type="button"
				class:active={galleryView === "list"}
				aria-pressed={galleryView === "list"}
				onclick={() => {
					galleryView = "list";
				}}
			>
				list
			</button>
		</div>
	</header>

	{#if galleryView === "grid"}
		<div class="image-grid">
			{#each images as image, i (image._id)}
				<div class="grid-cell">
					<button class="image-btn" onclick={() => openLightbox(i)} aria-label={"View photo " + (i + 1) + " of " + images.length}>
						{#if image.canPreview}
							<img src={image.thumbUrl} alt={"Photo " + (i + 1) + ": " + image.filename} loading="lazy" />
						{:else}
							<span class="file-tile" aria-label={image.filename}>
								<span>{image.fileLabel}</span>
							</span>
						{/if}
					</button>
					{#if data.gallery.favoritesEnabled}
						<button
							class="fav-btn"
							class:is-fav={image.isFavorite}
							onclick={() => toggleFavorite(i)}
							disabled={favoriteState.pendingImageIds.has(image._id)}
							aria-label={image.isFavorite ? "Remove from favorites" : "Add to favorites"}
						>
							{image.isFavorite ? "♥" : "♡"}
						</button>
					{/if}
					{#if data.gallery.downloadEnabled}
						<label
							class="select-photo"
							class:selected={selectedImageIds.has(image._id)}
							aria-label={"Select " + image.filename}
						>
							<input
								type="checkbox"
								checked={selectedImageIds.has(image._id)}
								onchange={() => toggleImageSelection(image._id)}
							/>
							<span aria-hidden="true"></span>
						</label>
					{/if}
					<p class="image-filename">{image.filename}</p>
				</div>
			{/each}
		</div>
	{:else}
		<div class="image-list">
			{#each images as image, i (image._id)}
				<div class="list-row">
					<button class="list-thumb" type="button" onclick={() => openLightbox(i)} aria-label={"View " + image.filename}>
						{#if image.canPreview}
							<img src={image.thumbUrl} alt="" loading="lazy" />
						{:else}
							<span class="file-tile" aria-label={image.filename}>
								<span>{image.fileLabel}</span>
							</span>
						{/if}
					</button>
					<button class="list-info" type="button" onclick={() => openLightbox(i)}>
						<span class="list-filename">{image.filename}</span>
						<span class="list-meta">{image.fileLabel}</span>
					</button>
					<div class="list-actions">
						{#if data.gallery.favoritesEnabled}
							<button
								type="button"
								class="list-fav"
								class:is-fav={image.isFavorite}
								onclick={() => toggleFavorite(i)}
								disabled={favoriteState.pendingImageIds.has(image._id)}
								aria-label={image.isFavorite ? "Remove from favorites" : "Add to favorites"}
							>
								{image.isFavorite ? "♥" : "♡"}
							</button>
						{/if}
						{#if data.gallery.downloadEnabled}
							<label class="list-select" aria-label={"Select " + image.filename}>
								<input
									type="checkbox"
									checked={selectedImageIds.has(image._id)}
									onchange={() => toggleImageSelection(image._id)}
								/>
								<span>select</span>
							</label>
						{/if}
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>

{#if lightboxOpen}
	<div
		class="lightbox"
		role="dialog"
		aria-modal="true"
		aria-label="Image lightbox"
		tabindex="-1"
		bind:this={lightboxEl}
		onclick={(e) => {
			// Backdrop click: only close when the target is the backdrop itself
			if (e.target === e.currentTarget) closeLightbox();
		}}
		onkeydown={handleKeydown}
	>
		<div class="lightbox-content">
			{#if images[lightboxIndex].canPreview}
				<img src={images[lightboxIndex].previewUrl} alt={images[lightboxIndex].filename} />
			{:else}
				<div class="lightbox-file">
					<span>{images[lightboxIndex].fileLabel}</span>
				</div>
			{/if}
			<div class="lightbox-controls">
				<span class="lightbox-counter" aria-live="polite">{lightboxIndex + 1} / {images.length}</span>
				<span class="lightbox-filename">{images[lightboxIndex].filename}</span>
				<div class="lightbox-actions">
					{#if data.gallery.favoritesEnabled}
						<button
							class="lb-btn" aria-label={images[lightboxIndex].isFavorite ? "Remove from favorites" : "Add to favorites"}
							class:is-fav={images[lightboxIndex].isFavorite}
							onclick={() => toggleFavorite(lightboxIndex)}
							disabled={favoriteState.pendingImageIds.has(images[lightboxIndex]._id)}
						>
							{images[lightboxIndex].isFavorite ? "♥ favorited" : "♡ favorite"}
						</button>
					{/if}
					{#if data.gallery.downloadEnabled}
						<a class="lb-btn" aria-label="Download original image" href={images[lightboxIndex].downloadUrl} download>
							↓ download
						</a>
					{/if}
				</div>
			</div>
		</div>
		{#if lightboxIndex > 0}
			<button class="lb-nav lb-prev" aria-label="Previous image" onclick={(e) => { e.stopPropagation(); lightboxIndex--; }}>‹</button>
		{/if}
		{#if lightboxIndex < images.length - 1}
			<button class="lb-nav lb-next" aria-label="Next image" onclick={(e) => { e.stopPropagation(); lightboxIndex++; }}>›</button>
		{/if}
		<button class="lb-close" aria-label="Close lightbox" onclick={closeLightbox}>✕</button>
	</div>
{/if}
{/if}

<style>
	.password-gate {
		max-width: 420px;
		margin: 12vh auto 0;
		padding: 32px 24px;
		font-family: "Synonym", system-ui, sans-serif;
	}
	.password-gate form { display: flex; flex-direction: column; gap: 10px; margin-top: 24px; }
	.password-gate label { font-size: 0.82rem; opacity: 0.7; }
	.password-gate input, .password-gate button {
		padding: 10px 12px;
		border: 1px solid currentColor;
		border-radius: 6px;
		background: transparent;
		color: inherit;
		font: inherit;
	}
	.password-gate button { cursor: pointer; }
	.password-error { margin: 0; color: #ff8d8d; font-size: 0.82rem; }

	.gallery-page {
		max-width: 1200px;
		margin: 0 auto;
		padding: 40px 24px;
		font-family: "Synonym", system-ui, sans-serif;
	}

	.gallery-header {
		margin-bottom: 32px;
	}

	.gallery-header h1 {
		font-family: "Chillax", sans-serif;
		font-size: 2rem;
		font-weight: 500;
		margin: 0 0 8px;
	}

	.gallery-meta {
		font-size: 0.9rem;
		opacity: 0.6;
		margin: 0 0 16px;
	}

	.separator {
		margin: 0 6px;
	}

	.download-bar {
		display: flex;
		flex-wrap: wrap;
		gap: 10px;
	}

	.download-btn {
		padding: 8px 20px;
		border: 1px solid currentColor;
		border-radius: 6px;
		background: transparent;
		font-size: 0.82rem;
		font-family: inherit;
		cursor: pointer;
		transition: opacity 0.15s;
	}

	.download-btn:hover { opacity: 0.7; }
	.download-btn:disabled { opacity: 0.4; cursor: wait; }
	.download-btn.secondary { opacity: 0.6; }
	.download-btn.tertiary { opacity: 0.5; }
	.download-btn.danger {
		color: #ff7777;
		opacity: 0.82;
	}

	.folder-download-toggle {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		padding: 8px 0;
		font-size: 0.78rem;
		opacity: 0.62;
		cursor: pointer;
	}

	.folder-download-toggle[aria-disabled="true"] {
		cursor: not-allowed;
		opacity: 0.35;
	}

	.folder-download-toggle input {
		width: 14px;
		height: 14px;
		accent-color: #8da0ff;
	}

	.download-status {
		margin: 10px 0 0;
		font-size: 0.78rem;
		opacity: 0.58;
	}

	.download-status.subtle {
		opacity: 0.42;
	}

	.view-toggle {
		display: inline-flex;
		gap: 4px;
		margin-top: 12px;
		border: 1px solid rgba(255, 255, 255, 0.16);
		border-radius: 6px;
		padding: 4px;
	}

	.view-toggle button {
		border: none;
		background: transparent;
		color: rgba(255, 255, 255, 0.55);
		font: inherit;
		font-size: 0.78rem;
		padding: 5px 12px;
		border-radius: 4px;
		cursor: pointer;
	}

	.view-toggle button.active {
		background: rgba(255, 255, 255, 0.12);
		color: rgba(255, 255, 255, 0.92);
	}

	.image-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
		gap: 8px;
	}

	.grid-cell {
		position: relative;
		border-radius: 4px;
	}

	.image-btn {
		display: block;
		width: 100%;
		aspect-ratio: 1;
		padding: 0;
		border: none;
		background: none;
		cursor: pointer;
		overflow: hidden;
		border-radius: 4px;
	}

	.image-btn img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		transition: transform 0.2s;
	}

	.file-tile {
		width: 100%;
		height: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(255, 255, 255, 0.08);
		color: currentColor;
	}

	.image-filename {
		margin: 0.45rem 0 0;
		font-size: 0.72rem;
		line-height: 1.3;
		color: rgba(255, 255, 255, 0.52);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.file-tile span,
	.lightbox-file span {
		padding: 6px 12px;
		border: 1px solid currentColor;
		border-radius: 4px;
		text-transform: uppercase;
		font-size: 0.8rem;
		letter-spacing: 0.08em;
		opacity: 0.72;
	}

	.image-btn:hover img {
		transform: scale(1.03);
	}

	.fav-btn {
		position: absolute;
		top: 8px;
		right: 8px;
		width: 32px;
		height: 32px;
		border-radius: 50%;
		border: none;
		background: rgba(0, 0, 0, 0.4);
		color: #fff;
		font-size: 1.1rem;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		opacity: 0;
		transition: opacity 0.15s;
	}

	.grid-cell:hover .fav-btn,
	.grid-cell:focus-within .fav-btn,
	.fav-btn:focus { opacity: 1; }
	.fav-btn.is-fav { opacity: 1; color: #e74c3c; background: rgba(0, 0, 0, 0.5); }

	.select-photo {
		position: absolute;
		top: 8px;
		left: 8px;
		width: 32px;
		height: 32px;
		border-radius: 50%;
		background: rgba(0, 0, 0, 0.4);
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		opacity: 0;
		transition: opacity 0.15s;
	}

	.grid-cell:hover .select-photo,
	.grid-cell:focus-within .select-photo,
	.select-photo.selected {
		opacity: 1;
	}

	.select-photo input {
		position: absolute;
		opacity: 0;
		pointer-events: none;
	}

	.select-photo span {
		width: 16px;
		height: 16px;
		border: 1px solid rgba(255, 255, 255, 0.75);
		border-radius: 3px;
		background: rgba(255, 255, 255, 0.1);
		box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.12);
	}

	.select-photo.selected span {
		border-color: #8da0ff;
		background: #8da0ff;
		box-shadow: inset 0 0 0 3px rgba(0, 0, 0, 0.35);
	}

	.image-list {
		display: flex;
		flex-direction: column;
		border-top: 1px solid rgba(255, 255, 255, 0.1);
	}

	.list-row {
		display: grid;
		grid-template-columns: 64px minmax(0, 1fr) auto;
		gap: 14px;
		align-items: center;
		padding: 10px 0;
		border-bottom: 1px solid rgba(255, 255, 255, 0.1);
	}

	.list-thumb {
		width: 64px;
		aspect-ratio: 1;
		border: none;
		border-radius: 4px;
		padding: 0;
		overflow: hidden;
		background: rgba(255, 255, 255, 0.08);
		cursor: pointer;
	}

	.list-thumb img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}

	.list-info {
		min-width: 0;
		border: none;
		background: transparent;
		color: inherit;
		font: inherit;
		text-align: left;
		cursor: pointer;
	}

	.list-filename,
	.list-meta {
		display: block;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.list-filename {
		color: rgba(255, 255, 255, 0.84);
	}

	.list-meta {
		margin-top: 3px;
		color: rgba(255, 255, 255, 0.42);
		font-size: 0.72rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
	}

	.list-actions {
		display: flex;
		align-items: center;
		gap: 12px;
	}

	.list-fav {
		border: none;
		background: transparent;
		color: rgba(255, 255, 255, 0.48);
		font: inherit;
		font-size: 1rem;
		cursor: pointer;
	}

	.list-fav.is-fav {
		color: #e74c3c;
	}

	.list-select {
		display: flex;
		align-items: center;
		gap: 7px;
		color: rgba(255, 255, 255, 0.58);
		font-size: 0.78rem;
		cursor: pointer;
	}

	/* Lightbox */
	.lightbox {
		position: fixed;
		inset: 0;
		z-index: 200;
		background: rgba(0, 0, 0, 0.92);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 40px;
	}

	.lightbox-content {
		max-width: 90vw;
		max-height: 85vh;
		display: flex;
		flex-direction: column;
		align-items: center;
	}

	.lightbox-content img {
		max-width: 100%;
		max-height: 75vh;
		object-fit: contain;
		border-radius: 4px;
	}

	.lightbox-file {
		width: min(520px, 80vw);
		aspect-ratio: 4 / 3;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 4px;
		background: rgba(255, 255, 255, 0.08);
		color: rgba(255, 255, 255, 0.8);
	}

	.lightbox-controls {
		display: flex;
		align-items: center;
		gap: 16px;
		margin-top: 12px;
		color: rgba(255, 255, 255, 0.7);
		font-size: 0.82rem;
	}

	.lightbox-counter { font-variant-numeric: tabular-nums; }
	.lightbox-filename { opacity: 0.5; flex: 1; }

	.lightbox-actions {
		display: flex;
		gap: 8px;
	}

	.lb-btn {
		padding: 5px 14px;
		border: 1px solid rgba(255, 255, 255, 0.3);
		border-radius: 5px;
		background: transparent;
		color: rgba(255, 255, 255, 0.8);
		font-size: 0.78rem;
		font-family: inherit;
		cursor: pointer;
		text-decoration: none;
		transition: all 0.15s;
	}

	.lb-btn:hover { background: rgba(255, 255, 255, 0.1); }
	.lb-btn.is-fav { color: #e74c3c; border-color: #e74c3c; }

	.lb-nav {
		position: absolute;
		top: 50%;
		transform: translateY(-50%);
		background: none;
		border: none;
		color: rgba(255, 255, 255, 0.6);
		font-size: 3rem;
		cursor: pointer;
		padding: 20px;
		transition: color 0.15s;
	}

	.lb-nav:hover { color: #fff; }
	.lb-prev { left: 8px; }
	.lb-next { right: 8px; }

	.lb-close {
		position: absolute;
		top: 16px;
		right: 20px;
		background: none;
		border: none;
		color: rgba(255, 255, 255, 0.6);
		font-size: 1.5rem;
		cursor: pointer;
		padding: 8px;
	}

	.lb-close:hover { color: #fff; }

	@media (max-width: 768px) {
		.gallery-page { padding: 20px 12px; }
		.gallery-header h1 { font-size: 1.5rem; }
		.image-grid { grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); }
		.lightbox { padding: 16px; }
		.lb-nav { font-size: 2rem; padding: 10px; }
		.download-bar { flex-direction: column; }
		.select-photo { opacity: 1; }
		.list-row { grid-template-columns: 52px minmax(0, 1fr); }
		.list-thumb { width: 52px; }
		.list-actions { grid-column: 2; justify-content: space-between; }
	}
</style>
