<script lang="ts">
	import { page } from '$app/state';
	// TODO: Fetch single gallery item from Sanity
	// const query = `*[_type == "gallery" && slug.current == $slug][0]`;
</script>

<svelte:head>
	<title>Gallery | and i still hear angels</title>
</svelte:head>

<section>
	<a href="/gallery" class="back">&larr; Back to Gallery</a>

	<div class="detail">
		<div class="image-placeholder"></div>
		<div class="info">
			<h1>{page.params.slug}</h1>
			<p class="meta">Category &middot; 2024</p>
			<p class="description">
				Connect Sanity CMS to display image details, descriptions, and metadata.
			</p>
		</div>
	</div>
</section>

<style>
	section {
		padding: 2rem 0;
	}

	.back {
		display: inline-block;
		font-size: 0.85rem;
		color: var(--color-text-muted);
		margin-bottom: 2rem;
	}

	.detail {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 3rem;
		align-items: start;
	}

	.image-placeholder {
		aspect-ratio: 3 / 4;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
	}

	h1 {
		text-transform: capitalize;
		margin-bottom: 0.5rem;
	}

	.meta {
		color: var(--color-text-muted);
		font-size: 0.85rem;
		margin-bottom: 1.5rem;
	}

	.description {
		color: var(--color-text-muted);
		line-height: 1.7;
	}

	@media (max-width: 768px) {
		.detail {
			grid-template-columns: 1fr;
		}
	}
</style>
