<script lang="ts">
interface ThreadClient {
	_id: string;
	name: string;
	siteUrl: string;
}

interface Message {
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
	latestMessage: Message | null;
}

interface Props {
	thread: Thread | null;
	messages: Message[];
	loading: boolean;
	sending: boolean;
	mobileHidden: boolean;
	oninput: (value: string) => void;
	onsend: () => void;
	onback: () => void;
	inputValue: string;
}

let {
	thread,
	messages,
	loading,
	sending,
	mobileHidden,
	oninput,
	onsend,
	onback,
	inputValue,
}: Props = $props();

function formatMessageTime(timestamp: number): string {
	return new Date(timestamp).toLocaleTimeString("en-US", {
		hour: "numeric",
		minute: "2-digit",
	});
}

function handleKeydown(e: KeyboardEvent) {
	if (e.key === "Enter" && !e.shiftKey) {
		e.preventDefault();
		onsend();
	}
}
</script>

<div class="conversation" class:mobile-hidden={mobileHidden}>
	{#if thread}
		<div class="convo-header">
			<button class="back-btn" onclick={onback} aria-label="Back to threads">
				<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
			</button>
			<div class="convo-header-info">
				<span class="convo-name">{thread.client.name}</span>
				<span class="convo-url">{thread.client.siteUrl}</span>
			</div>
		</div>

		<div class="convo-messages">
			{#if loading}
				<div class="loading-messages">loading...</div>
			{:else if messages.length === 0}
				<div class="no-messages">no messages yet — start the conversation</div>
			{:else}
				{#each messages as msg (msg._id)}
					<div class="message" class:message-creator={msg.sender === "creator"} class:message-client={msg.sender === "client"}>
						<div class="message-bubble" class:bubble-creator={msg.sender === "creator"} class:bubble-client={msg.sender === "client"}>
							<p class="message-content">{msg.content}</p>
							<span class="message-time">{formatMessageTime(msg._creationTime)}</span>
						</div>
					</div>
				{/each}
			{/if}
		</div>

		<div class="convo-input">
			<input
				type="text"
				class="message-field"
				placeholder="type a message..."
				value={inputValue}
				oninput={(e) => oninput(e.currentTarget.value)}
				onkeydown={handleKeydown}
				disabled={sending}
			/>
			<button class="send-btn" onclick={onsend} disabled={sending || !inputValue.trim()} aria-label="Send message">
				<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
			</button>
		</div>
	{:else}
		<div class="no-thread-selected">
			<p>select a conversation to start messaging</p>
		</div>
	{/if}
</div>

<style>
	.conversation {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-height: 0;
	}

	.convo-header {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 16px 20px;
		border-bottom: 1px solid var(--admin-border);
		flex-shrink: 0;
	}

	.back-btn {
		display: none;
		background: none;
		border: none;
		color: var(--admin-text-muted);
		cursor: pointer;
		padding: 4px;
		border-radius: 4px;
		transition: color 0.15s;
	}

	.back-btn:hover {
		color: var(--admin-heading);
	}

	.convo-header-info {
		display: flex;
		flex-direction: column;
		gap: 1px;
	}

	.convo-name {
		font-family: "Chillax", sans-serif;
		font-weight: 500;
		font-size: 0.95rem;
		color: var(--admin-heading);
	}

	.convo-url {
		font-size: 0.75rem;
		color: var(--admin-text-muted);
	}

	.convo-messages {
		flex: 1;
		overflow-y: auto;
		padding: 20px;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.loading-messages,
	.no-messages {
		color: var(--admin-text-subtle);
		font-size: 0.85rem;
		padding: 32px 0;
		text-align: center;
	}

	.no-thread-selected {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--admin-text-subtle);
		font-size: 0.88rem;
	}

	.no-thread-selected p {
		margin: 0;
	}

	.message {
		display: flex;
	}

	.message-creator {
		justify-content: flex-end;
	}

	.message-client {
		justify-content: flex-start;
	}

	.message-bubble {
		max-width: 70%;
		padding: 10px 14px;
		border-radius: 12px;
	}

	.bubble-creator {
		background: rgba(129, 140, 248, 0.12);
		border-bottom-right-radius: 4px;
	}

	.bubble-client {
		background: var(--admin-surface-raised);
		border-bottom-left-radius: 4px;
	}

	.message-content {
		margin: 0;
		font-size: 0.85rem;
		color: var(--admin-heading);
		line-height: 1.45;
		white-space: pre-wrap;
		word-break: break-word;
	}

	.message-time {
		display: block;
		font-size: 0.68rem;
		color: var(--admin-text-subtle);
		margin-top: 4px;
	}

	.bubble-creator .message-time {
		text-align: right;
	}

	.convo-input {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 12px 20px;
		border-top: 1px solid var(--admin-border);
		flex-shrink: 0;
	}

	.message-field {
		flex: 1;
		padding: 10px 14px;
		background: rgba(255, 255, 255, 0.03);
		color: var(--admin-text);
		border: 1px solid var(--admin-border-strong);
		border-radius: 8px;
		font-size: 0.85rem;
		font-family: "Synonym", system-ui, sans-serif;
		text-transform: lowercase;
		outline: none;
		transition: border-color 0.15s;
	}

	.message-field:focus {
		border-color: var(--admin-accent);
	}

	.message-field::placeholder {
		color: var(--admin-text-subtle);
	}

	.send-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 38px;
		height: 38px;
		border-radius: 8px;
		background: var(--admin-accent);
		border: none;
		color: #fff;
		cursor: pointer;
		transition: opacity 0.15s;
		flex-shrink: 0;
	}

	.send-btn:hover:not(:disabled) {
		opacity: 0.85;
	}

	.send-btn:disabled {
		opacity: 0.35;
		cursor: not-allowed;
	}

	@media (max-width: 768px) {
		.mobile-hidden {
			display: none;
		}

		.conversation {
			position: absolute;
			inset: 0;
			background: var(--admin-bg);
		}

		.back-btn {
			display: flex;
		}

		.message-bubble {
			max-width: 85%;
		}
	}
</style>
