<script lang="ts">
let { data } = $props();

const galleries = $derived(data.galleries);

const studioBaseUrl = "https://angelsrest.sanity.studio";
</script>

<div class="galleries-page">
	<header class="page-header">
		<h1>galleries</h1>
	</header>

	{#if galleries.length === 0}
		<div class="empty-state">no galleries found</div>
	{:else}
		<div class="gallery-list">
			{#each galleries as gallery (gallery._id)}
				<div class="gallery-row">
					<div class="gallery-info">
						<span class="gallery-title">{gallery.title}</span>
						<span class="gallery-slug">/{gallery.slug}</span>
					</div>

					<div class="gallery-meta">
						<span class="meta-count">
							{gallery.imageCount || 0} image{(gallery.imageCount || 0) !== 1 ? "s" : ""}
						</span>

						{#if gallery.isVisible !== false}
							<span class="visibility-indicator visible">
								<span class="vis-dot"></span>
								visible
							</span>
						{:else}
							<span class="visibility-indicator hidden">
								<span class="vis-dot"></span>
								hidden
							</span>
						{/if}

						{#if gallery.featured}
							<span class="featured-indicator">featured</span>
						{/if}
					</div>

					<div class="gallery-actions">
						<a href="/gallery/{gallery.slug}" class="action-link" target="_blank" rel="noopener">
							view
						</a>
						<a
							href="{studioBaseUrl}/structure/gallery;{gallery._id}"
							class="action-link"
							target="_blank"
							rel="noopener"
						>
							edit in studio
						</a>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	.galleries-page {
		padding: 48px 40px;
		max-width: 1000px;
	}

	.page-header {
		margin-bottom: 32px;
	}

	.page-header h1 {
		font-family: "Chillax", sans-serif;
		font-size: 1.8rem;
		font-weight: 500;
		color: var(--admin-heading);
		margin: 0;
		letter-spacing: -0.01em;
	}

	.gallery-list {
		display: flex;
		flex-direction: column;
	}

	.gallery-row {
		display: flex;
		align-items: center;
		gap: 24px;
		padding: 18px 0;
		border-bottom: 1px solid var(--admin-border);
		transition: background 0.12s;
	}

	.gallery-row:first-child {
		border-top: 1px solid var(--admin-border);
	}

	.gallery-info {
		flex: 1;
		display: flex;
		align-items: baseline;
		gap: 10px;
		min-width: 0;
	}

	.gallery-title {
		font-size: 0.95rem;
		font-weight: 500;
		color: var(--admin-heading);
	}

	.gallery-slug {
		font-size: 0.76rem;
		color: var(--admin-text-subtle);
		font-family: monospace;
	}

	.gallery-meta {
		display: flex;
		align-items: center;
		gap: 16px;
		flex-shrink: 0;
	}

	.meta-count {
		font-size: 0.8rem;
		color: var(--admin-text-muted);
	}

	.visibility-indicator {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		font-size: 0.78rem;
		color: var(--admin-text-muted);
	}

	.vis-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
	}

	.visibility-indicator.visible .vis-dot {
		background: var(--status-sage);
	}

	.visibility-indicator.hidden .vis-dot {
		background: var(--admin-text-subtle);
	}

	.featured-indicator {
		font-size: 0.76rem;
		color: var(--status-amber);
	}

	.gallery-actions {
		display: flex;
		gap: 8px;
		flex-shrink: 0;
	}

	.action-link {
		padding: 4px 12px;
		border: 1px solid var(--admin-border-strong);
		border-radius: 5px;
		color: var(--admin-text-muted);
		text-decoration: none;
		font-size: 0.76rem;
		font-family: "Synonym", system-ui, sans-serif;
		transition: color 0.15s, border-color 0.15s;
	}

	.action-link:hover {
		color: var(--admin-accent-hover);
		border-color: var(--admin-accent);
	}

	.empty-state {
		padding: 48px 0;
		color: var(--admin-text-subtle);
		font-size: 0.88rem;
	}

	@media (max-width: 768px) {
		.galleries-page {
			padding: 28px 20px;
		}

		.gallery-row {
			flex-direction: column;
			align-items: flex-start;
			gap: 10px;
		}

		.gallery-meta {
			flex-wrap: wrap;
			gap: 12px;
		}
	}
</style>
