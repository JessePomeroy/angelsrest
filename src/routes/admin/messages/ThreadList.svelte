<script lang="ts">
interface ThreadClient {
	_id: string;
	name: string;
	siteUrl: string;
}

interface ThreadMessage {
	_id: string;
	siteUrl: string;
	sender: "client" | "creator";
	content: string;
	read: boolean;
	_creationTime: number;
}

interface Thread {
	client: ThreadClient;
	unreadCount: number;
	latestMessage: ThreadMessage | null;
}

interface Props {
	threads: Thread[];
	selectedClientId: string | null;
	mobileHidden: boolean;
	onselect: (thread: Thread) => void;
}

let { threads, selectedClientId, mobileHidden, onselect }: Props = $props();

function formatTime(timestamp: number): string {
	const date = new Date(timestamp);
	const now = new Date();
	const diff = now.getTime() - date.getTime();
	const oneDay = 86400000;

	if (diff < oneDay && date.getDate() === now.getDate()) {
		return date.toLocaleTimeString("en-US", {
			hour: "numeric",
			minute: "2-digit",
		});
	}
	if (diff < oneDay * 7) {
		return date.toLocaleDateString("en-US", { weekday: "short" });
	}
	return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function truncate(text: string, max: number): string {
	if (text.length <= max) return text;
	return `${text.slice(0, max)}...`;
}
</script>

<div class="thread-list" class:mobile-hidden={mobileHidden}>
	{#each threads as thread (thread.client._id)}
		<button
			class="thread-item"
			class:active={selectedClientId === thread.client._id}
			onclick={() => onselect(thread)}
		>
			<div class="thread-info">
				<div class="thread-top">
					<span class="thread-name">{thread.client.name}</span>
					{#if thread.latestMessage}
						<span class="thread-time">{formatTime(thread.latestMessage._creationTime)}</span>
					{/if}
				</div>
				<div class="thread-bottom">
					<span class="thread-url">{thread.client.siteUrl}</span>
					{#if thread.unreadCount > 0}
						<span class="unread-badge">{thread.unreadCount}</span>
					{/if}
				</div>
				{#if thread.latestMessage}
					<p class="thread-preview">{truncate(thread.latestMessage.content, 60)}</p>
				{/if}
			</div>
		</button>
	{/each}
</div>

<style>
	.thread-list {
		width: 320px;
		flex-shrink: 0;
		border-right: 1px solid var(--admin-border);
		overflow-y: auto;
		padding-right: 0;
	}

	.thread-item {
		display: block;
		width: 100%;
		text-align: left;
		padding: 14px 16px;
		background: none;
		border: none;
		border-bottom: 1px solid var(--admin-border);
		cursor: pointer;
		transition: background 0.12s;
		font-family: "Synonym", system-ui, sans-serif;
		text-transform: lowercase;
		color: var(--admin-text);
	}

	.thread-item:hover {
		background: var(--admin-active);
	}

	.thread-item.active {
		background: var(--admin-active);
	}

	.thread-info {
		display: flex;
		flex-direction: column;
		gap: 3px;
	}

	.thread-top {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
	}

	.thread-name {
		font-weight: 500;
		color: var(--admin-heading);
		font-size: 0.88rem;
	}

	.thread-time {
		font-size: 0.72rem;
		color: var(--admin-text-subtle);
	}

	.thread-bottom {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}

	.thread-url {
		font-size: 0.75rem;
		color: var(--admin-text-muted);
	}

	.unread-badge {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 18px;
		height: 18px;
		padding: 0 5px;
		border-radius: 9px;
		background: var(--admin-accent);
		color: #fff;
		font-size: 0.68rem;
		font-weight: 600;
	}

	.thread-preview {
		font-size: 0.8rem;
		color: var(--admin-text-muted);
		margin: 2px 0 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	@media (max-width: 768px) {
		.thread-list {
			width: 100%;
			border-right: none;
		}

		.mobile-hidden {
			display: none;
		}
	}
</style>
