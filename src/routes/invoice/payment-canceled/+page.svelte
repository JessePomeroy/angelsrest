<script lang="ts">
function goBack() {
	history.back();
}
</script>

<svelte:head>
	<title>payment canceled</title>
</svelte:head>

<div class="container">
	<div class="content">
		<h1>payment canceled</h1>
		<p>your invoice payment was not completed. no charges have been made.</p>
		<button onclick={goBack} type="button">try again</button>
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
</style>
