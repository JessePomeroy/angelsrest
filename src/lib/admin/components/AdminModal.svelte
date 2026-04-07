<script lang="ts">
import type { Snippet } from "svelte";

interface Props {
	title: string;
	onclose: () => void;
	size?: "default" | "wide" | "narrow";
	children: Snippet;
}

let { title, onclose, size = "default", children }: Props = $props();

function handleKeydown(e: KeyboardEvent) {
	if (e.key === "Escape") onclose();
}
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div class="modal-overlay" role="dialog" tabindex="-1" aria-modal="true" aria-label={title} onclick={onclose} onkeydown={handleKeydown}>
	<div
		class="modal-content"
		class:modal-content-wide={size === "wide"}
		class:modal-content-narrow={size === "narrow"}
		role="presentation"
		onclick={(e) => e.stopPropagation()}
		onkeydown={(e) => e.stopPropagation()}
	>
		<div class="modal-header">
			<h2 class="modal-title">{title}</h2>
			<button class="modal-close" aria-label="Close" onclick={onclose}>
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
				</svg>
			</button>
		</div>

		{@render children()}
	</div>
</div>

<style>
	.modal-overlay {
		position: fixed;
		inset: 0;
		z-index: 100;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(0, 0, 0, 0.4);
		backdrop-filter: blur(8px);
		padding: 1rem;
	}

	.modal-content {
		background: var(--admin-bg, #1e293b);
		border: 1px solid var(--admin-border);
		border-radius: 12px;
		width: 100%;
		max-width: 540px;
		max-height: 90vh;
		overflow-y: auto;
		box-shadow: 0 24px 80px rgba(0, 0, 0, 0.5);
	}

	.modal-content-wide {
		max-width: 600px;
	}

	.modal-content-narrow {
		max-width: 420px;
	}

	.modal-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 24px 28px 20px;
	}

	.modal-title {
		font-family: "Chillax", sans-serif;
		font-size: 1.1rem;
		font-weight: 500;
		color: var(--admin-heading);
		margin: 0;
	}

	.modal-close {
		background: none;
		border: none;
		color: var(--admin-text-muted);
		cursor: pointer;
		padding: 4px;
		border-radius: 4px;
		transition: color 0.15s;
	}

	.modal-close:hover {
		color: var(--admin-heading);
	}

	@media (max-width: 768px) {
		.modal-overlay {
			align-items: flex-end;
			padding: 0;
		}

		.modal-content {
			max-width: 100%;
			max-height: 85vh;
			border-radius: 12px 12px 0 0;
		}
	}
</style>
