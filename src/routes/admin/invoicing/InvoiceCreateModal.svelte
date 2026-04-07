<script lang="ts">
import AdminModal from "$lib/admin/components/AdminModal.svelte";
import type {
	Client,
	Invoice,
	InvoiceItem,
	InvoiceType,
} from "$lib/admin/types";
import { dollarsToCents, formatCents } from "$lib/admin/utils";
import LineItemEditor from "./LineItemEditor.svelte";

interface Props {
	clients: Client[];
	invoices: Invoice[];
	nextNumber: string;
	oncreate: (body: Record<string, unknown>) => Promise<void>;
	onclose: () => void;
}

let { clients, invoices, nextNumber, oncreate, onclose }: Props = $props();

let saving = $state(false);

// Form state
let formNumber = $state(nextNumber);
let formClientId = $state("");
let formType = $state<InvoiceType>("one-time");
let formItems = $state<InvoiceItem[]>([
	{ description: "", quantity: 1, unitPrice: 0 },
]);
let formTaxPercent = $state(0);
let formDueDate = $state("");
let formNotes = $state("");

// Recurring fields
let formRecurringInterval = $state<
	"weekly" | "monthly" | "quarterly" | "yearly"
>("monthly");
let formRecurringNextDue = $state("");
let formRecurringEndDate = $state("");

// Deposit fields
let formDepositPercent = $state(50);
let formTotalProject = $state(0);

// Milestone fields
let formMilestoneName = $state("");
let formMilestoneIndex = $state(1);
let formMilestoneTotal = $state(1);
let formParentInvoiceId = $state("");

const allTypes: InvoiceType[] = [
	"one-time",
	"recurring",
	"deposit",
	"package",
	"milestone",
];

function calcSubtotal(items: InvoiceItem[]): number {
	return items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
}

function calcTax(subtotal: number, taxPercent: number): number {
	return Math.round(subtotal * (taxPercent / 100));
}

let createSubtotal = $derived(calcSubtotal(formItems));
let createTax = $derived(calcTax(createSubtotal, formTaxPercent));
let createTotal = $derived(createSubtotal + createTax);

let depositTotal = $derived(
	Math.round(dollarsToCents(formTotalProject) * (formDepositPercent / 100)),
);

async function handleSubmit() {
	if (!formNumber || !formClientId || formItems.length === 0) return;
	saving = true;
	try {
		const items = formItems.map((item) => ({
			description: item.description,
			quantity: item.quantity,
			unitPrice: dollarsToCents(item.unitPrice),
		}));
		const body: Record<string, unknown> = {
			invoiceNumber: formNumber,
			clientId: formClientId,
			invoiceType: formType,
			items,
		};
		if (formTaxPercent > 0) body.taxPercent = formTaxPercent;
		if (formDueDate) body.dueDate = formDueDate;
		if (formNotes) body.notes = formNotes;

		if (formType === "recurring") {
			body.recurring = {
				interval: formRecurringInterval,
				nextDueDate: formRecurringNextDue || undefined,
				endDate: formRecurringEndDate || undefined,
			};
		}

		if (formType === "deposit") {
			body.depositPercent = formDepositPercent;
			body.totalProject = dollarsToCents(formTotalProject);
		}

		if (formType === "milestone") {
			if (formMilestoneName) body.milestoneName = formMilestoneName;
			body.milestoneIndex = formMilestoneIndex;
			if (formParentInvoiceId) body.parentInvoiceId = formParentInvoiceId;
		}

		await oncreate(body);
	} catch (err) {
		console.error("Failed to create invoice:", err);
	} finally {
		saving = false;
	}
}
</script>

<AdminModal title="new invoice" {onclose} size="wide">
	<form
		class="modal-form"
		onsubmit={(e) => {
			e.preventDefault();
			handleSubmit();
		}}
	>
		<div class="form-group">
			<label class="form-label" for="create-type">invoice type</label>
			<select id="create-type" class="form-input" bind:value={formType}>
				{#each allTypes as t}
					<option value={t}>{t}</option>
				{/each}
			</select>
		</div>

		<div class="form-row">
			<div class="form-group">
				<label class="form-label" for="create-number"
					>invoice # <span class="required">*</span></label
				>
				<input
					id="create-number"
					class="form-input"
					type="text"
					bind:value={formNumber}
					required
				/>
			</div>
			<div class="form-group">
				<label class="form-label" for="create-client"
					>client <span class="required">*</span></label
				>
				<select
					id="create-client"
					class="form-input"
					bind:value={formClientId}
					required
				>
					<option value="">select client...</option>
					{#each clients as client (client._id)}
						<option value={client._id}>{client.name}</option>
					{/each}
				</select>
			</div>
		</div>

		{#if formType === "recurring"}
			<div class="form-row">
				<div class="form-group">
					<label class="form-label" for="create-interval"
						>interval <span class="required">*</span></label
					>
					<select
						id="create-interval"
						class="form-input"
						bind:value={formRecurringInterval}
					>
						<option value="weekly">weekly</option>
						<option value="monthly">monthly</option>
						<option value="quarterly">quarterly</option>
						<option value="yearly">yearly</option>
					</select>
				</div>
				<div class="form-group">
					<label class="form-label" for="create-next-due"
						>next due date</label
					>
					<input
						id="create-next-due"
						class="form-input"
						type="date"
						bind:value={formRecurringNextDue}
					/>
				</div>
			</div>
			<div class="form-group">
				<label class="form-label" for="create-end-date">end date</label>
				<input
					id="create-end-date"
					class="form-input"
					type="date"
					bind:value={formRecurringEndDate}
				/>
			</div>
		{/if}

		{#if formType === "deposit"}
			<div class="form-row">
				<div class="form-group">
					<label class="form-label" for="create-deposit-pct"
						>deposit %</label
					>
					<input
						id="create-deposit-pct"
						class="form-input"
						type="number"
						min="1"
						max="100"
						step="1"
						bind:value={formDepositPercent}
					/>
				</div>
				<div class="form-group">
					<label class="form-label" for="create-total-project"
						>total project cost ($)</label
					>
					<input
						id="create-total-project"
						class="form-input"
						type="number"
						min="0"
						step="0.01"
						bind:value={formTotalProject}
					/>
				</div>
			</div>
			{#if formTotalProject > 0}
				<div class="deposit-calc">
					deposit amount: {formatCents(depositTotal)} of {formatCents(
						dollarsToCents(formTotalProject),
					)}
				</div>
			{/if}
		{/if}

		{#if formType === "milestone"}
			<div class="form-row">
				<div class="form-group">
					<label class="form-label" for="create-milestone-name"
						>milestone name</label
					>
					<input
						id="create-milestone-name"
						class="form-input"
						type="text"
						placeholder="e.g. design phase"
						bind:value={formMilestoneName}
					/>
				</div>
				<div class="form-group">
					<label class="form-label" for="create-milestone-index"
						>milestone number</label
					>
					<div class="milestone-row">
						<input
							id="create-milestone-index"
							class="form-input milestone-num"
							type="number"
							min="1"
							step="1"
							bind:value={formMilestoneIndex}
						/>
						<span class="milestone-of">of</span>
						<input
							class="form-input milestone-num"
							type="number"
							min="1"
							step="1"
							bind:value={formMilestoneTotal}
						/>
					</div>
				</div>
			</div>
			<div class="form-group">
				<label class="form-label" for="create-parent-invoice"
					>parent invoice</label
				>
				<select
					id="create-parent-invoice"
					class="form-input"
					bind:value={formParentInvoiceId}
				>
					<option value="">none</option>
					{#each invoices as inv (inv._id)}
						<option value={inv._id}
							>{inv.invoiceNumber} — {inv.clientName}</option
						>
					{/each}
				</select>
			</div>
		{/if}

		<LineItemEditor
			items={formItems}
			onitems={(v) => {
				formItems = v;
			}}
			formatTotal={(n) => formatCents(dollarsToCents(n))}
			convertPrice={dollarsToCents}
			required
		/>

		<div class="form-row">
			<div class="form-group">
				<label class="form-label" for="create-tax">tax %</label>
				<input
					id="create-tax"
					class="form-input"
					type="number"
					min="0"
					step="0.1"
					bind:value={formTaxPercent}
				/>
			</div>
			<div class="form-group">
				<label class="form-label" for="create-due">due date</label>
				<input
					id="create-due"
					class="form-input"
					type="date"
					bind:value={formDueDate}
				/>
			</div>
		</div>

		<div class="form-group">
			<label class="form-label" for="create-notes">notes</label>
			<textarea
				id="create-notes"
				class="form-input form-textarea"
				bind:value={formNotes}
				rows="2"
				placeholder="additional notes..."
			></textarea>
		</div>

		<div class="totals-line">
			{#if formType === "deposit" && formTotalProject > 0}
				<span
					>deposit ({formDepositPercent}%): {formatCents(
						depositTotal,
					)}</span
				>
			{:else}
				<span>subtotal: {formatCents(createSubtotal)}</span>
				{#if formTaxPercent > 0}
					<span class="stat-sep">&middot;</span>
					<span>tax: {formatCents(createTax)}</span>
				{/if}
				<span class="stat-sep">&middot;</span>
				<span class="total-amount"
					>total: {formatCents(createTotal)}</span
				>
			{/if}
		</div>

		<div class="modal-actions">
			<button type="button" class="btn-cancel" onclick={onclose}
				>cancel</button
			>
			<button
				type="submit"
				class="btn-save"
				disabled={saving ||
					!formNumber ||
					!formClientId ||
					formItems.length === 0}
			>
				{saving ? "saving..." : "save as draft"}
			</button>
		</div>
	</form>
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

	.deposit-calc {
		font-size: 0.82rem;
		color: var(--admin-text-muted);
	}

	.milestone-row {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.milestone-num {
		flex: 0 0 60px;
		text-align: center;
	}

	.milestone-of {
		font-size: 0.8rem;
		color: var(--admin-text-subtle);
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

	.btn-cancel,
	.btn-save {
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

	@media (max-width: 768px) {
		.form-row {
			grid-template-columns: 1fr;
		}

		.modal-form {
			padding: 0 20px 20px;
		}
	}
</style>
