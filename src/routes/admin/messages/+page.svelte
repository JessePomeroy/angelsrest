<script lang="ts">
import FeatureGate from "$lib/admin/components/FeatureGate.svelte";
import SEO from "$lib/components/SEO.svelte";

interface Thread {
	client: {
		_id: string;
		name: string;
		siteUrl: string;
	};
	unreadCount: number;
	latestMessage: {
		_id: string;
		siteUrl: string;
		sender: "client" | "creator";
		content: string;
		read: boolean;
		_creationTime: number;
	} | null;
}

interface Message {
	_id: string;
	siteUrl: string;
	sender: "client" | "creator";
	content: string;
	read: boolean;
	_creationTime: number;
}

let { data } = $props();

let threads: Thread[] = $state([]);
let threadsInitialized = false;

$effect(() => {
	if (!threadsInitialized && data.threads) {
		threads = data.threads;
		threadsInitialized = true;
	}
});
let selectedThread = $state<Thread | null>(null);
let messages = $state<Message[]>([]);
let messageInput = $state("");
let sending = $state(false);
let loadingMessages = $state(false);
let mobileShowConversation = $state(false);

async function selectThread(thread: Thread) {
	selectedThread = thread;
	mobileShowConversation = true;
	loadingMessages = true;

	try {
		const res = await fetch(
			`/api/admin/messages?siteUrl=${encodeURIComponent(thread.client.siteUrl)}`,
		);
		const data = await res.json();
		messages = data.messages ?? [];

		if (thread.unreadCount > 0) {
			await fetch("/api/admin/messages", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ siteUrl: thread.client.siteUrl }),
			});
			thread.unreadCount = 0;
		}
	} catch (err) {
		console.error("Failed to load messages:", err);
	} finally {
		loadingMessages = false;
	}
}

async function sendMessage() {
	if (!messageInput.trim() || !selectedThread || sending) return;
	sending = true;
	const content = messageInput.trim();
	messageInput = "";

	try {
		const res = await fetch("/api/admin/messages", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ siteUrl: selectedThread.client.siteUrl, content }),
		});
		if (res.ok) {
			messages = [
				...messages,
				{
					_id: `temp-${Date.now()}`,
					siteUrl: selectedThread.client.siteUrl,
					sender: "creator",
					content,
					read: false,
					_creationTime: Date.now(),
				},
			];
			// Update latest message in thread list
			const idx = threads.findIndex(
				(t) => t.client._id === selectedThread?.client._id,
			);
			if (idx !== -1) {
				threads[idx] = {
					...threads[idx],
					latestMessage: {
						_id: `temp-${Date.now()}`,
						siteUrl: selectedThread.client.siteUrl,
						sender: "creator",
						content,
						read: false,
						_creationTime: Date.now(),
					},
				};
				threads = [...threads];
			}
		}
	} catch (err) {
		console.error("Failed to send message:", err);
	} finally {
		sending = false;
	}
}

function goBackToThreads() {
	mobileShowConversation = false;
	selectedThread = null;
}

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

function formatMessageTime(timestamp: number): string {
	return new Date(timestamp).toLocaleTimeString("en-US", {
		hour: "numeric",
		minute: "2-digit",
	});
}

function truncate(text: string, max: number): string {
	if (text.length <= max) return text;
	return `${text.slice(0, max)}...`;
}

function handleKeydown(e: KeyboardEvent) {
	if (e.key === "Enter" && !e.shiftKey) {
		e.preventDefault();
		sendMessage();
	}
}
</script>

<SEO title="Messages | Admin" description="Platform client messages" />

<FeatureGate feature="messages" tier={data.tier}>
<div class="messages-page">
	<header class="page-header">
		<h1>messages</h1>
	</header>

	{#if threads.length === 0}
		<div class="empty-state">
			<p class="empty-text">no client threads yet — threads will appear when you add platform clients</p>
		</div>
	{:else}
		<div class="messages-layout">
			<!-- Thread list -->
			<div class="thread-list" class:mobile-hidden={mobileShowConversation}>
				{#each threads as thread (thread.client._id)}
					<button
						class="thread-item"
						class:active={selectedThread?.client._id === thread.client._id}
						onclick={() => selectThread(thread)}
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

			<!-- Conversation panel -->
			<div class="conversation" class:mobile-hidden={!mobileShowConversation}>
				{#if selectedThread}
					<div class="convo-header">
						<button class="back-btn" onclick={goBackToThreads} aria-label="Back to threads">
							<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
						</button>
						<div class="convo-header-info">
							<span class="convo-name">{selectedThread.client.name}</span>
							<span class="convo-url">{selectedThread.client.siteUrl}</span>
						</div>
					</div>

					<div class="convo-messages">
						{#if loadingMessages}
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
							bind:value={messageInput}
							onkeydown={handleKeydown}
							disabled={sending}
						/>
						<button class="send-btn" onclick={sendMessage} disabled={sending || !messageInput.trim()} aria-label="Send message">
							<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
						</button>
					</div>
				{:else}
					<div class="no-thread-selected">
						<p>select a conversation to start messaging</p>
					</div>
				{/if}
			</div>
		</div>
	{/if}
</div>
</FeatureGate>

<style>
	.messages-page {
		padding: 36px 40px;
		height: 100vh;
		display: flex;
		flex-direction: column;
	}

	.page-header {
		margin-bottom: 24px;
		flex-shrink: 0;
	}

	.page-header h1 {
		font-family: "Chillax", sans-serif;
		font-size: 1.35rem;
		font-weight: 500;
		color: var(--admin-heading);
		margin: 0;
	}

	/* Empty state */
	.empty-state {
		padding: 48px 0;
	}

	.empty-text {
		color: var(--admin-text-subtle);
		font-size: 0.88rem;
		margin: 0;
	}

	/* Two-panel layout */
	.messages-layout {
		display: flex;
		flex: 1;
		min-height: 0;
		gap: 0;
	}

	/* Thread list */
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

	/* Conversation panel */
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

	/* Messages area */
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

	/* Input bar */
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

	/* Mobile responsive */
	@media (max-width: 768px) {
		.messages-page {
			padding: 16px 12px;
		}

		.page-header {
			margin-bottom: 16px;
		}

		.messages-layout {
			position: relative;
		}

		.thread-list {
			width: 100%;
			border-right: none;
		}

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
