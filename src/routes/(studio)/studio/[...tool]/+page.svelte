<script lang="ts">
	import { onMount } from 'svelte';
	import { config } from '$lib/sanity/studio';

	let Studio: any = $state(null);

	onMount(async () => {
		const mod = await import('sanity');
		Studio = mod.Studio;
	});
</script>

<svelte:head>
	<title>Studio | angelsrest</title>
</svelte:head>

{#if Studio}
	<div id="sanity-studio">
		<Studio {config} />
	</div>
{:else}
	<div class="loading">Loading studio…</div>
{/if}

<style>
	#sanity-studio {
		height: 100vh;
		width: 100vw;
		position: fixed;
		top: 0;
		left: 0;
		z-index: 100;
	}
	.loading {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 100vh;
		color: #999;
		font-family: system-ui;
	}
</style>
