<script lang="ts">
import SEO from "$lib/components/SEO.svelte";

let { data } = $props();

// Categories
const categories = [
	"inquiry-reply",
	"booking-confirmation",
	"reminder",
	"gallery-delivery",
	"follow-up",
	"thank-you",
	"custom",
] as const;

type Category = (typeof categories)[number];

const commonVariables = [
	"{{clientName}}",
	"{{clientEmail}}",
	"{{eventDate}}",
	"{{eventLocation}}",
	"{{galleryLink}}",
	"{{invoiceLink}}",
	"{{totalPrice}}",
	"{{depositAmount}}",
	"{{bookingDate}}",
];

// Filter state
let categoryFilter = $state("all");
let searchQuery = $state("");

// Modal state
let showCreateModal = $state(false);
let selectedTemplate = $state<any>(null);
let editMode = $state(false);
let confirmDelete = $state(false);
let saving = $state(false);

// Create form state
let formName = $state("");
let formCategory = $state<Category>("inquiry-reply");
let formSubject = $state("");
let formBody = $state("");
let formVariables = $state("");

// Edit form state
let editName = $state("");
let editCategory = $state<Category>("inquiry-reply");
let editSubject = $state("");
let editBody = $state("");
let editVariables = $state("");

let filteredTemplates = $derived(
	data.templates.filter((t: any) => {
		if (categoryFilter !== "all" && t.category !== categoryFilter) return false;
		if (searchQuery) {
			const q = searchQuery.toLowerCase();
			const matchName = t.name?.toLowerCase().includes(q);
			const matchSubject = t.subject?.toLowerCase().includes(q);
			if (!matchName && !matchSubject) return false;
		}
		return true;
	}),
);

function getCategoryColor(category: string): string {
	const colors: Record<string, string> = {
		"inquiry-reply": "var(--status-lavender)",
		"booking-confirmation": "var(--status-sage)",
		reminder: "var(--status-amber)",
		"gallery-delivery": "var(--status-peach)",
		"follow-up": "var(--status-slate)",
		"thank-you": "var(--status-sage)",
		custom: "var(--admin-text-subtle)",
	};
	return colors[category] || "var(--admin-text-subtle)";
}

function countVariables(body: string): number {
	const matches = body.match(/\{\{[^}]+\}\}/g);
	return matches ? matches.length : 0;
}

function highlightVariables(text: string): string {
	return text.replace(
		/(\{\{[^}]+\}\})/g,
		'<span class="var-highlight">$1</span>',
	);
}

// Create modal
function resetCreateForm() {
	formName = "";
	formCategory = "inquiry-reply";
	formSubject = "";
	formBody = "";
	formVariables = "";
}

function openCreateModal() {
	resetCreateForm();
	showCreateModal = true;
}

function closeCreateModal() {
	showCreateModal = false;
}

function parseVariables(input: string): string[] {
	return input
		.split(",")
		.map((v) => v.trim())
		.filter(Boolean);
}

async function saveNewTemplate() {
	if (!formName || !formCategory || !formSubject || !formBody) return;
	saving = true;
	try {
		const variables = parseVariables(formVariables);
		const res = await fetch("/api/admin/emails", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				name: formName,
				category: formCategory,
				subject: formSubject,
				body: formBody,
				variables: variables.length ? variables : undefined,
			}),
		});
		if (res.ok) {
			closeCreateModal();
			window.location.reload();
		}
	} catch (err) {
		console.error("Failed to create email template:", err);
	} finally {
		saving = false;
	}
}

// Detail modal
function openDetailModal(template: any) {
	selectedTemplate = { ...template };
	editMode = false;
	confirmDelete = false;
}

function closeDetailModal() {
	selectedTemplate = null;
	editMode = false;
	confirmDelete = false;
}

function startEdit() {
	if (!selectedTemplate) return;
	editName = selectedTemplate.name;
	editCategory = selectedTemplate.category;
	editSubject = selectedTemplate.subject;
	editBody = selectedTemplate.body;
	editVariables = (selectedTemplate.variables || []).join(", ");
	editMode = true;
}

function cancelEdit() {
	editMode = false;
}

async function saveEdit() {
	if (!selectedTemplate || !editName || !editSubject || !editBody) return;
	saving = true;
	try {
		const variables = parseVariables(editVariables);
		const res = await fetch(`/api/admin/emails/${selectedTemplate._id}`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				name: editName,
				category: editCategory,
				subject: editSubject,
				body: editBody,
				variables: variables.length ? variables : undefined,
			}),
		});
		if (res.ok) {
			const idx = data.templates.findIndex(
				(t: any) => t._id === selectedTemplate._id,
			);
			if (idx !== -1) {
				data.templates[idx] = {
					...data.templates[idx],
					name: editName,
					category: editCategory,
					subject: editSubject,
					body: editBody,
					variables: variables.length ? variables : undefined,
				};
				data.templates = [...data.templates];
			}
			selectedTemplate = {
				...selectedTemplate,
				name: editName,
				category: editCategory,
				subject: editSubject,
				body: editBody,
				variables: variables.length ? variables : undefined,
			};
			editMode = false;
		}
	} catch (err) {
		console.error("Failed to update email template:", err);
	} finally {
		saving = false;
	}
}

async function deleteTemplate() {
	if (!selectedTemplate) return;
	saving = true;
	try {
		const res = await fetch(`/api/admin/emails/${selectedTemplate._id}`, {
			method: "DELETE",
		});
		if (res.ok) {
			data.templates = data.templates.filter(
				(t: any) => t._id !== selectedTemplate._id,
			);
			closeDetailModal();
		}
	} catch (err) {
		console.error("Failed to delete email template:", err);
	} finally {
		saving = false;
	}
}
</script>

<SEO title="Email Templates | Admin" description="Manage email templates" />

<div class="emails-page">
	<header class="page-header">
		<div class="header-left">
			<h1>email templates</h1>
			<span class="template-count">{data.templates.length} template{data.templates.length !== 1 ? "s" : ""}</span>
		</div>
		<button class="btn-add" onclick={openCreateModal}>
			<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
			new template
		</button>
	</header>

	<div class="filter-bar">
		<select class="filter-select" bind:value={categoryFilter}>
			<option value="all">all categories</option>
			{#each categories as cat}
				<option value={cat}>{cat}</option>
			{/each}
		</select>
		<input
			class="filter-search"
			type="text"
			placeholder="search by name or subject..."
			bind:value={searchQuery}
		/>
	</div>

	{#if filteredTemplates.length === 0}
		<div class="empty-state">no email templates found</div>
	{:else}
		<div class="templates-list">
			{#each filteredTemplates as template (template._id)}
				<button
					class="template-item"
					onclick={() => openDetailModal(template)}
				>
					<div class="template-info">
						<span class="template-name">{template.name}</span>
						<span class="template-subject">{template.subject}</span>
					</div>
					<div class="template-meta">
						<span class="category-label" style="color: {getCategoryColor(template.category)}">
							<span class="category-dot" style="background: {getCategoryColor(template.category)}"></span>
							{template.category}
						</span>
						{#if countVariables(template.body) > 0}
							<span class="template-vars">{countVariables(template.body)} var{countVariables(template.body) !== 1 ? "s" : ""}</span>
						{/if}
					</div>
				</button>
			{/each}
		</div>
	{/if}
</div>

<!-- Create Modal -->
{#if showCreateModal}
	<div
		class="modal-overlay"
		role="dialog"
		tabindex="-1"
		aria-modal="true"
		aria-label="Create email template"
		onclick={closeCreateModal}
		onkeydown={(e) => { if (e.key === "Escape") closeCreateModal(); }}
	>
		<div
			class="modal-content modal-wide"
			role="presentation"
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => e.stopPropagation()}
		>
			<div class="modal-header">
				<h2 class="modal-title">new email template</h2>
				<button class="modal-close" aria-label="Close" onclick={closeCreateModal}>
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
				</button>
			</div>

			<form
				class="modal-form"
				onsubmit={(e) => { e.preventDefault(); saveNewTemplate(); }}
			>
				<div class="form-row">
					<div class="form-group">
						<label class="form-label" for="create-name">name <span class="required">*</span></label>
						<input id="create-name" class="form-input" type="text" placeholder="e.g. wedding inquiry reply" bind:value={formName} required />
					</div>
					<div class="form-group">
						<label class="form-label" for="create-category">category <span class="required">*</span></label>
						<select id="create-category" class="form-input" bind:value={formCategory} required>
							{#each categories as cat}
								<option value={cat}>{cat}</option>
							{/each}
						</select>
					</div>
				</div>

				<div class="form-group">
					<label class="form-label" for="create-subject">subject line <span class="required">*</span></label>
					<input id="create-subject" class="form-input" type="text" placeholder="e.g. re: your photography inquiry" bind:value={formSubject} required />
				</div>

				<div class="form-group">
					<label class="form-label" for="create-body">body <span class="required">*</span></label>
					<textarea
						id="create-body"
						class="form-input form-textarea form-textarea-large"
						bind:value={formBody}
						rows="10"
						placeholder={"hi {{clientName}},\n\nthank you for reaching out..."}
						required
					></textarea>
				</div>

				<div class="form-group">
					<label class="form-label" for="create-variables">custom variables (comma-separated)</label>
					<input id="create-variables" class="form-input" type="text" placeholder="customField1, customField2" bind:value={formVariables} />
				</div>

				<div class="variables-ref">
					<span class="variables-ref-label">available variables:</span>
					<div class="variables-ref-list">
						{#each commonVariables as v}
							<span class="variable-tag">{v}</span>
						{/each}
					</div>
				</div>

				{#if formBody}
					<div class="preview-section">
						<span class="preview-label">preview</span>
						<div class="preview-body">{@html highlightVariables(formBody)}</div>
					</div>
				{/if}

				<div class="modal-actions">
					<button type="button" class="btn-cancel" onclick={closeCreateModal}>cancel</button>
					<button type="submit" class="btn-save" disabled={saving || !formName || !formSubject || !formBody}>
						{saving ? "saving..." : "create template"}
					</button>
				</div>
			</form>
		</div>
	</div>
{/if}

<!-- Detail / Edit Modal -->
{#if selectedTemplate}
	<div
		class="modal-overlay"
		role="dialog"
		tabindex="-1"
		aria-modal="true"
		aria-label="Email template details"
		onclick={closeDetailModal}
		onkeydown={(e) => { if (e.key === "Escape") closeDetailModal(); }}
	>
		<div
			class="modal-content modal-wide"
			role="presentation"
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => e.stopPropagation()}
		>
			<div class="modal-header">
				<h2 class="modal-title">
					{editMode ? "edit template" : selectedTemplate.name}
				</h2>
				<button class="modal-close" aria-label="Close" onclick={closeDetailModal}>
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
				</button>
			</div>

			{#if editMode}
				<form
					class="modal-form"
					onsubmit={(e) => { e.preventDefault(); saveEdit(); }}
				>
					<div class="form-row">
						<div class="form-group">
							<label class="form-label" for="edit-name">name <span class="required">*</span></label>
							<input id="edit-name" class="form-input" type="text" bind:value={editName} required />
						</div>
						<div class="form-group">
							<label class="form-label" for="edit-category">category <span class="required">*</span></label>
							<select id="edit-category" class="form-input" bind:value={editCategory} required>
								{#each categories as cat}
									<option value={cat}>{cat}</option>
								{/each}
							</select>
						</div>
					</div>

					<div class="form-group">
						<label class="form-label" for="edit-subject">subject line <span class="required">*</span></label>
						<input id="edit-subject" class="form-input" type="text" bind:value={editSubject} required />
					</div>

					<div class="form-group">
						<label class="form-label" for="edit-body">body <span class="required">*</span></label>
						<textarea
							id="edit-body"
							class="form-input form-textarea form-textarea-large"
							bind:value={editBody}
							rows="10"
							required
						></textarea>
					</div>

					<div class="form-group">
						<label class="form-label" for="edit-variables">custom variables (comma-separated)</label>
						<input id="edit-variables" class="form-input" type="text" bind:value={editVariables} />
					</div>

					<div class="variables-ref">
						<span class="variables-ref-label">available variables:</span>
						<div class="variables-ref-list">
							{#each commonVariables as v}
								<span class="variable-tag">{v}</span>
							{/each}
						</div>
					</div>

					{#if editBody}
						<div class="preview-section">
							<span class="preview-label">preview</span>
							<div class="preview-body">{@html highlightVariables(editBody)}</div>
						</div>
					{/if}

					<div class="modal-actions">
						<button type="button" class="btn-cancel" onclick={cancelEdit}>cancel</button>
						<button type="submit" class="btn-save" disabled={saving || !editName || !editSubject || !editBody}>
							{saving ? "saving..." : "save changes"}
						</button>
					</div>
				</form>
			{:else}
				<div class="detail-body">
					<div class="detail-meta-line">
						<span class="category-label" style="color: {getCategoryColor(selectedTemplate.category)}">
							<span class="category-dot" style="background: {getCategoryColor(selectedTemplate.category)}"></span>
							{selectedTemplate.category}
						</span>
					</div>

					<div class="detail-field">
						<span class="detail-label">subject</span>
						<span class="detail-value">{selectedTemplate.subject}</span>
					</div>

					<div class="detail-fields">
						<div class="detail-field">
							<span class="detail-label">body</span>
							<div class="detail-body-text">{@html highlightVariables(selectedTemplate.body)}</div>
						</div>

						{#if selectedTemplate.variables?.length}
							<div class="detail-field">
								<span class="detail-label">custom variables</span>
								<div class="variables-ref-list">
									{#each selectedTemplate.variables as v}
										<span class="variable-tag">{v}</span>
									{/each}
								</div>
							</div>
						{/if}
					</div>

					<div class="modal-actions detail-actions">
						{#if confirmDelete}
							<span class="confirm-text">delete this template?</span>
							<button class="btn-danger" onclick={deleteTemplate} disabled={saving}>
								{saving ? "deleting..." : "yes, delete"}
							</button>
							<button class="btn-cancel" onclick={() => { confirmDelete = false; }}>no</button>
						{:else}
							<button class="btn-danger-outline" onclick={() => { confirmDelete = true; }}>delete</button>
							<button class="btn-cancel" onclick={startEdit}>edit</button>
						{/if}
					</div>
				</div>
			{/if}
		</div>
	</div>
{/if}

<style>
	.emails-page {
		padding: 48px 40px;
		max-width: 1200px;
	}

	.page-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		margin-bottom: 24px;
		gap: 1rem;
	}

	.header-left {
		display: flex;
		align-items: baseline;
		gap: 12px;
	}

	.page-header h1 {
		font-family: "Chillax", sans-serif;
		font-size: 1.8rem;
		font-weight: 500;
		color: var(--admin-heading);
		margin: 0;
		letter-spacing: -0.01em;
	}

	.template-count {
		font-size: 0.82rem;
		color: var(--admin-text-muted);
	}

	.btn-add {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 7px 14px;
		background: transparent;
		color: var(--admin-text);
		border: 1px solid var(--admin-border-strong);
		border-radius: 6px;
		font-size: 0.82rem;
		font-family: "Synonym", system-ui, sans-serif;
		cursor: pointer;
		transition: color 0.15s, border-color 0.15s;
		white-space: nowrap;
	}

	.btn-add:hover {
		color: var(--admin-heading);
		border-color: var(--admin-text-muted);
	}

	/* Filter bar */
	.filter-bar {
		display: flex;
		gap: 10px;
		margin-bottom: 24px;
		flex-wrap: wrap;
	}

	.filter-select,
	.filter-search {
		padding: 7px 12px;
		background: transparent;
		color: var(--admin-text);
		border: 1px solid var(--admin-border-strong);
		border-radius: 6px;
		font-size: 0.83rem;
		font-family: "Synonym", system-ui, sans-serif;
		outline: none;
		transition: border-color 0.15s;
	}

	.filter-select:focus,
	.filter-search:focus {
		border-color: var(--admin-accent);
	}

	.filter-search {
		flex: 1;
		min-width: 180px;
	}

	/* Templates list */
	.templates-list {
		display: flex;
		flex-direction: column;
		gap: 1px;
	}

	.template-item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		padding: 16px 0;
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

	.template-info {
		display: flex;
		flex-direction: column;
		gap: 3px;
		min-width: 0;
	}

	.template-name {
		font-size: 0.88rem;
		color: var(--admin-heading);
		font-weight: 500;
	}

	.template-subject {
		font-size: 0.8rem;
		color: var(--admin-text-muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.template-meta {
		display: flex;
		align-items: center;
		gap: 12px;
		flex-shrink: 0;
	}

	.category-label {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 0.78rem;
	}

	.category-dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		flex-shrink: 0;
	}

	.template-vars {
		font-size: 0.76rem;
		color: var(--admin-text-subtle);
	}

	/* Empty state */
	.empty-state {
		padding: 48px 0;
		color: var(--admin-text-subtle);
		font-size: 0.88rem;
	}

	/* Variables reference */
	.variables-ref {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.variables-ref-label {
		font-size: 0.74rem;
		color: var(--admin-text-subtle);
		letter-spacing: 0.02em;
	}

	.variables-ref-list {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}

	.variable-tag {
		display: inline-block;
		padding: 3px 8px;
		background: rgba(129, 140, 248, 0.08);
		border: 1px solid rgba(129, 140, 248, 0.15);
		border-radius: 4px;
		font-size: 0.74rem;
		color: var(--admin-accent);
		font-family: "Synonym", monospace;
	}

	/* Preview */
	.preview-section {
		display: flex;
		flex-direction: column;
		gap: 6px;
		border-top: 1px solid var(--admin-border);
		padding-top: 14px;
	}

	.preview-label {
		font-size: 0.74rem;
		color: var(--admin-text-subtle);
		letter-spacing: 0.02em;
	}

	.preview-body {
		white-space: pre-wrap;
		line-height: 1.6;
		font-size: 0.85rem;
		color: var(--admin-text);
		max-height: 200px;
		overflow-y: auto;
		padding: 8px 0;
	}

	.preview-body :global(.var-highlight) {
		color: var(--admin-accent);
		background: rgba(129, 140, 248, 0.08);
		padding: 1px 3px;
		border-radius: 3px;
	}

	/* Modal */
	.modal-overlay {
		position: fixed;
		inset: 0;
		z-index: 100;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(0, 0, 0, 0.4);
		backdrop-filter: blur(8px);
		padding: 1rem;
	}

	.modal-content {
		background: var(--admin-bg, #1e293b);
		border: 1px solid var(--admin-border);
		border-radius: 12px;
		width: 100%;
		max-width: 540px;
		max-height: 90vh;
		overflow-y: auto;
		box-shadow: 0 24px 80px rgba(0, 0, 0, 0.5);
	}

	.modal-wide {
		max-width: 660px;
	}

	.modal-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 24px 28px 20px;
	}

	.modal-title {
		font-family: "Chillax", sans-serif;
		font-size: 1.1rem;
		font-weight: 500;
		color: var(--admin-heading);
		margin: 0;
	}

	.modal-close {
		background: none;
		border: none;
		color: var(--admin-text-muted);
		cursor: pointer;
		padding: 4px;
		border-radius: 4px;
		transition: color 0.15s;
	}

	.modal-close:hover {
		color: var(--admin-heading);
	}

	/* Form */
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

	/* Detail view */
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

	.detail-body-text :global(.var-highlight) {
		color: var(--admin-accent);
		background: rgba(129, 140, 248, 0.08);
		padding: 1px 3px;
		border-radius: 3px;
	}

	/* Actions */
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

	/* Responsive */
	@media (max-width: 768px) {
		.emails-page {
			padding: 28px 20px;
		}

		.page-header {
			flex-direction: column;
		}

		.header-left {
			flex-direction: column;
			gap: 4px;
		}

		.btn-add {
			align-self: flex-start;
		}

		.filter-bar {
			flex-direction: column;
		}

		.filter-search {
			min-width: unset;
		}

		.form-row {
			grid-template-columns: 1fr;
		}

		.modal-content {
			max-width: 100%;
		}

		.template-item {
			flex-direction: column;
			align-items: flex-start;
			gap: 8px;
		}
	}
</style>
