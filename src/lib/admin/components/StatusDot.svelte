<script lang="ts">
interface Props {
	color: string;
	label?: string;
}

let { color, label }: Props = $props();
</script>

<span class="status-indicator">
	<span class="status-dot" style="background: {color}"></span>
	{#if label}<span class="status-label">{label}</span>{/if}
</span>

<style>
	.status-indicator {
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}

	.status-dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		flex-shrink: 0;
	}

	.status-label {
		font-size: 0.82rem;
		color: var(--admin-text);
	}
</style>
