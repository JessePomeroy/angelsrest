<script lang="ts">
import FeatureGate from "$lib/admin/components/FeatureGate.svelte";
import SEO from "$lib/components/SEO.svelte";

let { data } = $props();

// Tab state
let activeTab = $state<"contracts" | "templates">("contracts");

// Filter state
let statusFilter = $state("all");
let searchQuery = $state("");

// Modal state
let showCreateModal = $state(false);
let selectedContract = $state<any>(null);
let editMode = $state(false);
let confirmDelete = $state(false);
let saving = $state(false);
let sending = $state(false);
let sendResult = $state<"success" | "error" | null>(null);

// Template modal state
let showTemplateModal = $state(false);
let selectedTemplate = $state<any>(null);
let confirmDeleteTemplate = $state(false);

// Create form state
let formTitle = $state("");
let formClientId = $state("");
let formCategory = $state<"photography" | "web">("photography");
let formTemplateId = $state("");
let formBody = $state("");
let formEventDate = $state("");
let formEventLocation = $state("");
let formTotalPrice = $state(0);
let formDepositAmount = $state(0);

// Edit form state
let editTitle = $state("");
let editBody = $state("");
let editEventDate = $state("");
let editEventLocation = $state("");
let editTotalPrice = $state(0);
let editDepositAmount = $state(0);

// Template form state
let tplName = $state("");
let tplBody = $state("");
let tplVariables = $state("");

const allStatuses = ["draft", "sent", "signed", "expired"];

let filteredContracts = $derived(
	data.contracts.filter((c: any) => {
		if (statusFilter !== "all" && c.status !== statusFilter) return false;
		if (searchQuery) {
			const q = searchQuery.toLowerCase();
			const matchTitle = c.title?.toLowerCase().includes(q);
			const matchClient = c.clientName?.toLowerCase().includes(q);
			if (!matchTitle && !matchClient) return false;
		}
		return true;
	}),
);

let stats = $derived({
	total: data.contracts.length,
	draft: data.contracts.filter((c: any) => c.status === "draft").length,
	sent: data.contracts.filter((c: any) => c.status === "sent").length,
	signed: data.contracts.filter((c: any) => c.status === "signed").length,
	expired: data.contracts.filter((c: any) => c.status === "expired").length,
});

function getStatusColor(status: string): string {
	const colors: Record<string, string> = {
		draft: "var(--admin-text-subtle)",
		sent: "var(--status-amber)",
		signed: "var(--status-sage)",
		expired: "var(--admin-text-subtle)",
	};
	return colors[status] || "var(--admin-text-subtle)";
}

function formatCents(cents: number): string {
	return `$${(cents / 100).toFixed(2)}`;
}

function dollarsToCents(dollars: number): number {
	return Math.round(dollars * 100);
}

function formatDate(dateStr: string): string {
	if (!dateStr) return "\u2014";
	const d = new Date(dateStr);
	return d.toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
		year: "numeric",
	});
}

function formatTimestamp(ts: number): string {
	return new Date(ts).toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
		year: "numeric",
	});
}

// Create modal
function resetCreateForm() {
	formTitle = "";
	formClientId = "";
	formCategory = "photography";
	formTemplateId = "";
	formBody = "";
	formEventDate = "";
	formEventLocation = "";
	formTotalPrice = 0;
	formDepositAmount = 0;
}

function openCreateModal() {
	resetCreateForm();
	showCreateModal = true;
}

function closeCreateModal() {
	showCreateModal = false;
}

function onTemplateSelect() {
	if (!formTemplateId) return;
	const tpl = data.templates.find((t: any) => t._id === formTemplateId);
	if (tpl) {
		formBody = tpl.body;
	}
}

async function saveNewContract() {
	if (!formTitle || !formClientId || !formBody) return;
	saving = true;
	try {
		const body: Record<string, unknown> = {
			title: formTitle,
			clientId: formClientId,
			category: formCategory,
			body: formBody,
		};
		if (formTemplateId) body.templateId = formTemplateId;
		if (formEventDate) body.eventDate = formEventDate;
		if (formEventLocation) body.eventLocation = formEventLocation;
		if (formTotalPrice > 0) body.totalPrice = dollarsToCents(formTotalPrice);
		if (formDepositAmount > 0)
			body.depositAmount = dollarsToCents(formDepositAmount);

		const res = await fetch("/api/admin/contracts", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});
		if (res.ok) {
			closeCreateModal();
			window.location.reload();
		}
	} catch (err) {
		console.error("Failed to create contract:", err);
	} finally {
		saving = false;
	}
}

// Detail modal
function openDetailModal(contract: any) {
	selectedContract = { ...contract };
	editMode = false;
	confirmDelete = false;
	sendResult = null;
}

function closeDetailModal() {
	selectedContract = null;
	editMode = false;
	confirmDelete = false;
	sendResult = null;
}

function startEdit() {
	if (!selectedContract) return;
	editTitle = selectedContract.title;
	editBody = selectedContract.body;
	editEventDate = selectedContract.eventDate || "";
	editEventLocation = selectedContract.eventLocation || "";
	editTotalPrice = selectedContract.totalPrice
		? selectedContract.totalPrice / 100
		: 0;
	editDepositAmount = selectedContract.depositAmount
		? selectedContract.depositAmount / 100
		: 0;
	editMode = true;
}

function cancelEdit() {
	editMode = false;
}

async function saveEdit() {
	if (!selectedContract || !editTitle || !editBody) return;
	saving = true;
	try {
		const body: Record<string, unknown> = {
			title: editTitle,
			body: editBody,
		};
		body.eventDate = editEventDate || undefined;
		body.eventLocation = editEventLocation || undefined;
		body.totalPrice =
			editTotalPrice > 0 ? dollarsToCents(editTotalPrice) : undefined;
		body.depositAmount =
			editDepositAmount > 0 ? dollarsToCents(editDepositAmount) : undefined;

		const res = await fetch(`/api/admin/contracts/${selectedContract._id}`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});
		if (res.ok) {
			const idx = data.contracts.findIndex(
				(c: any) => c._id === selectedContract._id,
			);
			if (idx !== -1) {
				data.contracts[idx] = {
					...data.contracts[idx],
					title: editTitle,
					body: editBody,
					eventDate: editEventDate || undefined,
					eventLocation: editEventLocation || undefined,
					totalPrice:
						editTotalPrice > 0 ? dollarsToCents(editTotalPrice) : undefined,
					depositAmount:
						editDepositAmount > 0
							? dollarsToCents(editDepositAmount)
							: undefined,
				};
				data.contracts = [...data.contracts];
			}
			selectedContract = {
				...selectedContract,
				title: editTitle,
				body: editBody,
				eventDate: editEventDate || undefined,
				eventLocation: editEventLocation || undefined,
				totalPrice:
					editTotalPrice > 0 ? dollarsToCents(editTotalPrice) : undefined,
				depositAmount:
					editDepositAmount > 0 ? dollarsToCents(editDepositAmount) : undefined,
			};
			editMode = false;
		}
	} catch (err) {
		console.error("Failed to update contract:", err);
	} finally {
		saving = false;
	}
}

async function sendContractEmail() {
	if (!selectedContract) return;
	sending = true;
	sendResult = null;
	try {
		const res = await fetch(`/api/admin/contracts/${selectedContract._id}/send`, {
			method: "POST",
		});
		if (res.ok) {
			sendResult = "success";
			const idx = data.contracts.findIndex(
				(c: any) => c._id === selectedContract._id,
			);
			if (idx !== -1) {
				data.contracts[idx] = { ...data.contracts[idx], status: "sent" };
				data.contracts = [...data.contracts];
			}
			selectedContract = { ...selectedContract, status: "sent" };
		} else {
			sendResult = "error";
		}
	} catch (err) {
		console.error("Failed to send contract email:", err);
		sendResult = "error";
	} finally {
		sending = false;
	}
}

async function contractAction(action: string) {
	if (!selectedContract) return;
	saving = true;
	try {
		const res = await fetch(`/api/admin/contracts/${selectedContract._id}`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ action }),
		});
		if (res.ok) {
			const newStatus =
				action === "send"
					? "sent"
					: action === "sign"
						? "signed"
						: selectedContract.status;
			const idx = data.contracts.findIndex(
				(c: any) => c._id === selectedContract._id,
			);
			if (idx !== -1) {
				data.contracts[idx] = {
					...data.contracts[idx],
					status: newStatus,
				};
				data.contracts = [...data.contracts];
			}
			selectedContract = { ...selectedContract, status: newStatus };
		}
	} catch (err) {
		console.error("Failed to update contract:", err);
	} finally {
		saving = false;
	}
}

async function deleteContract() {
	if (!selectedContract) return;
	saving = true;
	try {
		const res = await fetch(`/api/admin/contracts/${selectedContract._id}`, {
			method: "DELETE",
		});
		if (res.ok) {
			data.contracts = data.contracts.filter(
				(c: any) => c._id !== selectedContract._id,
			);
			closeDetailModal();
		}
	} catch (err) {
		console.error("Failed to delete contract:", err);
	} finally {
		saving = false;
	}
}

// Template modal
function openTemplateModal(template?: any) {
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
	showTemplateModal = true;
}

function closeTemplateModal() {
	showTemplateModal = false;
	selectedTemplate = null;
	confirmDeleteTemplate = false;
}

async function saveTemplate() {
	if (!tplName || !tplBody) return;
	saving = true;
	try {
		const variables = tplVariables
			.split(",")
			.map((v) => v.trim())
			.filter(Boolean);

		if (selectedTemplate) {
			const res = await fetch(`/api/admin/contracts/${selectedTemplate._id}`, {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					_type: "template",
					name: tplName,
					body: tplBody,
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
						name: tplName,
						body: tplBody,
						variables: variables.length ? variables : undefined,
					};
					data.templates = [...data.templates];
				}
				closeTemplateModal();
			}
		} else {
			const res = await fetch("/api/admin/contracts", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					_type: "template",
					name: tplName,
					body: tplBody,
					variables: variables.length ? variables : undefined,
				}),
			});
			if (res.ok) {
				closeTemplateModal();
				window.location.reload();
			}
		}
	} catch (err) {
		console.error("Failed to save template:", err);
	} finally {
		saving = false;
	}
}

async function deleteTemplate() {
	if (!selectedTemplate) return;
	saving = true;
	try {
		const res = await fetch(`/api/admin/contracts/${selectedTemplate._id}`, {
			method: "DELETE",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ _type: "template" }),
		});
		if (res.ok) {
			data.templates = data.templates.filter(
				(t: any) => t._id !== selectedTemplate._id,
			);
			closeTemplateModal();
		}
	} catch (err) {
		console.error("Failed to delete template:", err);
	} finally {
		saving = false;
	}
}
</script>

<SEO title="Contracts | Admin" description="Manage contracts" />

<FeatureGate feature="contracts" tier={data.tier}>
<div class="contracts-page">
	<header class="page-header">
		<div class="header-left">
			<h1>contracts</h1>
		</div>
		<button
			class="btn-add"
			onclick={() => {
				if (activeTab === "templates") openTemplateModal();
				else openCreateModal();
			}}
		>
			<svg
				width="14"
				height="14"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
				><line x1="12" y1="5" x2="12" y2="19" /><line
					x1="5"
					y1="12"
					x2="19"
					y2="12"
				/></svg
			>
			{activeTab === "templates" ? "new template" : "new contract"}
		</button>
	</header>

	<div class="stats-line">
		<span>{stats.total} total</span>
		<span class="stat-sep">&middot;</span>
		<span>{stats.draft} draft</span>
		<span class="stat-sep">&middot;</span>
		<span>{stats.sent} sent</span>
		<span class="stat-sep">&middot;</span>
		<span>{stats.signed} signed</span>
		{#if stats.expired > 0}
			<span class="stat-sep">&middot;</span>
			<span>{stats.expired} expired</span>
		{/if}
	</div>

	<!-- Tab toggle -->
	<div class="tab-bar">
		<button
			class="tab-btn"
			class:tab-active={activeTab === "contracts"}
			onclick={() => {
				activeTab = "contracts";
			}}>contracts</button
		>
		<button
			class="tab-btn"
			class:tab-active={activeTab === "templates"}
			onclick={() => {
				activeTab = "templates";
			}}>templates</button
		>
	</div>

	{#if activeTab === "contracts"}
		<div class="filter-bar">
			<select class="filter-select" bind:value={statusFilter}>
				<option value="all">all statuses</option>
				{#each allStatuses as s}
					<option value={s}>{s}</option>
				{/each}
			</select>
			<input
				class="filter-search"
				type="text"
				placeholder="search by title or client..."
				bind:value={searchQuery}
			/>
		</div>

		{#if filteredContracts.length === 0}
			<div class="empty-state">no contracts found</div>
		{:else}
			<div class="table-wrap">
				<table class="ct-table">
					<thead>
						<tr>
							<th>title</th>
							<th>client</th>
							<th>category</th>
							<th>event date</th>
							<th>total price</th>
							<th>status</th>
						</tr>
					</thead>
					<tbody>
						{#each filteredContracts as contract (contract._id)}
							<tr
								class="ct-row"
								role="button"
								tabindex="0"
								onclick={() => openDetailModal(contract)}
								onkeydown={(e) => {
									if (e.key === "Enter" || e.key === " ") {
										e.preventDefault();
										openDetailModal(contract);
									}
								}}
							>
								<td class="td-title">{contract.title}</td>
								<td class="td-client"
									>{contract.clientName}</td
								>
								<td class="td-category"
									>{contract.category || "\u2014"}</td
								>
								<td class="td-date"
									>{contract.eventDate
										? formatDate(contract.eventDate)
										: "\u2014"}</td
								>
								<td class="td-price"
									>{contract.totalPrice
										? formatCents(contract.totalPrice)
										: "\u2014"}</td
								>
								<td>
									<span class="status-indicator">
										<span
											class="status-dot"
											style="background: {getStatusColor(contract.status)}"
										></span>
										{contract.status}
									</span>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	{:else}
		<!-- Templates tab -->
		{#if data.templates.length === 0}
			<div class="empty-state">no templates yet</div>
		{:else}
			<div class="templates-list">
				{#each data.templates as template (template._id)}
					<button
						class="template-item"
						onclick={() => openTemplateModal(template)}
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
	{/if}
</div>

<!-- Create Contract Modal -->
{#if showCreateModal}
	<div
		class="modal-overlay"
		role="dialog"
		tabindex="-1"
		aria-modal="true"
		aria-label="Create contract"
		onclick={closeCreateModal}
		onkeydown={(e) => {
			if (e.key === "Escape") closeCreateModal();
		}}
	>
		<div
			class="modal-content modal-wide"
			role="presentation"
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => e.stopPropagation()}
		>
			<div class="modal-header">
				<h2 class="modal-title">new contract</h2>
				<button
					class="modal-close"
					aria-label="Close"
					onclick={closeCreateModal}
				>
					<svg
						width="16"
						height="16"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						><line x1="18" y1="6" x2="6" y2="18" /><line
							x1="6"
							y1="6"
							x2="18"
							y2="18"
						/></svg
					>
				</button>
			</div>

			<form
				class="modal-form"
				onsubmit={(e) => {
					e.preventDefault();
					saveNewContract();
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
							{#each data.clients as client (client._id)}
								<option value={client._id}
									>{client.name}</option
								>
							{/each}
						</select>
					</div>
					<div class="form-group">
						<label class="form-label" for="create-category"
							>category</label
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
					<label class="form-label" for="create-template"
						>template</label
					>
					<select
						id="create-template"
						class="form-input"
						bind:value={formTemplateId}
						onchange={onTemplateSelect}
					>
						<option value="">none</option>
						{#each data.templates as tpl (tpl._id)}
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
					<button
						type="button"
						class="btn-cancel"
						onclick={closeCreateModal}>cancel</button
					>
					<button
						type="submit"
						class="btn-save"
						disabled={saving ||
							!formTitle ||
							!formClientId ||
							!formBody}
					>
						{saving ? "saving..." : "save as draft"}
					</button>
				</div>
			</form>
		</div>
	</div>
{/if}

<!-- Detail / Edit Modal -->
{#if selectedContract}
	<div
		class="modal-overlay"
		role="dialog"
		tabindex="-1"
		aria-modal="true"
		aria-label="Contract details"
		onclick={closeDetailModal}
		onkeydown={(e) => {
			if (e.key === "Escape") closeDetailModal();
		}}
	>
		<div
			class="modal-content modal-wide"
			role="presentation"
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => e.stopPropagation()}
		>
			<div class="modal-header">
				<h2 class="modal-title">
					{editMode ? "edit contract" : selectedContract.title}
				</h2>
				<button
					class="modal-close"
					aria-label="Close"
					onclick={closeDetailModal}
				>
					<svg
						width="16"
						height="16"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						><line x1="18" y1="6" x2="6" y2="18" /><line
							x1="6"
							y1="6"
							x2="18"
							y2="18"
						/></svg
					>
				</button>
			</div>

			{#if editMode}
				<form
					class="modal-form"
					onsubmit={(e) => {
						e.preventDefault();
						saveEdit();
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
							<label
								class="form-label"
								for="edit-event-location"
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
						<button
							type="button"
							class="btn-cancel"
							onclick={cancelEdit}>cancel</button
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
						<span class="status-indicator">
							<span
								class="status-dot"
								style="background: {getStatusColor(selectedContract.status)}"
							></span>
							{selectedContract.status}
						</span>
						{#if selectedContract.category}
							<span class="meta-sep">&middot;</span>
							<span class="detail-category"
								>{selectedContract.category}</span
							>
						{/if}
						<span class="meta-sep">&middot;</span>
						<span class="detail-client"
							>{selectedContract.clientName}</span
						>
						{#if selectedContract.eventDate}
							<span class="meta-sep">&middot;</span>
							<span class="detail-date"
								>{formatDate(
									selectedContract.eventDate,
								)}</span
							>
						{/if}
					</div>

					{#if selectedContract.totalPrice || selectedContract.depositAmount}
						<div class="detail-pricing">
							{#if selectedContract.totalPrice}
								<span
									>total:
									{formatCents(
										selectedContract.totalPrice,
									)}</span
								>
							{/if}
							{#if selectedContract.depositAmount}
								<span class="stat-sep">&middot;</span>
								<span
									>deposit:
									{formatCents(
										selectedContract.depositAmount,
									)}</span
								>
							{/if}
						</div>
					{/if}

					{#if selectedContract.eventLocation}
						<div class="detail-field">
							<span class="detail-label">location</span>
							<span class="detail-value"
								>{selectedContract.eventLocation}</span
							>
						</div>
					{/if}

					<div class="detail-fields">
						<div class="detail-field">
							<span class="detail-label">contract body</span>
							<div class="detail-body-text">
								{selectedContract.body}
							</div>
						</div>

						{#if selectedContract.sentAt}
							<div class="detail-field">
								<span class="detail-label">sent</span>
								<span class="detail-value"
									>{formatTimestamp(
										selectedContract.sentAt,
									)}</span
								>
							</div>
						{/if}

						{#if selectedContract.signedAt}
							<div class="detail-field">
								<span class="detail-label">signed</span>
								<span class="detail-value"
									>{formatTimestamp(
										selectedContract.signedAt,
									)}</span
								>
							</div>
						{/if}

						<div class="detail-field">
							<span class="detail-label">created</span>
							<span class="detail-value"
								>{formatTimestamp(
									selectedContract._creationTime,
								)}</span
							>
						</div>
					</div>

					<div class="modal-actions detail-actions">
						{#if confirmDelete}
							<span class="confirm-text"
								>delete this contract?</span
							>
							<button
								class="btn-danger"
								onclick={deleteContract}
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
							<button class="btn-cancel" onclick={() => { sendResult = null; }}>dismiss</button>
						{:else if selectedContract.status === "draft"}
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
								onclick={sendContractEmail}
								disabled={sending}
							>
								{sending ? "sending..." : "send email"}
							</button>
							<button
								class="btn-save"
								onclick={() => contractAction("send")}
								disabled={saving}
							>
								{saving ? "..." : "mark as sent"}
							</button>
						{:else if selectedContract.status === "sent"}
							<button
								class="btn-save"
								onclick={() => contractAction("sign")}
								disabled={saving}
							>
								{saving ? "..." : "mark as signed"}
							</button>
						{:else if selectedContract.status === "signed"}
							<span class="signed-note"
								>signed on
								{formatTimestamp(
									selectedContract.signedAt,
								)}</span
							>
						{/if}
					</div>
				</div>
			{/if}
		</div>
	</div>
{/if}

<!-- Template Modal -->
{#if showTemplateModal}
	<div
		class="modal-overlay"
		role="dialog"
		tabindex="-1"
		aria-modal="true"
		aria-label={selectedTemplate ? "Edit template" : "New template"}
		onclick={closeTemplateModal}
		onkeydown={(e) => {
			if (e.key === "Escape") closeTemplateModal();
		}}
	>
		<div
			class="modal-content modal-wide"
			role="presentation"
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => e.stopPropagation()}
		>
			<div class="modal-header">
				<h2 class="modal-title">
					{selectedTemplate ? "edit template" : "new template"}
				</h2>
				<button
					class="modal-close"
					aria-label="Close"
					onclick={closeTemplateModal}
				>
					<svg
						width="16"
						height="16"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						><line x1="18" y1="6" x2="6" y2="18" /><line
							x1="6"
							y1="6"
							x2="18"
							y2="18"
						/></svg
					>
				</button>
			</div>

			<form
				class="modal-form"
				onsubmit={(e) => {
					e.preventDefault();
					saveTemplate();
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
						<span class="confirm-text"
							>delete this template?</span
						>
						<button
							type="button"
							class="btn-danger"
							onclick={deleteTemplate}
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
							onclick={closeTemplateModal}>cancel</button
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
		</div>
	</div>
{/if}
</FeatureGate>

<style>
	.contracts-page {
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

	.page-header h1 {
		font-family: "Chillax", sans-serif;
		font-size: 1.8rem;
		font-weight: 500;
		color: var(--admin-heading);
		margin: 0;
		letter-spacing: -0.01em;
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

	/* Stats line */
	.stats-line {
		display: flex;
		align-items: baseline;
		gap: 8px;
		flex-wrap: wrap;
		margin-bottom: 24px;
		font-size: 0.82rem;
		color: var(--admin-text-muted);
	}

	.stat-sep {
		color: var(--admin-text-subtle);
	}

	/* Tab bar */
	.tab-bar {
		display: flex;
		gap: 0;
		margin-bottom: 24px;
		border-bottom: 1px solid var(--admin-border);
	}

	.tab-btn {
		background: none;
		border: none;
		border-bottom: 2px solid transparent;
		padding: 8px 16px;
		font-size: 0.85rem;
		font-family: "Synonym", system-ui, sans-serif;
		color: var(--admin-text-muted);
		cursor: pointer;
		transition: color 0.15s, border-color 0.15s;
		margin-bottom: -1px;
	}

	.tab-btn:hover {
		color: var(--admin-heading);
	}

	.tab-active {
		color: var(--admin-heading);
		border-bottom-color: var(--admin-accent);
		font-weight: 500;
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

	/* Table */
	.table-wrap {
		overflow-x: auto;
		-webkit-overflow-scrolling: touch;
	}

	.ct-table {
		width: 100%;
		border-collapse: collapse;
		text-align: left;
		font-size: 0.85rem;
	}

	.ct-table th {
		padding: 0 16px 12px 0;
		color: var(--admin-text-subtle);
		font-weight: 400;
		font-size: 0.75rem;
		letter-spacing: 0.04em;
		border-bottom: 1px solid var(--admin-border);
		white-space: nowrap;
	}

	.ct-table td {
		padding: 14px 16px 14px 0;
		border-bottom: 1px solid var(--admin-border);
		white-space: nowrap;
	}

	.ct-row {
		cursor: pointer;
		transition: background 0.12s;
	}

	.ct-row:hover {
		background: var(--admin-active);
	}

	.td-title {
		font-weight: 500;
		color: var(--admin-heading);
	}

	.td-client {
		color: var(--admin-text);
	}

	.td-category {
		color: var(--admin-text-subtle);
		font-size: 0.8rem;
	}

	.td-date {
		color: var(--admin-text-muted);
		font-size: 0.82rem;
	}

	.td-price {
		font-weight: 500;
		color: var(--admin-heading);
		font-variant-numeric: tabular-nums;
	}

	/* Status */
	.status-indicator {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 0.8rem;
		color: var(--admin-text-muted);
	}

	.status-dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		flex-shrink: 0;
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

	/* Empty state */
	.empty-state {
		padding: 48px 0;
		color: var(--admin-text-subtle);
		font-size: 0.88rem;
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

	/* Responsive */
	@media (max-width: 768px) {
		.contracts-page {
			padding: 20px 16px;
		}

		.page-header {
			flex-direction: column;
		}

		.btn-add {
			align-self: flex-start;
		}

		.stats-line {
			flex-direction: column;
			gap: 4px;
		}

		.stat-sep {
			display: none;
		}

		.tab-bar {
			overflow-x: auto;
			-webkit-overflow-scrolling: touch;
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

		.modal-overlay {
			align-items: flex-end;
			padding: 0;
		}

		.modal-content {
			border-radius: 12px 12px 0 0;
		}

		.modal-header {
			padding: 20px 20px 16px;
		}

		.modal-form {
			padding: 0 20px 20px;
		}

		.detail-body {
			padding: 0 20px 20px;
		}

		.template-item {
			flex-direction: column;
			align-items: flex-start;
			gap: 6px;
		}
	}
</style>
