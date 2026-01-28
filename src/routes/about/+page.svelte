<script lang="ts">
	// TODO: Fetch about data from Sanity
	// const query = `*[_type == "about"][0]`;
</script>

<svelte:head>
	<title>About | and i still hear angels</title>
</svelte:head>

<section>
	<div class="content">
		<div class="portrait-placeholder"></div>
		<div class="bio">
			<h1>About</h1>
			<p>
				Connect Sanity CMS to populate artist bio, portrait, and social links.
			</p>
			<p class="muted">
				This page will display the artist's story, background, and creative philosophy.
			</p>
		</div>
	</div>
</section>

<style>
	section {
		padding: 2rem 0;
	}

	.content {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 4rem;
		align-items: start;
		max-width: 1000px;
	}

	.portrait-placeholder {
		aspect-ratio: 3 / 4;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
	}

	.bio {
		padding-top: 2rem;
	}

	h1 {
		margin-bottom: 1.5rem;
	}

	p {
		line-height: 1.8;
		margin-bottom: 1rem;
	}

	.muted {
		color: var(--color-text-muted);
	}

	@media (max-width: 768px) {
		.content {
			grid-template-columns: 1fr;
			gap: 2rem;
		}
	}
</style>
