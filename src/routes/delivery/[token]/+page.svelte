<script lang="ts">
import { setupConvex, useConvexClient } from "@mmailaender/convex-svelte";
import { PUBLIC_CONVEX_URL } from "$env/static/public";
import { api } from "$convex/api";

let { data } = $props();

setupConvex(PUBLIC_CONVEX_URL);
const client = useConvexClient();

// The server is the source of truth for images. We overlay optimistic
// favorite toggles via a per-image override map so that (a) navigations
// naturally flow through without clobbering user intent, and (b) the
// read path stays derived from props instead of stale-captured state.
let favoriteOverrides = $state(new Map<string, boolean>());
let images = $derived(
	data.images.map((img) => ({
		...img,
		isFavorite: favoriteOverrides.get(img._id) ?? img.isFavorite,
	})),
);
let lightboxIndex = $state(-1);
let lightboxOpen = $derived(lightboxIndex >= 0);
let downloading = $state(false);
let lightboxEl = $state<HTMLDivElement | null>(null);
let previouslyFocused: HTMLElement | null = null;

function openLightbox(index: number) {
	previouslyFocused = document.activeElement as HTMLElement;
	lightboxIndex = index;
	requestAnimationFrame(() => {
		lightboxEl?.querySelector<HTMLElement>('.lb-close')?.focus();
	});
}

function closeLightbox() {
	lightboxIndex = -1;
	previouslyFocused?.focus();
}

function handleKeydown(e: KeyboardEvent) {
	if (!lightboxOpen) return;
	if (e.key === "Escape") closeLightbox();
	if (e.key === "ArrowRight" && lightboxIndex < images.length - 1) lightboxIndex++;
	if (e.key === "ArrowLeft" && lightboxIndex > 0) lightboxIndex--;
	if (e.key === "Tab" && lightboxEl) {
		const focusable = lightboxEl.querySelectorAll<HTMLElement>(
			'a[href], button:not([disabled])'
		);
		if (focusable.length === 0) return;
		const first = focusable[0];
		const last = focusable[focusable.length - 1];
		if (e.shiftKey && document.activeElement === first) {
			e.preventDefault();
			last.focus();
		} else if (!e.shiftKey && document.activeElement === last) {
			e.preventDefault();
			first.focus();
		}
	}
}

async function toggleFavorite(index: number) {
	if (!data.gallery.favoritesEnabled) return;
	const image = images[index];
	const newVal = !image.isFavorite;

	// Optimistic override — derived images will pick this up on next read
	const next = new Map(favoriteOverrides);
	next.set(image._id, newVal);
	favoriteOverrides = next;

	await client.mutation(api.galleries.updateImage, {
		id: image._id as any,
		isFavorite: newVal,
	});
}

async function downloadAll() {
	downloading = true;
	try {
		const keys = images.map((img: any) => img.r2Key);
		const res = await fetch(`${data.workerUrl}/download/zip`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				token: data.token,
				imageKeys: keys,
				galleryName: data.gallery.name,
			}),
		});
		if (!res.ok) throw new Error("Download failed");

		const blob = await res.blob();
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = `${data.gallery.name.replace(/[^a-zA-Z0-9._-]/g, "_")}.zip`;
		a.click();
		URL.revokeObjectURL(url);
	} catch {
		alert("Download failed. Please try again.");
	} finally {
		downloading = false;
	}
}

async function downloadFavorites() {
	const favKeys = images.filter((img: any) => img.isFavorite).map((img: any) => img.r2Key);
	if (favKeys.length === 0) {
		alert("No favorites selected yet.");
		return;
	}
	downloading = true;
	try {
		const res = await fetch(`${data.workerUrl}/download/zip`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				token: data.token,
				imageKeys: favKeys,
				galleryName: `${data.gallery.name}-favorites`,
			}),
		});
		if (!res.ok) throw new Error("Download failed");

		const blob = await res.blob();
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = `${data.gallery.name.replace(/[^a-zA-Z0-9._-]/g, "_")}-favorites.zip`;
		a.click();
		URL.revokeObjectURL(url);
	} catch {
		alert("Download failed. Please try again.");
	} finally {
		downloading = false;
	}
}

let favoriteCount = $derived(images.filter((img: any) => img.isFavorite).length);
</script>

<svelte:head>
	<title>{data.gallery.name} | Gallery</title>
</svelte:head>

<svelte:window onkeydown={handleKeydown} />

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
					{downloading ? "preparing..." : "download all"}
				</button>
				{#if data.gallery.favoritesEnabled && favoriteCount > 0}
					<button class="download-btn secondary" onclick={downloadFavorites} disabled={downloading}>
						download favorites ({favoriteCount})
					</button>
				{/if}
			</div>
		{/if}
	</header>

	<div class="image-grid">
		{#each images as image, i (image._id)}
			<div class="grid-cell">
				<button class="image-btn" onclick={() => openLightbox(i)} aria-label={"View photo " + (i + 1) + " of " + images.length}>
					<img src={image.thumbUrl} alt={"Photo " + (i + 1) + ": " + image.filename} loading="lazy" />
				</button>
				{#if data.gallery.favoritesEnabled}
					<button
						class="fav-btn"
						class:is-fav={image.isFavorite}
						onclick={() => toggleFavorite(i)}
						aria-label={image.isFavorite ? "Remove from favorites" : "Add to favorites"}
					>
						{image.isFavorite ? "♥" : "♡"}
					</button>
				{/if}
			</div>
		{/each}
	</div>
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
			<img src={images[lightboxIndex].previewUrl} alt={images[lightboxIndex].filename} />
			<div class="lightbox-controls">
				<span class="lightbox-counter" aria-live="polite">{lightboxIndex + 1} / {images.length}</span>
				<span class="lightbox-filename">{images[lightboxIndex].filename}</span>
				<div class="lightbox-actions">
					{#if data.gallery.favoritesEnabled}
						<button
							class="lb-btn" aria-label={images[lightboxIndex].isFavorite ? "Remove from favorites" : "Add to favorites"}
							class:is-fav={images[lightboxIndex].isFavorite}
							onclick={() => toggleFavorite(lightboxIndex)}
						>
							{images[lightboxIndex].isFavorite ? "♥ favorited" : "♡ favorite"}
						</button>
					{/if}
					{#if data.gallery.downloadEnabled}
						<a class="lb-btn" aria-label={images[lightboxIndex].isFavorite ? "Remove from favorites" : "Add to favorites"} href={images[lightboxIndex].downloadUrl} download>
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

<style>
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

	.image-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
		gap: 8px;
	}

	.grid-cell {
		position: relative;
		aspect-ratio: 1;
		overflow: hidden;
		border-radius: 4px;
	}

	.image-btn {
		display: block;
		width: 100%;
		height: 100%;
		padding: 0;
		border: none;
		background: none;
		cursor: pointer;
	}

	.image-btn img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		transition: transform 0.2s;
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
	}
</style>
