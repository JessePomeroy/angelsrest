<script lang="ts">
/**
 * Renders the toast stack from the global store (audit M16).
 * Mounted once at the top-level layout so every route has access.
 */
import { toasts } from "$lib/stores/toast.svelte";
</script>

{#if toasts.items.length > 0}
	<div
		class="toaster-stack"
		role="region"
		aria-live="polite"
		aria-label="Notifications"
	>
		{#each toasts.items as toast (toast.id)}
			<div class="toast toast-{toast.type}" role="status">
				<span class="toast-message">{toast.message}</span>
				<button
					type="button"
					class="toast-dismiss"
					aria-label="Dismiss notification"
					onclick={() => toasts.dismiss(toast.id)}
				>
					×
				</button>
			</div>
		{/each}
	</div>
{/if}

<style>
	.toaster-stack {
		position: fixed;
		bottom: 1.5rem;
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		z-index: 9999;
		pointer-events: none;
		max-width: min(520px, calc(100vw - 2rem));
		width: 100%;
	}

	.toast {
		pointer-events: auto;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 0.75rem 1rem;
		border-radius: 0.5rem;
		font-size: 0.9rem;
		line-height: 1.35;
		background: var(--color-surface-900, #111);
		color: var(--color-surface-50, #fafafa);
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
		animation: toast-in 0.18s ease-out;
	}

	.toast-error {
		background: var(--color-error-700, #991b1b);
	}

	.toast-success {
		background: var(--color-success-700, #14532d);
	}

	.toast-message {
		flex: 1;
	}

	.toast-dismiss {
		all: unset;
		cursor: pointer;
		padding: 0 0.25rem;
		font-size: 1.1rem;
		line-height: 1;
		opacity: 0.7;
	}
	.toast-dismiss:hover {
		opacity: 1;
	}

	@keyframes toast-in {
		from {
			opacity: 0;
			transform: translateY(8px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}
</style>
