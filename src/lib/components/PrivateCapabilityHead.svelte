<script lang="ts">
let { title }: { title: string } = $props();
</script>

<svelte:head>
	<title>{title}</title>
	<meta name="robots" content="noindex, nofollow, noarchive" />
	<meta name="googlebot" content="noindex, nofollow, noarchive" />
	<meta name="referrer" content="no-referrer" />
</svelte:head>
