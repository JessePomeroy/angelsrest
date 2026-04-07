<script lang="ts">
import AdminModal from "$lib/admin/components/AdminModal.svelte";
import type { ClientCategory } from "$lib/admin/types";

interface Props {
	saving: boolean;
	onsave: (data: Record<string, string | undefined>) => void;
	onclose: () => void;
}

let { saving, onsave, onclose }: Props = $props();

let formName = $state("");
let formEmail = $state("");
let formPhone = $state("");
let formCategory = $state<ClientCategory>("photography");
let formType = $state("");
let formClientWebsite = $state("");
let formSource = $state("");
let formNotes = $state("");

const photographyTypes = [
	"wedding",
	"portrait",
	"family",
	"commercial",
	"event",
];
const webTypes = ["website", "redesign", "maintenance", "other"];
const sources = ["referral", "instagram", "website", "word of mouth", "other"];

function formatType(type: string) {
	return type.charAt(0).toUpperCase() + type.slice(1);
}

function handleSubmit() {
	if (!formName || !formCategory) return;
	const body: Record<string, string | undefined> = {
		name: formName,
		category: formCategory,
		email: formEmail || undefined,
		phone: formPhone || undefined,
		type: formType || undefined,
		source: formSource || undefined,
		notes: formNotes || undefined,
	};
	if (formCategory === "web" && formClientWebsite) {
		body.siteUrl_client = formClientWebsite;
	}
	onsave(body);
}
</script>

<AdminModal title="add client" onclose={onclose}>
	<form class="modal-form" onsubmit={(e) => { e.preventDefault(); handleSubmit(); }}>
		<div class="form-group">
			<label class="form-label" for="add-name">name <span class="required">*</span></label>
			<input id="add-name" class="form-input" type="text" bind:value={formName} required />
		</div>
		<div class="form-row">
			<div class="form-group">
				<label class="form-label" for="add-email">email</label>
				<input id="add-email" class="form-input" type="email" bind:value={formEmail} />
			</div>
			<div class="form-group">
				<label class="form-label" for="add-phone">phone</label>
				<input id="add-phone" class="form-input" type="tel" bind:value={formPhone} />
			</div>
		</div>
		<div class="form-row">
			<div class="form-group">
				<label class="form-label" for="add-category">category <span class="required">*</span></label>
				<select id="add-category" class="form-input" bind:value={formCategory} onchange={() => { formType = ""; }}>
					<option value="photography">photography</option>
					<option value="web">web</option>
				</select>
			</div>
			<div class="form-group">
				<label class="form-label" for="add-type">type</label>
				<select id="add-type" class="form-input" bind:value={formType}>
					<option value="">select type...</option>
					{#each formCategory === "photography" ? photographyTypes : webTypes as t}
						<option value={t}>{formatType(t)}</option>
					{/each}
				</select>
			</div>
		</div>
		{#if formCategory === "web"}
			<div class="form-group">
				<label class="form-label" for="add-website">client website</label>
				<input id="add-website" class="form-input" type="url" placeholder="https://" bind:value={formClientWebsite} />
			</div>
		{/if}
		<div class="form-group">
			<label class="form-label" for="add-source">source</label>
			<select id="add-source" class="form-input" bind:value={formSource}>
				<option value="">select source...</option>
				{#each sources as s}
					<option value={s}>{formatType(s)}</option>
				{/each}
			</select>
		</div>
		<div class="form-group">
			<label class="form-label" for="add-notes">notes</label>
			<textarea id="add-notes" class="form-input form-textarea" bind:value={formNotes} rows="3" placeholder="additional notes..."></textarea>
		</div>
		<div class="modal-actions">
			<button type="button" class="btn-cancel" onclick={onclose}>cancel</button>
			<button type="submit" class="btn-save" disabled={saving || !formName}>
				{saving ? "saving..." : "save client"}
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
