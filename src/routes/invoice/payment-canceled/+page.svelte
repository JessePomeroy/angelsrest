<script lang="ts">
function goBack() {
	history.back();
}
</script>

<svelte:head>
	<title>payment canceled</title>
</svelte:head>

<div class="payment-page">
	<div class="content">
		<h1>payment canceled</h1>
		<p>your invoice payment was not completed. no charges have been made.</p>
		<button onclick={goBack} type="button">try again</button>
	</div>
</div>

<style>
	.payment-page {
		width: 100%;
		min-height: 100vh;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 2rem;
		background: #fafafa;
		font-family: system-ui, -apple-system, sans-serif;
	}

	.content {
		max-width: 480px;
		text-align: center;
	}

	h1 {
		font-size: 1.5rem;
		font-weight: 500;
		color: #1a1a1a;
		margin-bottom: 1rem;
	}

	p {
		color: #333;
		line-height: 1.6;
		margin-bottom: 1.5rem;
	}

	button {
		padding: 0.625rem 1.5rem;
		background: #1a1a1a;
		color: #fff;
		border: none;
		border-radius: 4px;
		font-size: 0.875rem;
		cursor: pointer;
		transition: background 0.15s;
	}

	button:hover {
		background: #333;
	}
	@media (min-width: 40rem) { .payment-page { max-width: 40rem; } }
	@media (min-width: 48rem) { .payment-page { max-width: 48rem; } }
	@media (min-width: 64rem) { .payment-page { max-width: 64rem; } }
	@media (min-width: 80rem) { .payment-page { max-width: 80rem; } }
	@media (min-width: 96rem) { .payment-page { max-width: 96rem; } }
</style>
