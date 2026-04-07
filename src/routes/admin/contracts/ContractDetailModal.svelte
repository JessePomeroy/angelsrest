<script lang="ts">
import AdminModal from "$lib/admin/components/AdminModal.svelte";
import StatusDot from "$lib/admin/components/StatusDot.svelte";
import type { Contract } from "$lib/admin/types";
import {
	CONTRACT_STATUS_COLORS,
	dollarsToCents,
	formatCents,
	formatDate,
	formatTimestamp,
	getStatusColor,
} from "$lib/admin/utils";

interface Props {
	contract: Contract;
	onclose: () => void;
	onsave: (id: string, payload: Record<string, unknown>) => Promise<void>;
	onaction: (id: string, action: string) => Promise<void>;
	onsend: (id: string) => Promise<boolean>;
	ondelete: (id: string) => Promise<void>;
	onsharelink: (id: string, clientId: string) => Promise<void>;
}

let {
	contract,
	onclose,
	onsave,
	onaction,
	onsend,
	ondelete,
	onsharelink,
}: Props = $props();

let editMode = $state(false);
let confirmDelete = $state(false);
let saving = $state(false);
let sending = $state(false);
let sendResult = $state<"success" | "error" | null>(null);
let shareLinkCopied = $state(false);

let editTitle = $state("");
let editBody = $state("");
let editEventDate = $state("");
let editEventLocation = $state("");
let editTotalPrice = $state(0);
let editDepositAmount = $state(0);

function startEdit() {
	editTitle = contract.title;
	editBody = contract.body;
	editEventDate = contract.eventDate || "";
	editEventLocation = contract.eventLocation || "";
	editTotalPrice = contract.totalPrice ? contract.totalPrice / 100 : 0;
	editDepositAmount = contract.depositAmount ? contract.depositAmount / 100 : 0;
	editMode = true;
}

function cancelEdit() {
	editMode = false;
}

async function handleSaveEdit() {
	if (!editTitle || !editBody) return;
	saving = true;
	try {
		const payload: Record<string, unknown> = {
			title: editTitle,
			body: editBody,
			eventDate: editEventDate || undefined,
			eventLocation: editEventLocation || undefined,
			totalPrice:
				editTotalPrice > 0 ? dollarsToCents(editTotalPrice) : undefined,
			depositAmount:
				editDepositAmount > 0 ? dollarsToCents(editDepositAmount) : undefined,
		};
		await onsave(contract._id, payload);
		editMode = false;
	} finally {
		saving = false;
	}
}

async function handleSendEmail() {
	sending = true;
	sendResult = null;
	try {
		const ok = await onsend(contract._id);
		sendResult = ok ? "success" : "error";
	} catch {
		sendResult = "error";
	} finally {
		sending = false;
	}
}

async function handleAction(action: string) {
	saving = true;
	try {
		await onaction(contract._id, action);
	} finally {
		saving = false;
	}
}

async function handleDelete() {
	saving = true;
	try {
		await ondelete(contract._id);
	} finally {
		saving = false;
	}
}

async function handleShareLink() {
	shareLinkCopied = false;
	await onsharelink(contract._id, contract.clientId);
	shareLinkCopied = true;
	setTimeout(() => {
		shareLinkCopied = false;
	}, 3000);
}
</script>

<AdminModal
	title={editMode ? "edit contract" : contract.title}
	onclose={onclose}
	size="wide"
>
	{#if editMode}
		<form
			class="modal-form"
			onsubmit={(e) => {
				e.preventDefault();
				handleSaveEdit();
			}}
		>
			<div class="form-group">
				<label class="form-label" for="edit-title"
					>title <span class="required">*</span></label
				>
				<input
					id="edit-title"
					class="form-input"
					type="text"
					bind:value={editTitle}
					required
				/>
			</div>

			<div class="form-group">
				<label class="form-label" for="edit-body"
					>body <span class="required">*</span></label
				>
				<textarea
					id="edit-body"
					class="form-input form-textarea form-textarea-large"
					bind:value={editBody}
					rows="10"
					required
				></textarea>
			</div>

			<div class="form-row">
				<div class="form-group">
					<label class="form-label" for="edit-event-date"
						>event date</label
					>
					<input
						id="edit-event-date"
						class="form-input"
						type="date"
						bind:value={editEventDate}
					/>
				</div>
				<div class="form-group">
					<label class="form-label" for="edit-event-location"
						>event location</label
					>
					<input
						id="edit-event-location"
						class="form-input"
						type="text"
						bind:value={editEventLocation}
					/>
				</div>
			</div>

			<div class="form-row">
				<div class="form-group">
					<label class="form-label" for="edit-total-price"
						>total price ($)</label
					>
					<input
						id="edit-total-price"
						class="form-input"
						type="number"
						min="0"
						step="0.01"
						bind:value={editTotalPrice}
					/>
				</div>
				<div class="form-group">
					<label class="form-label" for="edit-deposit"
						>deposit amount ($)</label
					>
					<input
						id="edit-deposit"
						class="form-input"
						type="number"
						min="0"
						step="0.01"
						bind:value={editDepositAmount}
					/>
				</div>
			</div>

			<div class="modal-actions">
				<button type="button" class="btn-cancel" onclick={cancelEdit}
					>cancel</button
				>
				<button
					type="submit"
					class="btn-save"
					disabled={saving || !editTitle || !editBody}
				>
					{saving ? "saving..." : "save changes"}
				</button>
			</div>
		</form>
	{:else}
		<div class="detail-body">
			<div class="detail-meta-line">
				<StatusDot
					color={getStatusColor(
						CONTRACT_STATUS_COLORS,
						contract.status,
					)}
					label={contract.status}
				/>
				{#if contract.category}
					<span class="meta-sep">&middot;</span>
					<span class="detail-category">{contract.category}</span>
				{/if}
				<span class="meta-sep">&middot;</span>
				<span class="detail-client">{contract.clientName}</span>
				{#if contract.eventDate}
					<span class="meta-sep">&middot;</span>
					<span class="detail-date"
						>{formatDate(contract.eventDate)}</span
					>
				{/if}
			</div>

			{#if contract.totalPrice || contract.depositAmount}
				<div class="detail-pricing">
					{#if contract.totalPrice}
						<span>total: {formatCents(contract.totalPrice)}</span>
					{/if}
					{#if contract.depositAmount}
						<span class="stat-sep">&middot;</span>
						<span
							>deposit:
							{formatCents(contract.depositAmount)}</span
						>
					{/if}
				</div>
			{/if}

			{#if contract.eventLocation}
				<div class="detail-field">
					<span class="detail-label">location</span>
					<span class="detail-value"
						>{contract.eventLocation}</span
					>
				</div>
			{/if}

			<div class="detail-fields">
				<div class="detail-field">
					<span class="detail-label">contract body</span>
					<div class="detail-body-text">
						{contract.body}
					</div>
				</div>

				{#if contract.sentAt}
					<div class="detail-field">
						<span class="detail-label">sent</span>
						<span class="detail-value"
							>{formatTimestamp(contract.sentAt)}</span
						>
					</div>
				{/if}

				{#if contract.signedAt}
					<div class="detail-field">
						<span class="detail-label">signed</span>
						<span class="detail-value"
							>{formatTimestamp(contract.signedAt)}</span
						>
					</div>
				{/if}

				<div class="detail-field">
					<span class="detail-label">created</span>
					<span class="detail-value"
						>{formatTimestamp(contract._creationTime)}</span
					>
				</div>
			</div>

			<div class="share-link-row">
				<button class="btn-share" onclick={handleShareLink}>
					{shareLinkCopied ? "link copied!" : "copy share link"}
				</button>
			</div>

			<div class="modal-actions detail-actions">
				{#if confirmDelete}
					<span class="confirm-text">delete this contract?</span>
					<button
						class="btn-danger"
						onclick={handleDelete}
						disabled={saving}
					>
						{saving ? "deleting..." : "yes, delete"}
					</button>
					<button
						class="btn-cancel"
						onclick={() => {
							confirmDelete = false;
						}}>no</button
					>
				{:else if sendResult === "success"}
					<span class="send-success">email sent</span>
				{:else if sendResult === "error"}
					<span class="send-error">failed to send</span>
					<button
						class="btn-cancel"
						onclick={() => {
							sendResult = null;
						}}>dismiss</button
					>
				{:else if contract.status === "draft"}
					<button
						class="btn-danger-outline"
						onclick={() => {
							confirmDelete = true;
						}}>delete</button
					>
					<button class="btn-cancel" onclick={startEdit}
						>edit</button
					>
					<button
						class="btn-send"
						onclick={handleSendEmail}
						disabled={sending}
					>
						{sending ? "sending..." : "send email"}
					</button>
					<button
						class="btn-save"
						onclick={() => handleAction("send")}
						disabled={saving}
					>
						{saving ? "..." : "mark as sent"}
					</button>
				{:else if contract.status === "sent"}
					<button
						class="btn-save"
						onclick={() => handleAction("sign")}
						disabled={saving}
					>
						{saving ? "..." : "mark as signed"}
					</button>
				{:else if contract.status === "signed" && contract.signedAt}
					<span class="signed-note"
						>signed on
						{formatTimestamp(contract.signedAt)}</span
					>
				{/if}
			</div>
		</div>
	{/if}
</AdminModal>

<style>
	.modal-form {
		padding: 0 28px 28px;
		display: flex;
		flex-direction: column;
		gap: 14px;
	}

	.form-row {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 14px;
	}

	.form-group {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.form-label {
		font-size: 0.76rem;
		color: var(--admin-text-muted);
		font-weight: 400;
		letter-spacing: 0.02em;
	}

	.required {
		color: var(--status-rose);
	}

	.form-input {
		padding: 8px 10px;
		background: rgba(255, 255, 255, 0.03);
		color: var(--admin-text);
		border: 1px solid var(--admin-border-strong);
		border-radius: 6px;
		font-size: 0.85rem;
		font-family: "Synonym", system-ui, sans-serif;
		outline: none;
		transition: border-color 0.15s;
	}

	.form-input:focus {
		border-color: var(--admin-accent);
	}

	.form-textarea {
		resize: vertical;
		min-height: 60px;
		font-family: inherit;
	}

	.form-textarea-large {
		min-height: 180px;
		line-height: 1.6;
	}

	.detail-body {
		padding: 0 28px 28px;
		display: flex;
		flex-direction: column;
		gap: 20px;
	}

	.detail-meta-line {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 0.85rem;
		flex-wrap: wrap;
	}

	.meta-sep {
		color: var(--admin-text-subtle);
	}

	.detail-client {
		color: var(--admin-text);
	}

	.detail-category {
		color: var(--admin-text-muted);
		font-size: 0.82rem;
	}

	.detail-date {
		color: var(--admin-text-muted);
	}

	.detail-pricing {
		display: flex;
		align-items: baseline;
		gap: 8px;
		font-size: 0.85rem;
		color: var(--admin-text-muted);
	}

	.stat-sep {
		color: var(--admin-text-subtle);
	}

	.detail-fields {
		display: flex;
		flex-direction: column;
		gap: 16px;
		border-top: 1px solid var(--admin-border);
		padding-top: 16px;
	}

	.detail-field {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.detail-label {
		font-size: 0.72rem;
		color: var(--admin-text-subtle);
		letter-spacing: 0.04em;
		font-weight: 400;
	}

	.detail-value {
		font-size: 0.88rem;
		color: var(--admin-heading);
	}

	.detail-body-text {
		white-space: pre-wrap;
		line-height: 1.6;
		font-size: 0.85rem;
		color: var(--admin-text);
		max-height: 300px;
		overflow-y: auto;
		padding: 12px 0;
	}

	.modal-actions {
		display: flex;
		justify-content: flex-end;
		gap: 10px;
		padding-top: 6px;
	}

	.share-link-row {
		display: flex;
		justify-content: flex-end;
		padding: 12px 0 0;
	}

	.btn-share {
		padding: 5px 14px;
		border-radius: 6px;
		font-size: 0.78rem;
		font-family: "Synonym", system-ui, sans-serif;
		cursor: pointer;
		background: transparent;
		color: var(--admin-text-muted);
		border: 1px solid var(--admin-border);
		transition: color 0.15s, border-color 0.15s;
	}

	.btn-share:hover {
		color: var(--admin-accent);
		border-color: var(--admin-accent);
	}

	.btn-cancel,
	.btn-save,
	.btn-danger,
	.btn-danger-outline,
	.btn-send {
		padding: 7px 16px;
		border-radius: 6px;
		font-size: 0.82rem;
		font-family: "Synonym", system-ui, sans-serif;
		cursor: pointer;
		transition: background 0.15s, border-color 0.15s, opacity 0.15s;
		border: 1px solid transparent;
	}

	.btn-cancel {
		background: transparent;
		color: var(--admin-text-muted);
		border-color: var(--admin-border-strong);
	}

	.btn-cancel:hover {
		color: var(--admin-text);
	}

	.btn-save {
		background: rgba(129, 140, 248, 0.15);
		border-color: rgba(129, 140, 248, 0.25);
		color: var(--admin-accent-hover);
		font-weight: 500;
	}

	.btn-save:hover {
		background: rgba(129, 140, 248, 0.22);
	}

	.btn-save:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.btn-send {
		background: rgba(74, 222, 128, 0.12);
		border-color: rgba(74, 222, 128, 0.25);
		color: #4ade80;
		font-weight: 500;
	}

	.btn-send:hover {
		background: rgba(74, 222, 128, 0.2);
	}

	.btn-send:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.send-success {
		font-size: 0.82rem;
		color: #4ade80;
		margin-right: auto;
		align-self: center;
	}

	.send-error {
		font-size: 0.82rem;
		color: var(--status-rose);
		margin-right: auto;
		align-self: center;
	}

	.btn-danger {
		background: rgba(248, 113, 113, 0.15);
		border-color: rgba(248, 113, 113, 0.3);
		color: var(--status-rose);
	}

	.btn-danger:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.btn-danger-outline {
		background: transparent;
		color: var(--status-rose);
		border-color: rgba(248, 113, 113, 0.25);
	}

	.btn-danger-outline:hover {
		background: rgba(248, 113, 113, 0.08);
	}

	.detail-actions {
		border-top: 1px solid var(--admin-border);
		padding-top: 16px;
	}

	.confirm-text {
		font-size: 0.82rem;
		color: var(--status-rose);
		margin-right: auto;
		align-self: center;
	}

	.signed-note {
		font-size: 0.82rem;
		color: var(--status-sage);
		margin-left: auto;
	}

	@media (max-width: 768px) {
		.form-row {
			grid-template-columns: 1fr;
		}

		.modal-form {
			padding: 0 20px 20px;
		}

		.detail-body {
			padding: 0 20px 20px;
		}
	}
</style>
