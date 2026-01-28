<script lang="ts">
	import { page } from '$app/state';
	// TODO: Fetch product from Sanity + set up Stripe checkout
	// import { loadStripe } from '@stripe/stripe-js';
</script>

<svelte:head>
	<title>Shop | and i still hear angels</title>
</svelte:head>

<section>
	<a href="/shop" class="back">&larr; Back to Shop</a>

	<div class="detail">
		<div class="images">
			<div class="image-placeholder"></div>
		</div>
		<div class="info">
			<h1>{page.params.slug}</h1>
			<p class="price">$25.00</p>
			<p class="description">
				Connect Sanity CMS and Stripe to enable product details and checkout.
			</p>
			<button class="buy-btn" disabled>Add to Cart</button>
			<p class="note">Stripe checkout will be configured here.</p>
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
		aspect-ratio: 1;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
	}

	h1 {
		text-transform: capitalize;
		margin-bottom: 0.5rem;
	}

	.price {
		font-size: 1.25rem;
		margin-bottom: 1.5rem;
		color: var(--color-accent);
	}

	.description {
		color: var(--color-text-muted);
		line-height: 1.7;
		margin-bottom: 2rem;
	}

	.buy-btn {
		width: 100%;
		padding: 1rem;
		font-size: 0.8rem;
		letter-spacing: 0.15em;
		text-transform: uppercase;
		border: 1px solid var(--color-text);
		background: var(--color-text);
		color: var(--color-bg);
		transition: all var(--transition);
	}

	.buy-btn:hover:not(:disabled) {
		opacity: 0.85;
	}

	.buy-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.note {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		margin-top: 0.75rem;
		text-align: center;
	}

	@media (max-width: 768px) {
		.detail {
			grid-template-columns: 1fr;
		}
	}
</style>
