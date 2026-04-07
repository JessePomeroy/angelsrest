<script lang="ts">
import AdminModal from "$lib/admin/components/AdminModal.svelte";
import StatusDot from "$lib/admin/components/StatusDot.svelte";
import type { Invoice, InvoiceItem } from "$lib/admin/types";
import {
	formatCents,
	formatDate,
	formatTimestamp,
	getStatusColor,
	INVOICE_STATUS_COLORS,
} from "$lib/admin/utils";
import LineItemEditor from "./LineItemEditor.svelte";

interface Props {
	invoice: Invoice;
	onsave: (body: Record<string, unknown>) => Promise<void>;
	onaction: (action: string) => Promise<void>;
	onsend: () => Promise<void>;
	ondelete: () => Promise<void>;
	onshare: () => Promise<void>;
	shareLinkCopied: boolean;
	onclose: () => void;
}

let {
	invoice,
	onsave,
	onaction,
	onsend,
	ondelete,
	onshare,
	shareLinkCopied,
	onclose,
}: Props = $props();

let editMode = $state(false);
let confirmDelete = $state(false);
let saving = $state(false);
let sending = $state(false);
let sendResult = $state<"success" | "error" | null>(null);

// Edit form state
let editItems = $state<InvoiceItem[]>([]);
let editTaxPercent = $state(0);
let editDueDate = $state("");
let editNotes = $state("");

function calcSubtotal(items: InvoiceItem[]): number {
	return items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
}

function calcTax(subtotal: number, taxPercent: number): number {
	return Math.round(subtotal * (taxPercent / 100));
}

let detailSubtotal = $derived(calcSubtotal(invoice.items));
let detailTax = $derived(calcTax(detailSubtotal, invoice.taxPercent || 0));
let detailTotal = $derived(detailSubtotal + detailTax);

let editSubtotal = $derived(calcSubtotal(editItems));
let editTax = $derived(calcTax(editSubtotal, editTaxPercent));
let editTotal = $derived(editSubtotal + editTax);

function startEdit() {
	editItems = invoice.items.map((it: InvoiceItem) => ({ ...it }));
	editTaxPercent = invoice.taxPercent || 0;
	editDueDate = invoice.dueDate || "";
	editNotes = invoice.notes || "";
	editMode = true;
}

function cancelEdit() {
	editMode = false;
}

async function handleSaveEdit() {
	if (editItems.length === 0) return;
	saving = true;
	try {
		const items = editItems.map((item) => ({
			description: item.description,
			quantity: item.quantity,
			unitPrice: item.unitPrice,
		}));
		const body: Record<string, unknown> = { items };
		if (editTaxPercent > 0) body.taxPercent = editTaxPercent;
		body.dueDate = editDueDate || undefined;
		body.notes = editNotes || undefined;
		await onsave(body);
		editMode = false;
	} catch (err) {
		console.error("Failed to update invoice:", err);
	} finally {
		saving = false;
	}
}

async function handleSendEmail() {
	sending = true;
	sendResult = null;
	try {
		await onsend();
		sendResult = "success";
	} catch {
		sendResult = "error";
	} finally {
		sending = false;
	}
}

async function handleAction(action: string) {
	saving = true;
	try {
		await onaction(action);
	} catch (err) {
		console.error("Failed to update invoice:", err);
	} finally {
		saving = false;
	}
}

async function handleDelete() {
	saving = true;
	try {
		await ondelete();
	} catch (err) {
		console.error("Failed to delete invoice:", err);
	} finally {
		saving = false;
	}
}
</script>

<AdminModal
	title={editMode ? "edit invoice" : invoice.invoiceNumber}
	{onclose}
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
			<LineItemEditor
				items={editItems}
				onitems={(v) => {
					editItems = v;
				}}
				pricePlaceholder="price (cents)"
				formatTotal={formatCents}
			/>

			<div class="form-row">
				<div class="form-group">
					<label class="form-label" for="edit-tax">tax %</label>
					<input
						id="edit-tax"
						class="form-input"
						type="number"
						min="0"
						step="0.1"
						bind:value={editTaxPercent}
					/>
				</div>
				<div class="form-group">
					<label class="form-label" for="edit-due">due date</label>
					<input
						id="edit-due"
						class="form-input"
						type="date"
						bind:value={editDueDate}
					/>
				</div>
			</div>

			<div class="form-group">
				<label class="form-label" for="edit-notes">notes</label>
				<textarea
					id="edit-notes"
					class="form-input form-textarea"
					bind:value={editNotes}
					rows="2"
				></textarea>
			</div>

			<div class="totals-line">
				<span>subtotal: {formatCents(editSubtotal)}</span>
				{#if editTaxPercent > 0}
					<span class="stat-sep">&middot;</span>
					<span>tax: {formatCents(editTax)}</span>
				{/if}
				<span class="stat-sep">&middot;</span>
				<span class="total-amount"
					>total: {formatCents(editTotal)}</span
				>
			</div>

			<div class="modal-actions">
				<button type="button" class="btn-cancel" onclick={cancelEdit}
					>cancel</button
				>
				<button
					type="submit"
					class="btn-save"
					disabled={saving || editItems.length === 0}
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
						INVOICE_STATUS_COLORS,
						invoice.status,
					)}
					label={invoice.status}
				/>
				{#if invoice.invoiceType && invoice.invoiceType !== "one-time"}
					<span class="meta-sep">&middot;</span>
					<span class="detail-type">{invoice.invoiceType}</span>
				{/if}
				<span class="meta-sep">&middot;</span>
				<span class="detail-client">{invoice.clientName}</span>
				{#if invoice.dueDate}
					<span class="meta-sep">&middot;</span>
					<span class="detail-due"
						>due {formatDate(invoice.dueDate)}</span
					>
				{/if}
			</div>

			{#if invoice.invoiceType === "recurring" && invoice.recurring}
				<div class="type-info">
					<span class="type-info-item"
						>interval: {invoice.recurring.interval}</span
					>
					{#if invoice.recurring.nextDueDate}
						<span class="stat-sep">&middot;</span>
						<span class="type-info-item"
							>next due: {formatDate(
								invoice.recurring.nextDueDate,
							)}</span
						>
					{/if}
					{#if invoice.recurring.endDate}
						<span class="stat-sep">&middot;</span>
						<span class="type-info-item"
							>ends: {formatDate(
								invoice.recurring.endDate,
							)}</span
						>
					{/if}
				</div>
			{/if}

			{#if invoice.invoiceType === "deposit"}
				<div class="type-info">
					{#if invoice.depositPercent}
						<span class="type-info-item"
							>deposit: {invoice.depositPercent}%</span
						>
					{/if}
					{#if invoice.totalProject}
						<span class="stat-sep">&middot;</span>
						<span class="type-info-item"
							>total project: {formatCents(
								invoice.totalProject,
							)}</span
						>
						<span class="stat-sep">&middot;</span>
						<span class="type-info-item"
							>amount due: {formatCents(
								Math.round(
									invoice.totalProject *
										((invoice.depositPercent || 0) / 100),
								),
							)}</span
						>
						<span class="stat-sep">&middot;</span>
						<span class="type-info-item"
							>remaining: {formatCents(
								invoice.totalProject -
									Math.round(
										invoice.totalProject *
											((invoice.depositPercent || 0) /
												100),
									),
							)}</span
						>
					{/if}
				</div>
			{/if}

			{#if invoice.invoiceType === "milestone"}
				<div class="type-info">
					{#if invoice.milestoneName}
						<span class="type-info-item"
							>{invoice.milestoneName}</span
						>
						<span class="stat-sep">&middot;</span>
					{/if}
					{#if invoice.milestoneIndex}
						<span class="type-info-item"
							>milestone {invoice.milestoneIndex}</span
						>
					{/if}
				</div>
			{/if}

			<div class="detail-fields">
				<div class="detail-items-table">
					<div class="items-table-header">
						<span class="itcol-desc">description</span>
						<span class="itcol-qty">qty</span>
						<span class="itcol-price">price</span>
						<span class="itcol-total">total</span>
					</div>
					{#each invoice.items as item}
						<div class="items-table-row">
							<span class="itcol-desc">{item.description}</span>
							<span class="itcol-qty">{item.quantity}</span>
							<span class="itcol-price"
								>{formatCents(item.unitPrice)}</span
							>
							<span class="itcol-total"
								>{formatCents(
									item.quantity * item.unitPrice,
								)}</span
							>
						</div>
					{/each}
				</div>

				<div class="totals-line">
					<span>subtotal: {formatCents(detailSubtotal)}</span>
					{#if invoice.taxPercent}
						<span class="stat-sep">&middot;</span>
						<span
							>tax ({invoice.taxPercent}%): {formatCents(
								detailTax,
							)}</span
						>
					{/if}
					<span class="stat-sep">&middot;</span>
					<span class="total-amount"
						>total: {formatCents(detailTotal)}</span
					>
				</div>

				{#if invoice.notes}
					<div class="detail-field">
						<span class="detail-label">notes</span>
						<span class="detail-value detail-notes"
							>{invoice.notes}</span
						>
					</div>
				{/if}

				{#if invoice.sentAt}
					<div class="detail-field">
						<span class="detail-label">sent</span>
						<span class="detail-value"
							>{formatTimestamp(invoice.sentAt)}</span
						>
					</div>
				{/if}

				{#if invoice.paidAt}
					<div class="detail-field">
						<span class="detail-label">paid</span>
						<span class="detail-value"
							>{formatTimestamp(invoice.paidAt)}</span
						>
					</div>
				{/if}

				<div class="detail-field">
					<span class="detail-label">created</span>
					<span class="detail-value"
						>{formatTimestamp(invoice._creationTime)}</span
					>
				</div>
			</div>

			<div class="share-link-row">
				<button class="btn-share" onclick={onshare}>
					{shareLinkCopied ? "link copied!" : "copy share link"}
				</button>
			</div>
			<div class="modal-actions detail-actions">
				{#if confirmDelete}
					<span class="confirm-text">delete this invoice?</span>
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
				{:else if invoice.status === "draft"}
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
				{:else if invoice.status === "sent"}
					<button
						class="btn-action"
						onclick={() => handleAction("overdue")}
						disabled={saving}>mark overdue</button
					>
					<button
						class="btn-save"
						onclick={() => handleAction("pay")}
						disabled={saving}
					>
						{saving ? "..." : "mark as paid"}
					</button>
				{:else if invoice.status === "overdue"}
					<button
						class="btn-save"
						onclick={() => handleAction("pay")}
						disabled={saving}
					>
						{saving ? "..." : "mark as paid"}
					</button>
				{:else if invoice.status === "paid"}
					<span class="paid-note"
						>paid on {formatTimestamp(invoice.paidAt ?? 0)}</span
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

	.totals-line {
		display: flex;
		align-items: baseline;
		gap: 8px;
		flex-wrap: wrap;
		font-size: 0.82rem;
		color: var(--admin-text-muted);
		padding-top: 4px;
	}

	.stat-sep {
		color: var(--admin-text-subtle);
	}

	.total-amount {
		font-weight: 500;
		color: var(--admin-heading);
	}

	.modal-actions {
		display: flex;
		justify-content: flex-end;
		gap: 10px;
		padding-top: 6px;
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

	.detail-due {
		color: var(--admin-text-muted);
	}

	.detail-type {
		color: var(--admin-text-muted);
		font-size: 0.82rem;
	}

	.type-info {
		display: flex;
		align-items: baseline;
		gap: 8px;
		flex-wrap: wrap;
		font-size: 0.82rem;
		color: var(--admin-text-muted);
	}

	.type-info-item {
		color: var(--admin-text-muted);
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

	.detail-notes {
		white-space: pre-wrap;
		line-height: 1.5;
	}

	.detail-items-table {
		display: flex;
		flex-direction: column;
	}

	.items-table-header {
		display: flex;
		gap: 8px;
		padding-bottom: 8px;
		border-bottom: 1px solid var(--admin-border);
		font-size: 0.72rem;
		color: var(--admin-text-subtle);
		letter-spacing: 0.04em;
	}

	.items-table-row {
		display: flex;
		gap: 8px;
		padding: 8px 0;
		border-bottom: 1px solid var(--admin-border);
		font-size: 0.85rem;
		color: var(--admin-text);
	}

	.itcol-desc {
		flex: 3;
		min-width: 0;
	}

	.itcol-qty {
		flex: 0 0 40px;
		text-align: center;
	}

	.itcol-price {
		flex: 0 0 80px;
		text-align: right;
		font-variant-numeric: tabular-nums;
	}

	.itcol-total {
		flex: 0 0 80px;
		text-align: right;
		font-variant-numeric: tabular-nums;
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

	.detail-actions {
		border-top: 1px solid var(--admin-border);
		padding-top: 16px;
	}

	.btn-cancel,
	.btn-save,
	.btn-danger,
	.btn-danger-outline,
	.btn-action,
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

	.btn-action {
		background: rgba(212, 160, 83, 0.12);
		border-color: rgba(212, 160, 83, 0.25);
		color: var(--status-amber);
	}

	.btn-action:hover {
		background: rgba(212, 160, 83, 0.2);
	}

	.btn-action:disabled {
		opacity: 0.4;
		cursor: not-allowed;
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

	.confirm-text {
		font-size: 0.82rem;
		color: var(--status-rose);
		margin-right: auto;
		align-self: center;
	}

	.paid-note {
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
