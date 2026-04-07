<script lang="ts">
import type { Snippet } from "svelte";

interface Props {
	title: string;
	actions?: Snippet;
}

let { title, actions }: Props = $props();
</script>

<header class="page-header">
	<div class="header-left">
		<h1>{title}</h1>
	</div>
	{#if actions}
		<div class="header-actions">
			{@render actions()}
		</div>
	{/if}
</header>

<style>
	.page-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 32px;
	}

	h1 {
		font-family: "Chillax", sans-serif;
		font-size: 1.4rem;
		font-weight: 500;
		color: var(--admin-heading);
		margin: 0;
	}

	.header-actions {
		display: flex;
		align-items: center;
		gap: 10px;
	}

	@media (max-width: 768px) {
		.page-header {
			flex-direction: column;
			align-items: flex-start;
			gap: 16px;
		}
	}
</style>
