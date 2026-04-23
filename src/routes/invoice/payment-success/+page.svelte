<script lang="ts">
</script>

<svelte:head>
	<title>payment received</title>
</svelte:head>

<div class="container">
	<div class="content">
		<h1>payment received</h1>
		<p>thank you — your invoice payment has been processed successfully.</p>
		<p class="muted">you will receive a confirmation email shortly.</p>
	</div>
</div>

<style>
	.container {
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
		margin-bottom: 0.75rem;
	}

	.muted {
		color: #888;
		font-size: 0.875rem;
	}
</style>
