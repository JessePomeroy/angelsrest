<script lang="ts">
	import { onMount } from 'svelte';
	import { config } from '$lib/sanity/studio';

	let el: HTMLDivElement | undefined = $state(undefined);

	onMount(async () => {
		if (el) {
			const { renderStudio } = await import('sanity');
			renderStudio(el, config);
		}
	});
</script>

<svelte:head>
	<title>Studio | angelsrest</title>
</svelte:head>

<div bind:this={el} id="sanity-studio"></div>

<style>
	#sanity-studio {
		height: 100vh;
		width: 100vw;
		position: fixed;
		top: 0;
		left: 0;
		z-index: 100;
	}
</style>
