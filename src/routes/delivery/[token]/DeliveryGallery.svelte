<script lang="ts">
import { tick, onDestroy } from "svelte";
import type { FunctionReturnType } from "convex/server";
import { useConvexClient } from "convex-svelte";
import { api } from "$convex/api";
import type { Id } from "$convex/dataModel";
import {
	applyGalleryFavoriteOverrides,
	beginGalleryFavoriteMutation,
	completeGalleryFavoriteMutation,
	createGalleryFavoriteState,
	rollbackGalleryFavoriteMutation,
} from "@jessepomeroy/gallery-delivery/favorite-state";
import { createDeliveryDownloads } from "$lib/delivery/downloads.svelte";
import { toasts } from "$lib/stores/toast.svelte";
import { trapFocus } from "$lib/utils/focusTrap";
import { openModal } from "$lib/utils/openModal";
import type { PageData } from "./$types";
import { createGalleryCollection, displayPageImages, type ImageSelection } from "./collection.svelte";

let { data }: { data: PageData } = $props();
const client = useConvexClient();

// The server remains the source of truth; the pure state helper owns
// per-image optimistic updates and concurrency-safe rollback.
let favoriteState = $state(createGalleryFavoriteState());
const collection = createGalleryCollection(() => data, (args) => client.query(api.galleries.getImagesPage, args));
let images = $derived(applyGalleryFavoriteOverrides(collection.images, favoriteState));
let generation = 0;
let downloadGeneration = 0;
let lightboxIntent = 0;
let disposed = false;
onDestroy(() => { disposed = true; generation++; lightboxIntent++; });
const totalCount = $derived(collection.totalCount);
$effect(() => {
	data;
	generation++;
	downloadGeneration++;
	lightboxIntent++;
	lightboxIndex = -1;
	favoriteState = createGalleryFavoriteState();
	failedThumbnailIds = new Set();
	failedPreviewIds = new Set();
	readyDownload = null;
	resolvingDownload = false;
});
let lightboxIndex = $state(-1);
let lightboxOpen = $derived(lightboxIndex >= 0);
const downloads = createDeliveryDownloads(() => data);
let failedThumbnailIds = $state(new Set<string>());
let failedPreviewIds = $state(new Set<string>());
let galleryView = $state<"grid" | "list">("grid");
let galleryItems = $state<HTMLDivElement>();
const visibleImages = $derived(images.slice(0, collection.visibleCount));
const selectedCount = $derived(collection.selectedCount);
const allImagesSelected = $derived(collection.allSelected);
function showMore() {
	return collection.revealMore((id) => {
		const index = visibleImages.findIndex((image) => image._id === id);
		galleryItems?.children.item(index)?.querySelector<HTMLButtonElement>("button")?.focus();
	});
}
let lightboxEl = $state<HTMLDialogElement | null>(null);

function openLightbox(index: number) {
	lightboxIntent++;
	lightboxIndex = index;
	requestAnimationFrame(() => {
		lightboxEl?.querySelector<HTMLElement>(".lb-close")?.focus();
	});
}

function closeLightbox() {
	lightboxIntent++;
	lightboxIndex = -1;
}

async function moveLightbox(direction: -1 | 1) {
	const from = lightboxIndex;
	const intent = lightboxIntent;
	const source = data;
	const nextIndex = from + direction;
	const next = await collection.ensureIndex(nextIndex);
	if (!next || disposed || source !== data || intent !== lightboxIntent || lightboxIndex !== from) return;
	const focused = document.activeElement;
	lightboxIntent++;
	lightboxIndex = nextIndex;
	await restoreLightboxFocus(focused);
}

async function restoreLightboxFocus(focused: Element | null) {
	await tick();
	// Navigation and failed previews can remove the focused control.
	// Keep keyboard input in the lightbox when the focused element was removed.
	if (lightboxEl && focused && !focused.isConnected && document.activeElement === document.body) {
		lightboxEl.querySelector<HTMLElement>(".lb-close")?.focus();
	}
}

async function markPreviewFailed(imageId: string) {
	const focused = document.activeElement;
	failedPreviewIds = markFailed(failedPreviewIds, imageId);
	await restoreLightboxFocus(focused);
}

function handleKeydown(e: KeyboardEvent) {
	if (!lightboxOpen) return;
	// Preserve the browser's native seek controls while the video has focus.
	if (e.target instanceof HTMLVideoElement && (e.key === "ArrowRight" || e.key === "ArrowLeft")) return;
	if (e.key === "ArrowRight") void moveLightbox(1);
	if (e.key === "ArrowLeft") void moveLightbox(-1);
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
	const current = generation;
	const source = data;

	try {
		await client.mutation(api.galleries.updateImage, {
			id: image._id,
			token: data.token,
			accessGrant: data.accessGrant || undefined,
			isFavorite: started.mutation.nextValue,
		});
		if (disposed || current !== generation || source !== data) return;
		favoriteState = completeGalleryFavoriteMutation(
			favoriteState,
			started.mutation,
		);
	} catch (err) {
		if (disposed || current !== generation || source !== data) return;
		console.error("favorite toggle failed", err);
		favoriteState = rollbackGalleryFavoriteMutation(
			favoriteState,
			started.mutation,
		);
		toasts.show("Couldn't update favorite. Please try again.", { type: "error" });
	}
}

function toggleImageSelection(imageId: Id<"galleryImages">) {
	readyDownload = null;
	collection.toggleSelection(imageId);
}
function selectAllImages() {
	readyDownload = null;
	collection.selectAll();
}
function clearSelection() {
	readyDownload = null;
	collection.clearSelection();
}

function markFailed(set: Set<string>, imageId: string) {
	return new Set(set).add(imageId);
}

let resolvingDownload = $state(false);
let readyDownload = $state.raw<{ images: typeof data.images; name: string; message: string } | null>(null);
async function downloadSelection(selection: ImageSelection, message: string, name = data.gallery.name) {
	if (resolvingDownload || downloads.downloading) return;
	if (!collection.hasMore && images.length === totalCount) {
		const rows = images.filter((image) => selection.kind === "all" ? !selection.excludedIds.includes(image._id)
			: selection.kind === "selected" ? selection.ids.includes(image._id) : image.isFavorite);
		return downloads.downloadImages(rows, message, name);
	}
	const current = generation;
	const request = ++downloadGeneration;
	const source = data;
	const context = { galleryId: source.gallery._id, token: source.token, accessGrant: source.accessGrant || undefined };
	resolvingDownload = true;
	readyDownload = null;
	try {
		let cursor: string | null = null;
		const rows: typeof data.images = [];
		const cursors = new Set<string>();
		// The server checks permission and selection on every bounded page.
		for (;;) {
			const result: FunctionReturnType<typeof api.galleries.getImagesPage> = await client.query(api.galleries.getImagesPage, { ...context, cursor, selection });
			if (disposed || current !== generation || request !== downloadGeneration || source !== data) return;
			rows.push(...displayPageImages(source, result.page, result.previewSources));
			if (result.isDone) break;
			if (cursors.has(result.continueCursor)) throw new Error("Cursor did not advance");
			cursors.add(result.continueCursor);
			cursor = result.continueCursor;
		}
		const unique = [...new Map(rows.map((image) => [image._id, image])).values()];
		if (downloads.chooseDownloadFolder && unique.length) readyDownload = { images: unique, name, message };
		else await downloads.downloadImages(unique, message, name);
	} catch {
		if (!disposed && current === generation && request === downloadGeneration && source === data) toasts.show("Couldn't prepare this download. Please try again.", { type: "error" });
	} finally { if (!disposed && current === generation && request === downloadGeneration && source === data) resolvingDownload = false; }
}
function cancelPreparation() { downloadGeneration++; resolvingDownload = false; readyDownload = null; }
function saveReadyDownload() {
	const ready = readyDownload;
	readyDownload = null;
	if (ready) return downloads.downloadImages(ready.images, ready.message, ready.name);
}
function downloadAll() { return downloadSelection({ kind: "all", excludedIds: [] }, "No files are available to download yet."); }
function downloadSelected() {
	return downloadSelection(collection.selection, "No files selected yet.");
}
function downloadFavorites() { return downloadSelection({ kind: "favorites" }, "No favorites selected yet.", `${data.gallery.name}-favorites`); }

let favoriteCount = $derived(
	images.filter((img) => img.isFavorite).length,
);
</script>

<div class="gallery-page">
	<header class="gallery-header">
		<h1>{data.gallery.name}</h1>
		<p class="gallery-meta">
			{data.gallery.imageCount} file{data.gallery.imageCount !== 1 ? "s" : ""}
			{#if data.client}
				<span class="separator">&middot;</span> for {data.client.name}
			{/if}
		</p>
		{#if data.gallery.downloadEnabled}
			<div class="download-bar">
				{#if resolvingDownload}<p role="status">Preparing file list...</p><button class="download-btn secondary" onclick={cancelPreparation}>Cancel preparation</button>{/if}
				{#if readyDownload}<button class="download-btn" onclick={saveReadyDownload}>Choose save location ({readyDownload.images.length} files)</button>{/if}
				<button class="download-btn" onclick={downloadAll} disabled={resolvingDownload || downloads.downloading}>
					{downloads.folderDownloadInProgress ? "saving..." : downloads.downloading ? "starting..." : "download all"}
				</button>
				<button
					class="download-btn secondary"
					onclick={downloadSelected}
					disabled={resolvingDownload || downloads.downloading || selectedCount === 0}
				>
					download selected ({selectedCount})
				</button>
				{#if data.gallery.favoritesEnabled && (data.imagePage || favoriteCount > 0)}
					<button class="download-btn secondary" onclick={downloadFavorites} disabled={resolvingDownload || downloads.downloading}>
						download favorites{!data.imagePage ? ` (${favoriteCount})` : ""}
					</button>
				{/if}
				<button
					class="download-btn tertiary"
					onclick={allImagesSelected ? clearSelection : selectAllImages}
					disabled={resolvingDownload || downloads.downloading || images.length === 0}
				>
					{allImagesSelected ? "clear selection" : "select all"}
				</button>
				<label class="folder-download-toggle" aria-disabled={!downloads.chosenLocationDownloadsSupported}>
					<input
						type="checkbox"
						bind:checked={downloads.chooseDownloadFolder}
						disabled={!downloads.chosenLocationDownloadsSupported || downloads.downloading}
					/>
					<span>choose location</span>
				</label>
				{#if downloads.folderDownloadInProgress}
					<button
						class="download-btn danger"
						type="button"
						onclick={downloads.cancelFolderDownload}
						disabled={downloads.canceling}
					>
						{downloads.canceling
							? "canceling..."
							: "cancel download"}
					</button>
				{/if}
			</div>
			{#if downloads.folderDownloadStatus}
				<p class="download-status" role="status">{downloads.folderDownloadStatus}</p>
			{:else if !downloads.chosenLocationDownloadsSupported}
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
		<div class="image-grid" bind:this={galleryItems}>
			{#each visibleImages as image, i (image._id)}
				<div class="grid-cell">
					<button class="image-btn" onclick={() => openLightbox(i)} aria-label={"View item " + (i + 1) + " of " + totalCount}>
						{#if image.isVideo}
							<span class="file-tile" aria-label={image.filename}><span>video</span></span>
						{:else if image.canPreview && !failedThumbnailIds.has(image._id)}
							<img
								src={image.thumbUrl}
								alt=""
								draggable="false"
								loading={i < 6 ? "eager" : "lazy"}
								decoding="async"
								onerror={() => failedThumbnailIds = markFailed(failedThumbnailIds, image._id)}
							/>
						{:else}
							<span class="file-tile" aria-label={image.filename}>
								<span>{image.canPreview ? "image unavailable" : image.fileLabel}</span>
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
							class:selected={collection.isSelected(image._id)}
							aria-label={"Select " + image.filename}
						>
							<input
								type="checkbox"
								checked={collection.isSelected(image._id)}
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
		<div class="image-list" bind:this={galleryItems}>
			{#each visibleImages as image, i (image._id)}
				<div class="list-row">
					<button class="list-thumb" type="button" onclick={() => openLightbox(i)} aria-label={"View " + image.filename}>
						{#if image.isVideo}
							<span class="file-tile" aria-label={image.filename}><span>video</span></span>
						{:else if image.canPreview && !failedThumbnailIds.has(image._id)}
							<img src={image.thumbUrl} alt="" draggable="false" loading="lazy" decoding="async" onerror={() => failedThumbnailIds = markFailed(failedThumbnailIds, image._id)} />
						{:else}
							<span class="file-tile" aria-label={image.filename}>
								<span>{image.canPreview ? "image unavailable" : image.fileLabel}</span>
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
									checked={collection.isSelected(image._id)}
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

{#if collection.visibleCount < images.length || collection.hasMore}
	<div class="gallery-pagination">
		<p aria-live="polite">Showing {visibleImages.length} of {totalCount}</p>
		<button type="button" onclick={showMore} disabled={collection.loading}>{collection.loading ? "Loading..." : "Show more"}</button>
	</div>
{/if}

{#if collection.error}<p role="alert">{collection.error}</p>{/if}
{#if lightboxOpen}
	<dialog
		class="lightbox"
		aria-label="Gallery lightbox"
		bind:this={lightboxEl}
		use:openModal
		oncancel={(event) => {
			event.preventDefault();
			closeLightbox();
		}}
		onclick={(e) => {
			// Backdrop click: only close when the target is the backdrop itself
			if (e.target === e.currentTarget) closeLightbox();
		}}
		onkeydown={handleKeydown}
	>
		<div class="lightbox-content">
			{#if images[lightboxIndex].isVideo}
				{#if !failedPreviewIds.has(images[lightboxIndex]._id)}
					<!-- svelte-ignore a11y_media_has_caption -->
					<video
						src={images[lightboxIndex].previewUrl}
						controls
						playsinline
						preload="metadata"
						aria-label={"Video preview: " + images[lightboxIndex].filename}
						onerror={() => void markPreviewFailed(images[lightboxIndex]._id)}
					></video>
				{:else}
					<div class="lightbox-file"><span>video unavailable</span></div>
				{/if}
			{:else if images[lightboxIndex].canPreview && !failedPreviewIds.has(images[lightboxIndex]._id)}
				<img src={images[lightboxIndex].previewUrl} alt={images[lightboxIndex].filename} draggable="false" onerror={() => void markPreviewFailed(images[lightboxIndex]._id)} />
			{:else}
				<div class="lightbox-file">
					<span>{images[lightboxIndex].canPreview ? "image unavailable" : images[lightboxIndex].fileLabel}</span>
				</div>
			{/if}
			<div class="lightbox-controls">
				<span class="lightbox-counter" aria-live="polite">{lightboxIndex + 1} / {totalCount}</span>
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
						<a class="lb-btn" aria-label="Download original file" href={images[lightboxIndex].downloadUrl} download>
							↓ download
						</a>
					{/if}
				</div>
			</div>
		</div>
		{#if lightboxIndex > 0}
			<button class="lb-nav lb-prev" aria-label="Previous image" onclick={(e) => { e.stopPropagation(); void moveLightbox(-1); }}>‹</button>
		{/if}
		{#if (collection.hasMore || lightboxIndex < images.length - 1)}
			<button class="lb-nav lb-next" aria-label="Next image" onclick={(e) => { e.stopPropagation(); void moveLightbox(1); }}>›</button>
		{/if}
		<button class="lb-close" aria-label="Close lightbox" onclick={closeLightbox}>✕</button>
	</dialog>
{/if}

<style>
	.gallery-pagination { text-align: center; padding: 1.5rem; }
	.gallery-pagination button { min-height: 44px; padding: 0.75rem 1.5rem; border: 1px solid currentColor; border-radius: 0.375rem; background: transparent; font: inherit; cursor: pointer; }
	.gallery-pagination button:focus-visible { outline: 2px solid currentColor; outline-offset: 3px; }

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

	.image-btn img,
	.list-thumb img,
	.lightbox-content > img {
		-webkit-touch-callout: none;
		-webkit-user-drag: none;
		user-select: none;
		pointer-events: none;
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
		width: 100%;
		height: 100%;
		max-width: none;
		max-height: none;
		margin: 0;
		border: 0;
		color: inherit;
		background: rgba(0, 0, 0, 0.92);
		align-items: center;
		justify-content: center;
		padding: 40px;
	}
	.lightbox[open] { display: flex; }
	.lightbox::backdrop { background: transparent; }

	.lightbox-content {
		max-width: 90vw;
		max-height: 85vh;
		display: flex;
		flex-direction: column;
		align-items: center;
	}

	.lightbox-content img,
	.lightbox-content video {
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
		flex-wrap: wrap;
		width: 100%;
		align-items: center;
		gap: 16px;
		margin-top: 12px;
		color: rgba(255, 255, 255, 0.7);
		font-size: 0.82rem;
	}

	.lightbox-counter { font-variant-numeric: tabular-nums; flex-shrink: 0; white-space: nowrap; }
	.lightbox-filename {
		opacity: 0.5;
		flex: 1 1 160px;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.lightbox-actions {
		display: flex;
		flex-shrink: 0;
		margin-left: auto;
		gap: 8px;
	}

	.lb-btn {
		white-space: nowrap;
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
