<script lang="ts">
import AdminModal from "$lib/admin/components/AdminModal.svelte";
import type { ContractTemplate } from "$lib/admin/types";

interface Props {
	templates: ContractTemplate[];
	showCreateModal: boolean;
	onsave: (
		id: string | null,
		payload: Record<string, unknown>,
	) => Promise<void>;
	ondelete: (id: string) => Promise<void>;
	onclosecreate: () => void;
}

let { templates, showCreateModal, onsave, ondelete, onclosecreate }: Props =
	$props();

let showModal = $state(false);
let selectedTemplate = $state<ContractTemplate | null>(null);
let confirmDeleteTemplate = $state(false);
let saving = $state(false);

let tplName = $state("");
let tplBody = $state("");
let tplVariables = $state("");

$effect(() => {
	if (showCreateModal && !showModal) {
		openModal();
	}
});

function openModal(template?: ContractTemplate) {
	if (template) {
		selectedTemplate = { ...template };
		tplName = template.name;
		tplBody = template.body;
		tplVariables = (template.variables || []).join(", ");
	} else {
		selectedTemplate = null;
		tplName = "";
		tplBody = "";
		tplVariables = "";
	}
	confirmDeleteTemplate = false;
	showModal = true;
}

function closeModal() {
	showModal = false;
	selectedTemplate = null;
	confirmDeleteTemplate = false;
	onclosecreate();
}

async function handleSave() {
	if (!tplName || !tplBody) return;
	saving = true;
	try {
		const variables = tplVariables
			.split(",")
			.map((v) => v.trim())
			.filter(Boolean);
		const payload: Record<string, unknown> = {
			_type: "template",
			name: tplName,
			body: tplBody,
			variables: variables.length ? variables : undefined,
		};
		await onsave(selectedTemplate?._id ?? null, payload);
		closeModal();
	} finally {
		saving = false;
	}
}

async function handleDelete() {
	if (!selectedTemplate) return;
	saving = true;
	try {
		await ondelete(selectedTemplate._id);
		closeModal();
	} finally {
		saving = false;
	}
}
</script>

{#if templates.length === 0}
	<div class="empty-state">no templates yet</div>
{:else}
	<div class="templates-list">
		{#each templates as template (template._id)}
			<button
				class="template-item"
				onclick={() => openModal(template)}
			>
				<span class="template-name">{template.name}</span>
				{#if template.variables?.length}
					<span class="template-vars"
						>{template.variables.length} variable{template
							.variables.length !== 1
							? "s"
							: ""}</span
					>
				{/if}
			</button>
		{/each}
	</div>
{/if}

{#if showModal}
	<AdminModal
		title={selectedTemplate ? "edit template" : "new template"}
		onclose={closeModal}
		size="wide"
	>
		<form
			class="modal-form"
			onsubmit={(e) => {
				e.preventDefault();
				handleSave();
			}}
		>
			<div class="form-group">
				<label class="form-label" for="tpl-name"
					>name <span class="required">*</span></label
				>
				<input
					id="tpl-name"
					class="form-input"
					type="text"
					placeholder="e.g. standard wedding contract"
					bind:value={tplName}
					required
				/>
			</div>

			<div class="form-group">
				<label class="form-label" for="tpl-body"
					>body <span class="required">*</span></label
				>
				<textarea
					id="tpl-body"
					class="form-input form-textarea form-textarea-large"
					bind:value={tplBody}
					rows="10"
					placeholder={"contract template text... use {{clientName}}, {{eventDate}}, {{totalPrice}} as variables"}
					required
				></textarea>
			</div>

			<div class="form-group">
				<label class="form-label" for="tpl-variables"
					>variables (comma-separated)</label
				>
				<input
					id="tpl-variables"
					class="form-input"
					type="text"
					placeholder="clientName, eventDate, totalPrice"
					bind:value={tplVariables}
				/>
			</div>

			<div class="modal-actions">
				{#if confirmDeleteTemplate && selectedTemplate}
					<span class="confirm-text">delete this template?</span>
					<button
						type="button"
						class="btn-danger"
						onclick={handleDelete}
						disabled={saving}
					>
						{saving ? "deleting..." : "yes, delete"}
					</button>
					<button
						type="button"
						class="btn-cancel"
						onclick={() => {
							confirmDeleteTemplate = false;
						}}>no</button
					>
				{:else}
					{#if selectedTemplate}
						<button
							type="button"
							class="btn-danger-outline"
							onclick={() => {
								confirmDeleteTemplate = true;
							}}>delete</button
						>
					{/if}
					<button
						type="button"
						class="btn-cancel"
						onclick={closeModal}>cancel</button
					>
					<button
						type="submit"
						class="btn-save"
						disabled={saving || !tplName || !tplBody}
					>
						{saving
							? "saving..."
							: selectedTemplate
								? "save changes"
								: "create template"}
					</button>
				{/if}
			</div>
		</form>
	</AdminModal>
{/if}

<style>
	.templates-list {
		display: flex;
		flex-direction: column;
		gap: 1px;
	}

	.template-item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 14px 0;
		background: none;
		border: none;
		border-bottom: 1px solid var(--admin-border);
		cursor: pointer;
		text-align: left;
		width: 100%;
		transition: background 0.12s;
		font-family: "Synonym", system-ui, sans-serif;
	}

	.template-item:hover {
		background: var(--admin-active);
	}

	.template-name {
		font-size: 0.88rem;
		color: var(--admin-heading);
		font-weight: 500;
	}

	.template-vars {
		font-size: 0.78rem;
		color: var(--admin-text-subtle);
	}

	.empty-state {
		padding: 48px 0;
		color: var(--admin-text-subtle);
		font-size: 0.88rem;
	}

	.modal-form {
		padding: 0 28px 28px;
		display: flex;
		flex-direction: column;
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
	.btn-save,
	.btn-danger,
	.btn-danger-outline {
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

	@media (max-width: 768px) {
		.modal-form {
			padding: 0 20px 20px;
		}

		.template-item {
			flex-direction: column;
			align-items: flex-start;
			gap: 6px;
		}
	}
</style>
