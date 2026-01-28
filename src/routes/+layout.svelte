<script lang="ts">
	import type { Snippet } from 'svelte';
	import Nav from '$lib/components/Nav.svelte';
	import Footer from '$lib/components/Footer.svelte';
	import '$lib/styles/global.css';

	let { children }: { children: Snippet } = $props();
</script>

<div class="app">
	<Nav />
	<main>
		{@render children()}
	</main>
	<Footer />
</div>

<style>
	.app {
		display: flex;
		flex-direction: column;
		min-height: 100vh;
	}

	main {
		flex: 1;
		max-width: var(--max-width);
		margin: 0 auto;
		width: 100%;
		padding: 2rem;
	}
</style>
