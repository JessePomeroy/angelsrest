<script lang="ts">
	interface Props {
		lines?: number;
	}

	let { lines = 5 }: Props = $props();
</script>

<div class="loading-state">
	{#each Array(lines) as _, i}
		<div class="loading-line" style="width: {70 + Math.random() * 30}%; animation-delay: {i * 0.1}s"></div>
	{/each}
</div>

<style>
	.loading-state {
		display: flex;
		flex-direction: column;
		gap: 14px;
		padding: 48px 40px;
	}

	.loading-line {
		height: 14px;
		background: var(--admin-surface, rgba(255, 255, 255, 0.03));
		border-radius: 4px;
		animation: pulse 1.5s ease-in-out infinite;
	}

	@keyframes pulse {
		0%, 100% { opacity: 0.3; }
		50% { opacity: 0.6; }
	}
</style>
