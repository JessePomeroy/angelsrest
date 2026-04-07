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
</script>

<SEO title="Clients | Admin" description="Manage clients" />

<div class="crm-page">
	<header class="page-header">
		<div class="header-left">
			<h1 class="page-title">Clients</h1>
			<p class="page-subtitle">{data.stats.total} total clients</p>
		</div>
		<button class="btn-add" onclick={openAddModal}>
			<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
			Add Client
		</button>
	</header>

	<!-- Stats row -->
	<div class="stats-row">
		<span class="stat-badge">{data.stats.total} Total</span>
		<span class="stat-badge" data-status="lead">{data.stats.leads} Leads</span>
		<span class="stat-badge" data-status="booked">{data.stats.booked} Booked</span>
		<span class="stat-badge" data-status="in-progress">{data.stats.inProgress} In Progress</span>
		<span class="stat-badge" data-status="completed">{data.stats.completed} Completed</span>
		<span class="stat-badge" data-category="photography">{data.stats.photography} Photography</span>
		<span class="stat-badge" data-category="web">{data.stats.web} Web</span>
	</div>

	<!-- Filter bar -->
	<div class="filter-bar">
		<select class="filter-select" bind:value={categoryFilter}>
			<option value="all">All Categories</option>
			<option value="photography">Photography</option>
			<option value="web">Web</option>
		</select>
		<select class="filter-select" bind:value={statusFilter}>
			<option value="all">All Statuses</option>
			{#each allStatuses as s}
				<option value={s}>{formatStatus(s)}</option>
			{/each}
		</select>
		<input
			class="filter-search"
			type="text"
			placeholder="Search by name or email..."
			bind:value={searchQuery}
		/>
	</div>

	<!-- Client table -->
	<div class="table-wrap">
		<table class="client-table">
			<thead>
				<tr>
					<th>Name</th>
					<th>Email</th>
					<th>Category</th>
					<th>Type</th>
					<th>Status</th>
					<th>Source</th>
					<th>Added</th>
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
						<td><span class="category-badge" data-category={client.category}>{client.category === "photography" ? "Photo" : "Web"}</span></td>
						<td class="td-type">{client.type ? formatType(client.type) : "\u2014"}</td>
						<td><span class="status-badge" data-status={client.status}>{formatStatus(client.status)}</span></td>
						<td class="td-source">{client.source || "\u2014"}</td>
						<td class="td-date">{formatDate(client._creationTime)}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>

	{#if filteredClients.length === 0}
		<div class="empty-state">No clients found</div>
	{/if}
</div>

<!-- Add Client Modal -->
{#if showAddModal}
	<div class="modal-overlay" role="dialog" tabindex="-1" aria-modal="true" aria-label="Add client" onclick={closeAddModal} onkeydown={(e) => { if (e.key === "Escape") closeAddModal(); }}>
		<div class="modal-content" role="presentation" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()}>
			<div class="modal-header">
				<h2 class="modal-title">Add Client</h2>
				<button class="modal-close" aria-label="Close" onclick={closeAddModal}>
					<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
				</button>
			</div>

			<form class="modal-form" onsubmit={(e) => { e.preventDefault(); saveNewClient(); }}>
				<div class="form-group">
					<label class="form-label" for="add-name">Name <span class="required">*</span></label>
					<input id="add-name" class="form-input" type="text" bind:value={formName} required />
				</div>
				<div class="form-row">
					<div class="form-group">
						<label class="form-label" for="add-email">Email</label>
						<input id="add-email" class="form-input" type="email" bind:value={formEmail} />
					</div>
					<div class="form-group">
						<label class="form-label" for="add-phone">Phone</label>
						<input id="add-phone" class="form-input" type="tel" bind:value={formPhone} />
					</div>
				</div>
				<div class="form-row">
					<div class="form-group">
						<label class="form-label" for="add-category">Category <span class="required">*</span></label>
						<select id="add-category" class="form-input" bind:value={formCategory} onchange={() => { formType = ""; }}>
							<option value="photography">Photography</option>
							<option value="web">Web</option>
						</select>
					</div>
					<div class="form-group">
						<label class="form-label" for="add-type">Type</label>
						<select id="add-type" class="form-input" bind:value={formType}>
							<option value="">Select type...</option>
							{#each formCategory === "photography" ? photographyTypes : webTypes as t}
								<option value={t}>{formatType(t)}</option>
							{/each}
						</select>
					</div>
				</div>
				{#if formCategory === "web"}
					<div class="form-group">
						<label class="form-label" for="add-website">Client Website</label>
						<input id="add-website" class="form-input" type="url" placeholder="https://" bind:value={formClientWebsite} />
					</div>
				{/if}
				<div class="form-group">
					<label class="form-label" for="add-source">Source</label>
					<select id="add-source" class="form-input" bind:value={formSource}>
						<option value="">Select source...</option>
						{#each sources as s}
							<option value={s}>{formatType(s)}</option>
						{/each}
					</select>
				</div>
				<div class="form-group">
					<label class="form-label" for="add-notes">Notes</label>
					<textarea id="add-notes" class="form-input form-textarea" bind:value={formNotes} rows="3" placeholder="Additional notes..."></textarea>
				</div>
				<div class="modal-actions">
					<button type="button" class="btn-cancel" onclick={closeAddModal}>Cancel</button>
					<button type="submit" class="btn-save" disabled={saving || !formName}>
						{saving ? "Saving..." : "Save Client"}
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
				<h2 class="modal-title">{editMode ? "Edit Client" : selectedClient.name}</h2>
				<button class="modal-close" aria-label="Close" onclick={closeDetailModal}>
					<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
				</button>
			</div>

			{#if editMode}
				<form class="modal-form" onsubmit={(e) => { e.preventDefault(); saveEdit(); }}>
					<div class="form-group">
						<label class="form-label" for="edit-name">Name <span class="required">*</span></label>
						<input id="edit-name" class="form-input" type="text" bind:value={formName} required />
					</div>
					<div class="form-row">
						<div class="form-group">
							<label class="form-label" for="edit-email">Email</label>
							<input id="edit-email" class="form-input" type="email" bind:value={formEmail} />
						</div>
						<div class="form-group">
							<label class="form-label" for="edit-phone">Phone</label>
							<input id="edit-phone" class="form-input" type="tel" bind:value={formPhone} />
						</div>
					</div>
					<div class="form-row">
						<div class="form-group">
							<label class="form-label" for="edit-category">Category <span class="required">*</span></label>
							<select id="edit-category" class="form-input" bind:value={formCategory} onchange={() => { formType = ""; }}>
								<option value="photography">Photography</option>
								<option value="web">Web</option>
							</select>
						</div>
						<div class="form-group">
							<label class="form-label" for="edit-type">Type</label>
							<select id="edit-type" class="form-input" bind:value={formType}>
								<option value="">Select type...</option>
								{#each formCategory === "photography" ? photographyTypes : webTypes as t}
									<option value={t}>{formatType(t)}</option>
								{/each}
							</select>
						</div>
					</div>
					{#if formCategory === "web"}
						<div class="form-group">
							<label class="form-label" for="edit-website">Client Website</label>
							<input id="edit-website" class="form-input" type="url" placeholder="https://" bind:value={formClientWebsite} />
						</div>
					{/if}
					<div class="form-row">
						<div class="form-group">
							<label class="form-label" for="edit-source">Source</label>
							<select id="edit-source" class="form-input" bind:value={formSource}>
								<option value="">Select source...</option>
								{#each sources as s}
									<option value={s}>{formatType(s)}</option>
								{/each}
							</select>
						</div>
						<div class="form-group">
							<label class="form-label" for="edit-status">Status</label>
							<select id="edit-status" class="form-input" bind:value={formStatus}>
								{#each allStatuses as s}
									<option value={s}>{formatStatus(s)}</option>
								{/each}
							</select>
						</div>
					</div>
					<div class="form-group">
						<label class="form-label" for="edit-notes">Notes</label>
						<textarea id="edit-notes" class="form-input form-textarea" bind:value={formNotes} rows="3"></textarea>
					</div>
					<div class="modal-actions">
						<button type="button" class="btn-cancel" onclick={cancelEdit}>Cancel</button>
						<button type="submit" class="btn-save" disabled={saving || !formName}>
							{saving ? "Saving..." : "Save Changes"}
						</button>
					</div>
				</form>
			{:else}
				<div class="detail-body">
					<div class="detail-badges">
						<span class="category-badge" data-category={selectedClient.category}>{selectedClient.category === "photography" ? "Photography" : "Web"}</span>
						<span class="status-badge" data-status={selectedClient.status}>{formatStatus(selectedClient.status)}</span>
						{#if selectedClient.type}
							<span class="type-badge">{formatType(selectedClient.type)}</span>
						{/if}
					</div>

					<div class="detail-fields">
						{#if selectedClient.email}
							<div class="detail-field">
								<span class="detail-label">Email</span>
								<span class="detail-value">{selectedClient.email}</span>
							</div>
						{/if}
						{#if selectedClient.phone}
							<div class="detail-field">
								<span class="detail-label">Phone</span>
								<span class="detail-value">{selectedClient.phone}</span>
							</div>
						{/if}
						{#if selectedClient.source}
							<div class="detail-field">
								<span class="detail-label">Source</span>
								<span class="detail-value">{selectedClient.source}</span>
							</div>
						{/if}
						{#if selectedClient.siteUrl_client}
							<div class="detail-field">
								<span class="detail-label">Client Website</span>
								<a class="detail-link" href={selectedClient.siteUrl_client} target="_blank" rel="noopener noreferrer">{selectedClient.siteUrl_client}</a>
							</div>
						{/if}
						<div class="detail-field">
							<span class="detail-label">Added</span>
							<span class="detail-value">{formatDate(selectedClient._creationTime)}</span>
						</div>
						{#if selectedClient.notes}
							<div class="detail-field">
								<span class="detail-label">Notes</span>
								<span class="detail-value detail-notes">{selectedClient.notes}</span>
							</div>
						{/if}
					</div>

					<div class="detail-status-row">
						<span class="detail-label">Quick Status</span>
						<div class="status-buttons">
							{#each allStatuses as s}
								<button
									class="status-btn"
									data-status={s}
									class:active={selectedClient.status === s}
									onclick={() => quickStatusUpdate(selectedClient._id, s)}
								>
									{formatStatus(s)}
								</button>
							{/each}
						</div>
					</div>

					<div class="modal-actions detail-actions">
						{#if confirmDelete}
							<span class="confirm-text">Delete this client?</span>
							<button class="btn-danger" onclick={deleteClient} disabled={saving}>
								{saving ? "Deleting..." : "Yes, Delete"}
							</button>
							<button class="btn-cancel" onclick={() => { confirmDelete = false; }}>No</button>
						{:else}
							<button class="btn-danger-outline" onclick={() => { confirmDelete = true; }}>Delete</button>
							<button class="btn-save" onclick={startEdit}>Edit</button>
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
		padding: 2rem;
		max-width: 1200px;
		margin: 0 auto;
	}

	.page-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		margin-bottom: 1.5rem;
		gap: 1rem;
	}

	.page-title {
		font-size: 1.75rem;
		font-weight: 600;
		color: var(--admin-heading);
		margin: 0;
	}

	.page-subtitle {
		font-size: 0.875rem;
		color: var(--admin-text-muted);
		margin: 0.25rem 0 0;
	}

	.btn-add {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 8px 16px;
		background: var(--admin-surface-raised);
		color: var(--admin-heading);
		border: 1px solid var(--admin-border-strong);
		border-radius: 6px;
		font-size: 0.875rem;
		cursor: pointer;
		transition: background 0.15s, border-color 0.15s;
		white-space: nowrap;
	}

	.btn-add:hover {
		background: var(--admin-border-strong);
	}

	/* Stats row */
	.stats-row {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin-bottom: 1.25rem;
	}

	.stat-badge {
		display: inline-block;
		padding: 4px 10px;
		border-radius: 12px;
		font-size: 0.75rem;
		font-weight: 500;
		background: var(--admin-surface-raised);
		color: var(--admin-text-muted);
		border: 1px solid var(--admin-border);
	}

	.stat-badge[data-status="lead"] { color: var(--status-slate); border-color: var(--status-slate); }
	.stat-badge[data-status="booked"] { color: var(--status-amber); border-color: var(--status-amber); }
	.stat-badge[data-status="in-progress"] { color: var(--status-lavender); border-color: var(--status-lavender); }
	.stat-badge[data-status="completed"] { color: var(--status-sage); border-color: var(--status-sage); }
	.stat-badge[data-category="photography"] { color: var(--status-peach); border-color: var(--status-peach); }
	.stat-badge[data-category="web"] { color: var(--status-lavender); border-color: var(--status-lavender); }

	/* Filter bar */
	.filter-bar {
		display: flex;
		gap: 10px;
		margin-bottom: 1.25rem;
		flex-wrap: wrap;
	}

	.filter-select,
	.filter-search {
		padding: 8px 12px;
		background: var(--admin-surface);
		color: var(--admin-text);
		border: 1px solid var(--admin-border);
		border-radius: 6px;
		font-size: 0.85rem;
		outline: none;
		transition: border-color 0.15s;
	}

	.filter-select:focus,
	.filter-search:focus {
		border-color: var(--admin-border-strong);
	}

	.filter-search {
		flex: 1;
		min-width: 180px;
	}

	/* Table */
	.table-wrap {
		overflow-x: auto;
		border: 1px solid var(--admin-border);
		border-radius: 8px;
		background: var(--admin-surface);
	}

	.client-table {
		width: 100%;
		border-collapse: collapse;
		text-align: left;
		font-size: 0.875rem;
	}

	.client-table th {
		padding: 10px 14px;
		color: var(--admin-text-muted);
		font-weight: 500;
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		border-bottom: 1px solid var(--admin-border);
		white-space: nowrap;
	}

	.client-table td {
		padding: 10px 14px;
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
	}

	.td-type,
	.td-source {
		color: var(--admin-text-muted);
		text-transform: capitalize;
	}

	.td-date {
		color: var(--admin-text-muted);
		font-size: 0.8rem;
	}

	/* Badges */
	.category-badge,
	.status-badge,
	.type-badge {
		display: inline-block;
		padding: 2px 8px;
		border-radius: 10px;
		font-size: 0.72rem;
		font-weight: 500;
		text-transform: capitalize;
	}

	.category-badge[data-category="photography"] {
		background: color-mix(in srgb, var(--status-peach) 18%, transparent);
		color: var(--status-peach);
	}

	.category-badge[data-category="web"] {
		background: color-mix(in srgb, var(--status-lavender) 18%, transparent);
		color: var(--status-lavender);
	}

	.status-badge[data-status="lead"] {
		background: color-mix(in srgb, var(--status-slate) 18%, transparent);
		color: var(--status-slate);
	}

	.status-badge[data-status="booked"] {
		background: color-mix(in srgb, var(--status-amber) 18%, transparent);
		color: var(--status-amber);
	}

	.status-badge[data-status="in-progress"] {
		background: color-mix(in srgb, var(--status-lavender) 18%, transparent);
		color: var(--status-lavender);
	}

	.status-badge[data-status="completed"] {
		background: color-mix(in srgb, var(--status-sage) 18%, transparent);
		color: var(--status-sage);
	}

	.status-badge[data-status="archived"] {
		background: color-mix(in srgb, var(--admin-text-muted) 15%, transparent);
		color: var(--admin-text-muted);
	}

	.type-badge {
		background: var(--admin-surface-raised);
		color: var(--admin-text-muted);
		border: 1px solid var(--admin-border);
	}

	/* Empty state */
	.empty-state {
		text-align: center;
		padding: 3rem 1rem;
		color: var(--admin-text-muted);
		font-size: 0.9rem;
	}

	/* Modal */
	.modal-overlay {
		position: fixed;
		inset: 0;
		z-index: 100;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(0, 0, 0, 0.6);
		padding: 1rem;
	}

	.modal-content {
		background: var(--admin-surface);
		border: 1px solid var(--admin-border-strong);
		border-radius: 10px;
		width: 100%;
		max-width: 540px;
		max-height: 90vh;
		overflow-y: auto;
		box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);
	}

	.modal-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 18px 20px;
		border-bottom: 1px solid var(--admin-border);
	}

	.modal-title {
		font-size: 1.1rem;
		font-weight: 600;
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
		padding: 20px;
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
		font-size: 0.78rem;
		color: var(--admin-text-muted);
		font-weight: 500;
	}

	.required {
		color: var(--status-rose);
	}

	.form-input {
		padding: 8px 10px;
		background: var(--admin-bg);
		color: var(--admin-text);
		border: 1px solid var(--admin-border);
		border-radius: 6px;
		font-size: 0.85rem;
		outline: none;
		transition: border-color 0.15s;
	}

	.form-input:focus {
		border-color: var(--admin-border-strong);
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
		padding: 8px 16px;
		border-radius: 6px;
		font-size: 0.85rem;
		cursor: pointer;
		transition: background 0.15s, border-color 0.15s, opacity 0.15s;
		border: 1px solid transparent;
	}

	.btn-cancel {
		background: var(--admin-surface-raised);
		color: var(--admin-text-muted);
		border-color: var(--admin-border);
	}

	.btn-cancel:hover {
		color: var(--admin-text);
	}

	.btn-save {
		background: var(--admin-heading);
		color: var(--admin-bg);
		font-weight: 500;
	}

	.btn-save:hover {
		opacity: 0.9;
	}

	.btn-save:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.btn-danger {
		background: var(--status-rose);
		color: #fff;
	}

	.btn-danger:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.btn-danger-outline {
		background: transparent;
		color: var(--status-rose);
		border-color: var(--status-rose);
	}

	.btn-danger-outline:hover {
		background: color-mix(in srgb, var(--status-rose) 12%, transparent);
	}

	/* Detail view */
	.detail-body {
		padding: 20px;
		display: flex;
		flex-direction: column;
		gap: 18px;
	}

	.detail-badges {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
	}

	.detail-fields {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.detail-field {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.detail-label {
		font-size: 0.72rem;
		color: var(--admin-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		font-weight: 500;
	}

	.detail-value {
		font-size: 0.9rem;
		color: var(--admin-heading);
	}

	.detail-notes {
		white-space: pre-wrap;
		line-height: 1.5;
	}

	.detail-link {
		font-size: 0.9rem;
		color: var(--status-lavender);
		text-decoration: none;
	}

	.detail-link:hover {
		text-decoration: underline;
	}

	.detail-status-row {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.status-buttons {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}

	.status-btn {
		padding: 4px 10px;
		border-radius: 14px;
		font-size: 0.72rem;
		cursor: pointer;
		background: var(--admin-surface-raised);
		color: var(--admin-text-muted);
		border: 1px solid var(--admin-border);
		transition: all 0.15s;
	}

	.status-btn:hover {
		border-color: var(--admin-border-strong);
		color: var(--admin-text);
	}

	.status-btn[data-status="lead"].active {
		background: color-mix(in srgb, var(--status-slate) 20%, transparent);
		color: var(--status-slate);
		border-color: var(--status-slate);
	}

	.status-btn[data-status="booked"].active {
		background: color-mix(in srgb, var(--status-amber) 20%, transparent);
		color: var(--status-amber);
		border-color: var(--status-amber);
	}

	.status-btn[data-status="in-progress"].active {
		background: color-mix(in srgb, var(--status-lavender) 20%, transparent);
		color: var(--status-lavender);
		border-color: var(--status-lavender);
	}

	.status-btn[data-status="completed"].active {
		background: color-mix(in srgb, var(--status-sage) 20%, transparent);
		color: var(--status-sage);
		border-color: var(--status-sage);
	}

	.status-btn[data-status="archived"].active {
		background: color-mix(in srgb, var(--admin-text-muted) 15%, transparent);
		color: var(--admin-text-muted);
		border-color: var(--admin-text-muted);
	}

	.detail-actions {
		border-top: 1px solid var(--admin-border);
		padding-top: 14px;
	}

	.confirm-text {
		font-size: 0.85rem;
		color: var(--status-rose);
		margin-right: auto;
		align-self: center;
	}

	/* Responsive */
	@media (max-width: 768px) {
		.crm-page {
			padding: 1.25rem 1rem;
		}

		.page-header {
			flex-direction: column;
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
	}
</style>
