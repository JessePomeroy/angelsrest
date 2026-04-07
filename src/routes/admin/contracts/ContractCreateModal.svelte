<script lang="ts">
import AdminModal from "$lib/admin/components/AdminModal.svelte";
import type { Client, ContractTemplate } from "$lib/admin/types";
import { dollarsToCents } from "$lib/admin/utils";

interface Props {
	clients: Client[];
	templates: ContractTemplate[];
	onsave: (payload: Record<string, unknown>) => Promise<void>;
	onclose: () => void;
}

let { clients, templates, onsave, onclose }: Props = $props();

let formTitle = $state("");
let formClientId = $state("");
let formCategory = $state<"photography" | "web">("photography");
let formTemplateId = $state("");
let formBody = $state("");
let formEventDate = $state("");
let formEventLocation = $state("");
let formTotalPrice = $state(0);
let formDepositAmount = $state(0);
let saving = $state(false);

function onTemplateSelect() {
	if (!formTemplateId) return;
	const tpl = templates.find((t) => t._id === formTemplateId);
	if (tpl) {
		formBody = tpl.body;
	}
}

async function handleSubmit() {
	if (!formTitle || !formClientId || !formBody) return;
	saving = true;
	try {
		const payload: Record<string, unknown> = {
			title: formTitle,
			clientId: formClientId,
			category: formCategory,
			body: formBody,
		};
		if (formTemplateId) payload.templateId = formTemplateId;
		if (formEventDate) payload.eventDate = formEventDate;
		if (formEventLocation) payload.eventLocation = formEventLocation;
		if (formTotalPrice > 0) payload.totalPrice = dollarsToCents(formTotalPrice);
		if (formDepositAmount > 0)
			payload.depositAmount = dollarsToCents(formDepositAmount);
		await onsave(payload);
	} finally {
		saving = false;
	}
}
</script>

<AdminModal title="new contract" onclose={onclose} size="wide">
	<form
		class="modal-form"
		onsubmit={(e) => {
			e.preventDefault();
			handleSubmit();
		}}
	>
		<div class="form-group">
			<label class="form-label" for="create-title"
				>title <span class="required">*</span></label
			>
			<input
				id="create-title"
				class="form-input"
				type="text"
				placeholder="e.g. wedding photography contract"
				bind:value={formTitle}
				required
			/>
		</div>

		<div class="form-row">
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
			<div class="form-group">
				<label class="form-label" for="create-category">category</label
				>
				<select
					id="create-category"
					class="form-input"
					bind:value={formCategory}
				>
					<option value="photography">photography</option>
					<option value="web">web</option>
				</select>
			</div>
		</div>

		<div class="form-group">
			<label class="form-label" for="create-template">template</label>
			<select
				id="create-template"
				class="form-input"
				bind:value={formTemplateId}
				onchange={onTemplateSelect}
			>
				<option value="">none</option>
				{#each templates as tpl (tpl._id)}
					<option value={tpl._id}>{tpl.name}</option>
				{/each}
			</select>
		</div>

		<div class="form-group">
			<label class="form-label" for="create-body"
				>body <span class="required">*</span></label
			>
			<textarea
				id="create-body"
				class="form-input form-textarea form-textarea-large"
				bind:value={formBody}
				rows="10"
				placeholder={"contract text... use {{clientName}}, {{eventDate}}, {{totalPrice}} as template variables"}
				required
			></textarea>
		</div>

		<div class="form-row">
			<div class="form-group">
				<label class="form-label" for="create-event-date"
					>event date</label
				>
				<input
					id="create-event-date"
					class="form-input"
					type="date"
					bind:value={formEventDate}
				/>
			</div>
			<div class="form-group">
				<label class="form-label" for="create-event-location"
					>event location</label
				>
				<input
					id="create-event-location"
					class="form-input"
					type="text"
					placeholder="e.g. portland, or"
					bind:value={formEventLocation}
				/>
			</div>
		</div>

		<div class="form-row">
			<div class="form-group">
				<label class="form-label" for="create-total-price"
					>total price ($)</label
				>
				<input
					id="create-total-price"
					class="form-input"
					type="number"
					min="0"
					step="0.01"
					bind:value={formTotalPrice}
				/>
			</div>
			<div class="form-group">
				<label class="form-label" for="create-deposit"
					>deposit amount ($)</label
				>
				<input
					id="create-deposit"
					class="form-input"
					type="number"
					min="0"
					step="0.01"
					bind:value={formDepositAmount}
				/>
			</div>
		</div>

		<div class="modal-actions">
			<button type="button" class="btn-cancel" onclick={onclose}
				>cancel</button
			>
			<button
				type="submit"
				class="btn-save"
				disabled={saving || !formTitle || !formClientId || !formBody}
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

	.form-textarea-large {
		min-height: 180px;
		line-height: 1.6;
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
