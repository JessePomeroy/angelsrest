<script lang="ts">
let { data } = $props();

const galleries = data.galleries;

const studioBaseUrl = "https://angelsrest.sanity.studio";
</script>

<div class="galleries-page">
	<header class="page-header">
		<h1>Galleries</h1>
		<p class="subtitle">Manage your photo galleries</p>
	</header>

	{#if galleries.length === 0}
		<div class="empty-state">No galleries found</div>
	{:else}
		<div class="gallery-grid">
			{#each galleries as gallery (gallery._id)}
				<div class="gallery-card">
					<div class="gallery-info">
						<h2 class="gallery-title">{gallery.title}</h2>
						<span class="gallery-slug">/{gallery.slug}</span>
					</div>

					<div class="gallery-meta">
						<span class="meta-item">
							{gallery.imageCount || 0} image{(gallery.imageCount || 0) !== 1 ? "s" : ""}
						</span>

						<div class="badges">
							{#if gallery.isVisible !== false}
								<span class="badge visible">Visible</span>
							{:else}
								<span class="badge hidden">Hidden</span>
							{/if}
							{#if gallery.featured}
								<span class="badge featured">Featured</span>
							{/if}
						</div>
					</div>

					<div class="gallery-actions">
						<a href="/galleries/{gallery.slug}" class="action-link" target="_blank" rel="noopener">
							View on site
						</a>
						<a
							href="{studioBaseUrl}/structure/gallery;{gallery._id}"
							class="action-link"
							target="_blank"
							rel="noopener"
						>
							Edit in Studio
						</a>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	.galleries-page {
		padding: 32px;
		max-width: 1100px;
	}

	.page-header {
		margin-bottom: 24px;
	}

	.page-header h1 {
		font-size: 1.6rem;
		font-weight: 600;
		color: var(--admin-heading);
		margin: 0 0 4px;
	}

	.subtitle {
		color: var(--admin-text-muted);
		font-size: 0.9rem;
		margin: 0;
	}

	.gallery-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
		gap: 16px;
	}

	.gallery-card {
		background: var(--admin-surface);
		border: 1px solid var(--admin-border);
		border-radius: 8px;
		padding: 20px;
		display: flex;
		flex-direction: column;
		gap: 14px;
	}

	.gallery-info {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.gallery-title {
		font-size: 1.05rem;
		font-weight: 600;
		color: var(--admin-heading);
		margin: 0;
	}

	.gallery-slug {
		font-size: 0.78rem;
		color: var(--admin-text-subtle);
		font-family: monospace;
	}

	.gallery-meta {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
	}

	.meta-item {
		font-size: 0.82rem;
		color: var(--admin-text-muted);
	}

	.badges {
		display: flex;
		gap: 6px;
	}

	.badge {
		display: inline-block;
		padding: 2px 10px;
		border-radius: 12px;
		font-size: 0.72rem;
		font-weight: 500;
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}

	.badge.visible {
		background: var(--status-sage);
		color: #fff;
	}

	.badge.hidden {
		background: var(--status-slate);
		color: #fff;
	}

	.badge.featured {
		background: var(--status-amber);
		color: #fff;
	}

	.gallery-actions {
		display: flex;
		gap: 10px;
		padding-top: 4px;
		border-top: 1px solid var(--admin-border);
	}

	.action-link {
		padding: 6px 14px;
		border: 1px solid var(--admin-border-strong);
		border-radius: 5px;
		color: var(--admin-text-muted);
		text-decoration: none;
		font-size: 0.78rem;
		transition: color 0.15s, border-color 0.15s;
	}

	.action-link:hover {
		color: var(--admin-accent-hover);
		border-color: var(--admin-accent);
	}

	.empty-state {
		text-align: center;
		padding: 48px;
		color: var(--admin-text-subtle);
		background: var(--admin-surface);
		border: 1px solid var(--admin-border);
		border-radius: 8px;
	}

	@media (max-width: 768px) {
		.galleries-page {
			padding: 20px 16px;
		}

		.gallery-grid {
			grid-template-columns: 1fr;
		}
	}
</style>
