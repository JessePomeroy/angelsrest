<script lang="ts">
import SEO from "$lib/components/SEO.svelte";

let { data } = $props();

// Filter state
let categoryFilter = $state("all");
let statusFilter = $state("all");
let searchQuery = $state("");

// Modal state
let showAddModal = $state(false);
let selectedClient = $state<any>(null);
let editMode = $state(false);
let confirmDelete = $state(false);
let saving = $state(false);

// Form state
let formName = $state("");
let formEmail = $state("");
let formPhone = $state("");
let formCategory = $state<"photography" | "web">("photography");
let formType = $state("");
let formClientWebsite = $state("");
let formSource = $state("");
let formNotes = $state("");
let formStatus = $state("lead");

const photographyTypes = [
	"wedding",
	"portrait",
	"family",
	"commercial",
	"event",
];
const webTypes = ["website", "redesign", "maintenance", "other"];
const allStatuses = ["lead", "booked", "in-progress", "completed", "archived"];
const sources = ["referral", "instagram", "website", "word of mouth", "other"];

let filteredClients = $derived(
	data.clients.filter((client: any) => {
		if (categoryFilter !== "all" && client.category !== categoryFilter)
			return false;
		if (statusFilter !== "all" && client.status !== statusFilter) return false;
		if (searchQuery) {
			const q = searchQuery.toLowerCase();
			const matchName = client.name?.toLowerCase().includes(q);
			const matchEmail = client.email?.toLowerCase().includes(q);
			if (!matchName && !matchEmail) return false;
		}
		return true;
	}),
);

function resetForm() {
	formName = "";
	formEmail = "";
	formPhone = "";
	formCategory = "photography";
	formType = "";
	formClientWebsite = "";
	formSource = "";
	formNotes = "";
	formStatus = "lead";
}

function openAddModal() {
	resetForm();
	showAddModal = true;
}

function closeAddModal() {
	showAddModal = false;
}

function openDetailModal(client: any) {
	selectedClient = { ...client };
	editMode = false;
	confirmDelete = false;
}

function closeDetailModal() {
	selectedClient = null;
	editMode = false;
	confirmDelete = false;
}

function startEdit() {
	if (!selectedClient) return;
	formName = selectedClient.name || "";
	formEmail = selectedClient.email || "";
	formPhone = selectedClient.phone || "";
	formCategory = selectedClient.category || "photography";
	formType = selectedClient.type || "";
	formClientWebsite = selectedClient.siteUrl_client || "";
	formSource = selectedClient.source || "";
	formNotes = selectedClient.notes || "";
	formStatus = selectedClient.status || "lead";
	editMode = true;
}

function cancelEdit() {
	editMode = false;
}

async function saveNewClient() {
	if (!formName || !formCategory) return;
	saving = true;
	try {
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
		const res = await fetch("/api/admin/crm", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});
		if (res.ok) {
			closeAddModal();
			window.location.reload();
		}
	} catch (err) {
		console.error("Failed to create client:", err);
	} finally {
		saving = false;
	}
}

async function saveEdit() {
	if (!selectedClient || !formName || !formCategory) return;
	saving = true;
	try {
		const body: Record<string, string | undefined> = {
			name: formName,
			category: formCategory,
			email: formEmail || undefined,
			phone: formPhone || undefined,
			type: formType || undefined,
			source: formSource || undefined,
			notes: formNotes || undefined,
			status: formStatus,
		};
		if (formCategory === "web") {
			body.siteUrl_client = formClientWebsite || undefined;
		}
		const res = await fetch(`/api/admin/crm/${selectedClient._id}`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});
		if (res.ok) {
			// Update local data
			const idx = data.clients.findIndex(
				(c: any) => c._id === selectedClient._id,
			);
			if (idx !== -1) {
				data.clients[idx] = { ...data.clients[idx], ...body };
				data.clients = [...data.clients];
			}
			selectedClient = { ...selectedClient, ...body };
			editMode = false;
		}
	} catch (err) {
		console.error("Failed to update client:", err);
	} finally {
		saving = false;
	}
}

async function deleteClient() {
	if (!selectedClient) return;
	saving = true;
	try {
		const res = await fetch(`/api/admin/crm/${selectedClient._id}`, {
			method: "DELETE",
		});
		if (res.ok) {
			data.clients = data.clients.filter(
				(c: any) => c._id !== selectedClient._id,
			);
			closeDetailModal();
		}
	} catch (err) {
		console.error("Failed to delete client:", err);
	} finally {
		saving = false;
	}
}

async function quickStatusUpdate(clientId: string, newStatus: string) {
	try {
		const res = await fetch(`/api/admin/crm/${clientId}`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ status: newStatus }),
		});
		if (res.ok) {
			const idx = data.clients.findIndex((c: any) => c._id === clientId);
			if (idx !== -1) {
				data.clients[idx] = { ...data.clients[idx], status: newStatus as any };
				data.clients = [...data.clients];
			}
			if (selectedClient?._id === clientId) {
				selectedClient = { ...selectedClient, status: newStatus };
			}
		}
	} catch (err) {
		console.error("Failed to update status:", err);
	}
}

function formatDate(timestamp: number) {
	return new Date(timestamp).toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
		year: "numeric",
	});
}

function formatStatus(status: string) {
	return status
		.split("-")
		.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
		.join(" ");
}

function formatType(type: string) {
	return type.charAt(0).toUpperCase() + type.slice(1);
}

function getStatusColor(status: string): string {
	const colors: Record<string, string> = {
		lead: "var(--status-slate)",
		booked: "var(--status-amber)",
		"in-progress": "var(--status-lavender)",
		completed: "var(--status-sage)",
		archived: "var(--admin-text-subtle)",
	};
	return colors[status] || "var(--status-slate)";
}

function getCategoryColor(category: string): string {
	return category === "photography"
		? "var(--status-peach)"
		: "var(--status-lavender)";
}
</script>

<SEO title="Clients | Admin" description="Manage clients" />

<div class="crm-page">
	<header class="page-header">
		<div class="header-left">
			<h1>clients</h1>
		</div>
		<button class="btn-add" onclick={openAddModal}>
			<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
			add client
		</button>
	</header>

	<!-- Stats as inline text -->
	<div class="stats-line">
		<span>{data.stats.total} total</span>
		<span class="stat-sep">&middot;</span>
		<span>{data.stats.leads} leads</span>
		<span class="stat-sep">&middot;</span>
		<span>{data.stats.booked} booked</span>
		<span class="stat-sep">&middot;</span>
		<span>{data.stats.inProgress} in progress</span>
		<span class="stat-sep">&middot;</span>
		<span>{data.stats.completed} completed</span>
		<span class="stat-sep">&middot;</span>
		<span>{data.stats.photography} photo</span>
		<span class="stat-sep">&middot;</span>
		<span>{data.stats.web} web</span>
	</div>

	<!-- Filter bar -->
	<div class="filter-bar">
		<select class="filter-select" bind:value={categoryFilter}>
			<option value="all">all categories</option>
			<option value="photography">photography</option>
			<option value="web">web</option>
		</select>
		<select class="filter-select" bind:value={statusFilter}>
			<option value="all">all statuses</option>
			{#each allStatuses as s}
				<option value={s}>{formatStatus(s)}</option>
			{/each}
		</select>
		<input
			class="filter-search"
			type="text"
			placeholder="search by name or email..."
			bind:value={searchQuery}
		/>
	</div>

	<!-- Client table -->
	{#if filteredClients.length === 0}
		<div class="empty-state">no clients found</div>
	{:else}
		<div class="table-wrap">
			<table class="client-table">
				<thead>
					<tr>
						<th>name</th>
						<th>email</th>
						<th>category</th>
						<th>type</th>
						<th>status</th>
						<th>source</th>
						<th>added</th>
					</tr>
				</thead>
				<tbody>
					{#each filteredClients as client (client._id)}
						<tr
							class="client-row"
							role="button"
							tabindex="0"
							onclick={() => openDetailModal(client)}
							onkeydown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDetailModal(client); } }}
						>
							<td class="td-name">{client.name}</td>
							<td class="td-email">{client.email || "\u2014"}</td>
							<td>
								<span class="category-indicator" style="color: {getCategoryColor(client.category)}">
									{client.category === "photography" ? "photo" : "web"}
								</span>
							</td>
							<td class="td-type">{client.type ? formatType(client.type) : "\u2014"}</td>
							<td>
								<span class="status-indicator">
									<span class="status-dot" style="background: {getStatusColor(client.status)}"></span>
									{formatStatus(client.status)}
								</span>
							</td>
							<td class="td-source">{client.source || "\u2014"}</td>
							<td class="td-date">{formatDate(client._creationTime)}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>

<!-- Add Client Modal -->
{#if showAddModal}
	<div class="modal-overlay" role="dialog" tabindex="-1" aria-modal="true" aria-label="Add client" onclick={closeAddModal} onkeydown={(e) => { if (e.key === "Escape") closeAddModal(); }}>
		<div class="modal-content" role="presentation" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()}>
			<div class="modal-header">
				<h2 class="modal-title">add client</h2>
				<button class="modal-close" aria-label="Close" onclick={closeAddModal}>
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
				</button>
			</div>

			<form class="modal-form" onsubmit={(e) => { e.preventDefault(); saveNewClient(); }}>
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
					<button type="button" class="btn-cancel" onclick={closeAddModal}>cancel</button>
					<button type="submit" class="btn-save" disabled={saving || !formName}>
						{saving ? "saving..." : "save client"}
					</button>
				</div>
			</form>
		</div>
	</div>
{/if}

<!-- Detail / Edit Modal -->
{#if selectedClient}
	<div class="modal-overlay" role="dialog" tabindex="-1" aria-modal="true" aria-label="Client details" onclick={closeDetailModal} onkeydown={(e) => { if (e.key === "Escape") closeDetailModal(); }}>
		<div class="modal-content" role="presentation" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()}>
			<div class="modal-header">
				<h2 class="modal-title">{editMode ? "edit client" : selectedClient.name}</h2>
				<button class="modal-close" aria-label="Close" onclick={closeDetailModal}>
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
				</button>
			</div>

			{#if editMode}
				<form class="modal-form" onsubmit={(e) => { e.preventDefault(); saveEdit(); }}>
					<div class="form-group">
						<label class="form-label" for="edit-name">name <span class="required">*</span></label>
						<input id="edit-name" class="form-input" type="text" bind:value={formName} required />
					</div>
					<div class="form-row">
						<div class="form-group">
							<label class="form-label" for="edit-email">email</label>
							<input id="edit-email" class="form-input" type="email" bind:value={formEmail} />
						</div>
						<div class="form-group">
							<label class="form-label" for="edit-phone">phone</label>
							<input id="edit-phone" class="form-input" type="tel" bind:value={formPhone} />
						</div>
					</div>
					<div class="form-row">
						<div class="form-group">
							<label class="form-label" for="edit-category">category <span class="required">*</span></label>
							<select id="edit-category" class="form-input" bind:value={formCategory} onchange={() => { formType = ""; }}>
								<option value="photography">photography</option>
								<option value="web">web</option>
							</select>
						</div>
						<div class="form-group">
							<label class="form-label" for="edit-type">type</label>
							<select id="edit-type" class="form-input" bind:value={formType}>
								<option value="">select type...</option>
								{#each formCategory === "photography" ? photographyTypes : webTypes as t}
									<option value={t}>{formatType(t)}</option>
								{/each}
							</select>
						</div>
					</div>
					{#if formCategory === "web"}
						<div class="form-group">
							<label class="form-label" for="edit-website">client website</label>
							<input id="edit-website" class="form-input" type="url" placeholder="https://" bind:value={formClientWebsite} />
						</div>
					{/if}
					<div class="form-row">
						<div class="form-group">
							<label class="form-label" for="edit-source">source</label>
							<select id="edit-source" class="form-input" bind:value={formSource}>
								<option value="">select source...</option>
								{#each sources as s}
									<option value={s}>{formatType(s)}</option>
								{/each}
							</select>
						</div>
						<div class="form-group">
							<label class="form-label" for="edit-status">status</label>
							<select id="edit-status" class="form-input" bind:value={formStatus}>
								{#each allStatuses as s}
									<option value={s}>{formatStatus(s)}</option>
								{/each}
							</select>
						</div>
					</div>
					<div class="form-group">
						<label class="form-label" for="edit-notes">notes</label>
						<textarea id="edit-notes" class="form-input form-textarea" bind:value={formNotes} rows="3"></textarea>
					</div>
					<div class="modal-actions">
						<button type="button" class="btn-cancel" onclick={cancelEdit}>cancel</button>
						<button type="submit" class="btn-save" disabled={saving || !formName}>
							{saving ? "saving..." : "save changes"}
						</button>
					</div>
				</form>
			{:else}
				<div class="detail-body">
					<div class="detail-meta-line">
						<span class="category-indicator" style="color: {getCategoryColor(selectedClient.category)}">{selectedClient.category === "photography" ? "photography" : "web"}</span>
						<span class="meta-sep">&middot;</span>
						<span class="status-indicator">
							<span class="status-dot" style="background: {getStatusColor(selectedClient.status)}"></span>
							{formatStatus(selectedClient.status)}
						</span>
						{#if selectedClient.type}
							<span class="meta-sep">&middot;</span>
							<span class="detail-type">{formatType(selectedClient.type)}</span>
						{/if}
					</div>

					<div class="detail-fields">
						{#if selectedClient.email}
							<div class="detail-field">
								<span class="detail-label">email</span>
								<span class="detail-value">{selectedClient.email}</span>
							</div>
						{/if}
						{#if selectedClient.phone}
							<div class="detail-field">
								<span class="detail-label">phone</span>
								<span class="detail-value">{selectedClient.phone}</span>
							</div>
						{/if}
						{#if selectedClient.source}
							<div class="detail-field">
								<span class="detail-label">source</span>
								<span class="detail-value">{selectedClient.source}</span>
							</div>
						{/if}
						{#if selectedClient.siteUrl_client}
							<div class="detail-field">
								<span class="detail-label">client website</span>
								<a class="detail-link" href={selectedClient.siteUrl_client} target="_blank" rel="noopener noreferrer">{selectedClient.siteUrl_client}</a>
							</div>
						{/if}
						<div class="detail-field">
							<span class="detail-label">added</span>
							<span class="detail-value">{formatDate(selectedClient._creationTime)}</span>
						</div>
						{#if selectedClient.notes}
							<div class="detail-field">
								<span class="detail-label">notes</span>
								<span class="detail-value detail-notes">{selectedClient.notes}</span>
							</div>
						{/if}
					</div>

					<div class="detail-status-row">
						<span class="detail-label">quick status</span>
						<div class="status-buttons">
							{#each allStatuses as s}
								<button
									class="status-btn"
									class:active={selectedClient.status === s}
									style={selectedClient.status === s ? `color: ${getStatusColor(s)}; border-color: ${getStatusColor(s)}` : ''}
									onclick={() => quickStatusUpdate(selectedClient._id, s)}
								>
									{formatStatus(s)}
								</button>
							{/each}
						</div>
					</div>

					<div class="modal-actions detail-actions">
						{#if confirmDelete}
							<span class="confirm-text">delete this client?</span>
							<button class="btn-danger" onclick={deleteClient} disabled={saving}>
								{saving ? "deleting..." : "yes, delete"}
							</button>
							<button class="btn-cancel" onclick={() => { confirmDelete = false; }}>no</button>
						{:else}
							<button class="btn-danger-outline" onclick={() => { confirmDelete = true; }}>delete</button>
							<button class="btn-save" onclick={startEdit}>edit</button>
						{/if}
					</div>
				</div>
			{/if}
		</div>
	</div>
{/if}

<style>
	/* Page layout */
	.crm-page {
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

	.client-table {
		width: 100%;
		border-collapse: collapse;
		text-align: left;
		font-size: 0.85rem;
	}

	.client-table th {
		padding: 0 16px 12px 0;
		color: var(--admin-text-subtle);
		font-weight: 400;
		font-size: 0.75rem;
		letter-spacing: 0.04em;
		border-bottom: 1px solid var(--admin-border);
		white-space: nowrap;
	}

	.client-table td {
		padding: 14px 16px 14px 0;
		border-bottom: 1px solid var(--admin-border);
		white-space: nowrap;
	}

	.client-row {
		cursor: pointer;
		transition: background 0.12s;
	}

	.client-row:hover {
		background: var(--admin-active);
	}

	.td-name {
		font-weight: 500;
		color: var(--admin-heading);
	}

	.td-email {
		color: var(--admin-text-muted);
		font-size: 0.82rem;
	}

	.td-type,
	.td-source {
		color: var(--admin-text-muted);
	}

	.td-date {
		color: var(--admin-text-muted);
		font-size: 0.8rem;
	}

	/* Status / Category indicators */
	.category-indicator {
		font-size: 0.8rem;
		font-weight: 400;
	}

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
	}

	.meta-sep {
		color: var(--admin-text-subtle);
	}

	.detail-type {
		color: var(--admin-text-muted);
	}

	.detail-fields {
		display: flex;
		flex-direction: column;
		gap: 12px;
		padding-top: 4px;
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

	.detail-link {
		font-size: 0.88rem;
		color: var(--admin-accent);
		text-decoration: none;
	}

	.detail-link:hover {
		text-decoration: underline;
	}

	.detail-status-row {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding-top: 4px;
	}

	.status-buttons {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}

	.status-btn {
		padding: 4px 10px;
		border-radius: 5px;
		font-size: 0.72rem;
		font-family: "Synonym", system-ui, sans-serif;
		cursor: pointer;
		background: transparent;
		color: var(--admin-text-muted);
		border: 1px solid var(--admin-border);
		transition: all 0.15s;
	}

	.status-btn:hover {
		border-color: var(--admin-border-strong);
		color: var(--admin-text);
	}

	.status-btn.active {
		background: rgba(255, 255, 255, 0.05);
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
		.crm-page {
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
	}
</style>
