<svelte:head>
	<title>and i still hear angels</title>
	<meta name="description" content="Photography portfolio and print shop" />
</svelte:head>

<section class="hero">
	<h1>and i still hear angels</h1>
	<p class="subtitle">photography &middot; prints &middot; art</p>
	<div class="cta">
		<a href="/gallery" class="btn">View Gallery</a>
		<a href="/shop" class="btn btn-outline">Shop Prints</a>
	</div>
</section>

<style>
	.hero {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		text-align: center;
		min-height: 70vh;
		gap: 1.5rem;
	}

	h1 {
		font-size: 3rem;
		font-weight: 200;
		letter-spacing: 0.05em;
		text-transform: lowercase;
	}

	.subtitle {
		color: var(--color-text-muted);
		font-size: 0.85rem;
		letter-spacing: 0.2em;
		text-transform: uppercase;
	}

	.cta {
		display: flex;
		gap: 1rem;
		margin-top: 1rem;
	}

	.btn {
		padding: 0.75rem 2rem;
		font-size: 0.8rem;
		letter-spacing: 0.15em;
		text-transform: uppercase;
		border: 1px solid var(--color-text);
		background: var(--color-text);
		color: var(--color-bg);
		transition: all var(--transition);
	}

	.btn:hover {
		opacity: 0.85;
	}

	.btn-outline {
		background: transparent;
		color: var(--color-text);
	}

	.btn-outline:hover {
		background: var(--color-text);
		color: var(--color-bg);
		opacity: 1;
	}

	@media (max-width: 480px) {
		h1 { font-size: 2rem; }
		.cta { flex-direction: column; }
	}
</style>
