<script lang="ts">
import SEO from "$lib/components/SEO.svelte";

let { data } = $props();

// Modal state
let showAddModal = $state(false);
let selectedClient = $state<any>(null);
let editMode = $state(false);
let saving = $state(false);

// Search
let searchQuery = $state("");

// Form state
let formName = $state("");
let formEmail = $state("");
let formSiteUrl = $state("");
let formSanityProjectId = $state("");
let formTier = $state<"basic" | "full">("basic");
let formSubscriptionStatus = $state<
	"none" | "active" | "canceled" | "past_due"
>("none");
let formAdminEmails = $state("");
let formNotes = $state("");

const allTiers = ["basic", "full"] as const;
const allSubscriptionStatuses = [
	"none",
	"active",
	"canceled",
	"past_due",
] as const;

// Stats
let totalClients = $derived(data.clients.length);
let basicCount = $derived(
	data.clients.filter((c: any) => c.tier === "basic").length,
);
let fullCount = $derived(
	data.clients.filter((c: any) => c.tier === "full").length,
);
let activeCount = $derived(
	data.clients.filter((c: any) => c.subscriptionStatus === "active").length,
);

let filteredClients = $derived(
	data.clients.filter((client: any) => {
		if (searchQuery) {
			const q = searchQuery.toLowerCase();
			const matchName = client.name?.toLowerCase().includes(q);
			const matchEmail = client.email?.toLowerCase().includes(q);
			const matchSite = client.siteUrl?.toLowerCase().includes(q);
			if (!matchName && !matchEmail && !matchSite) return false;
		}
		return true;
	}),
);

function resetForm() {
	formName = "";
	formEmail = "";
	formSiteUrl = "";
	formSanityProjectId = "";
	formTier = "basic";
	formSubscriptionStatus = "none";
	formAdminEmails = "";
	formNotes = "";
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
}

function closeDetailModal() {
	selectedClient = null;
	editMode = false;
}

function startEdit() {
	if (!selectedClient) return;
	formName = selectedClient.name || "";
	formEmail = selectedClient.email || "";
	formSiteUrl = selectedClient.siteUrl || "";
	formSanityProjectId = selectedClient.sanityProjectId || "";
	formTier = selectedClient.tier || "basic";
	formSubscriptionStatus = selectedClient.subscriptionStatus || "none";
	formAdminEmails = (selectedClient.adminEmails || []).join(", ");
	formNotes = selectedClient.notes || "";
	editMode = true;
}

function cancelEdit() {
	editMode = false;
}

function getSubscriptionColor(status: string): string {
	const colors: Record<string, string> = {
		active: "var(--status-sage)",
		canceled: "var(--status-rose)",
		past_due: "var(--status-amber)",
		none: "var(--admin-text-subtle)",
	};
	return colors[status] || "var(--admin-text-subtle)";
}

function formatDate(timestamp: number) {
	return new Date(timestamp).toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
		year: "numeric",
	});
}

async function saveNewClient() {
	if (!formName || !formEmail || !formSiteUrl) return;
	saving = true;
	try {
		const adminEmails = formAdminEmails
			.split(",")
			.map((e) => e.trim())
			.filter(Boolean);
		const res = await fetch("/api/admin/platform", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				name: formName,
				email: formEmail,
				siteUrl: formSiteUrl,
				sanityProjectId: formSanityProjectId || undefined,
				tier: formTier,
				subscriptionStatus: formSubscriptionStatus,
				adminEmails,
				notes: formNotes || undefined,
			}),
		});
		if (res.ok) {
			closeAddModal();
			window.location.reload();
		}
	} catch (err) {
		console.error("Failed to create platform client:", err);
	} finally {
		saving = false;
	}
}

async function saveEdit() {
	if (!selectedClient || !formName || !formEmail || !formSiteUrl) return;
	saving = true;
	try {
		const res = await fetch(`/api/admin/platform/${selectedClient._id}`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				siteUrl: selectedClient.siteUrl,
				tier: formTier,
				subscriptionStatus: formSubscriptionStatus,
			}),
		});
		if (res.ok) {
			const idx = data.clients.findIndex(
				(c: any) => c._id === selectedClient._id,
			);
			if (idx !== -1) {
				data.clients[idx] = {
					...data.clients[idx],
					tier: formTier,
					subscriptionStatus: formSubscriptionStatus,
				};
				data.clients = [...data.clients];
			}
			selectedClient = {
				...selectedClient,
				tier: formTier,
				subscriptionStatus: formSubscriptionStatus,
			};
			editMode = false;
		}
	} catch (err) {
		console.error("Failed to update platform client:", err);
	} finally {
		saving = false;
	}
}

async function quickTierToggle() {
	if (!selectedClient) return;
	const newTier = selectedClient.tier === "basic" ? "full" : "basic";
	try {
		const res = await fetch(`/api/admin/platform/${selectedClient._id}`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				siteUrl: selectedClient.siteUrl,
				tier: newTier,
				subscriptionStatus: selectedClient.subscriptionStatus,
			}),
		});
		if (res.ok) {
			const idx = data.clients.findIndex(
				(c: any) => c._id === selectedClient._id,
			);
			if (idx !== -1) {
				data.clients[idx] = { ...data.clients[idx], tier: newTier };
				data.clients = [...data.clients];
			}
			selectedClient = { ...selectedClient, tier: newTier };
		}
	} catch (err) {
		console.error("Failed to toggle tier:", err);
	}
}

async function quickStatusUpdate(
	newStatus: "none" | "active" | "canceled" | "past_due",
) {
	if (!selectedClient) return;
	try {
		const res = await fetch(`/api/admin/platform/${selectedClient._id}`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				siteUrl: selectedClient.siteUrl,
				tier: selectedClient.tier,
				subscriptionStatus: newStatus,
			}),
		});
		if (res.ok) {
			const idx = data.clients.findIndex(
				(c: any) => c._id === selectedClient._id,
			);
			if (idx !== -1) {
				data.clients[idx] = {
					...data.clients[idx],
					subscriptionStatus: newStatus,
				};
				data.clients = [...data.clients];
			}
			selectedClient = { ...selectedClient, subscriptionStatus: newStatus };
		}
	} catch (err) {
		console.error("Failed to update subscription status:", err);
	}
}
</script>

<SEO title="Platform Clients | Admin" description="Manage platform clients" />

<div class="platform-page">
	<header class="page-header">
		<div class="header-left">
			<h1>platform clients</h1>
			<span class="client-count">{totalClients}</span>
		</div>
		<button class="btn-add" onclick={openAddModal}>
			<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
			add client
		</button>
	</header>

	<!-- Stats line -->
	<div class="stats-line">
		<span>{totalClients} total</span>
		<span class="stat-sep">&middot;</span>
		<span>{basicCount} basic</span>
		<span class="stat-sep">&middot;</span>
		<span>{fullCount} full</span>
		<span class="stat-sep">&middot;</span>
		<span>{activeCount} active subscriptions</span>
	</div>

	{#if totalClients > 0}
		<!-- Search -->
		<div class="filter-bar">
			<input
				class="filter-search"
				type="text"
				placeholder="search by name, email, or site..."
				bind:value={searchQuery}
			/>
		</div>

		<!-- Client table -->
		{#if filteredClients.length === 0}
			<div class="empty-state">no clients match your search</div>
		{:else}
			<div class="table-wrap">
				<table class="client-table">
					<thead>
						<tr>
							<th>name</th>
							<th>email</th>
							<th>site url</th>
							<th>sanity project</th>
							<th>tier</th>
							<th>subscription</th>
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
								<td class="td-email">{client.email}</td>
								<td class="td-site">{client.siteUrl}</td>
								<td class="td-sanity">{client.sanityProjectId || "\u2014"}</td>
								<td>
									<span class="tier-text" class:tier-full={client.tier === "full"}>{client.tier}</span>
								</td>
								<td>
									<span class="status-indicator">
										<span class="status-dot" style="background: {getSubscriptionColor(client.subscriptionStatus)}"></span>
										{client.subscriptionStatus}
									</span>
								</td>
								<td class="td-date">{formatDate(client._creationTime)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	{:else}
		<!-- Empty state -->
		<div class="empty-state-large">
			<svg class="empty-icon" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/></svg>
			<p class="empty-title">no platform clients yet</p>
			<p class="empty-desc">when you onboard your first photographer client, they'll appear here. click "add client" to get started.</p>
		</div>
	{/if}
</div>

<!-- Add Client Modal -->
{#if showAddModal}
	<div class="modal-overlay" role="dialog" tabindex="-1" aria-modal="true" aria-label="Add platform client" onclick={closeAddModal} onkeydown={(e) => { if (e.key === "Escape") closeAddModal(); }}>
		<div class="modal-content" role="presentation" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()}>
			<div class="modal-header">
				<h2 class="modal-title">add platform client</h2>
				<button class="modal-close" aria-label="Close" onclick={closeAddModal}>
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
				</button>
			</div>

			<form class="modal-form" onsubmit={(e) => { e.preventDefault(); saveNewClient(); }}>
				<div class="form-group">
					<label class="form-label" for="add-name">name <span class="required">*</span></label>
					<input id="add-name" class="form-input" type="text" bind:value={formName} required />
				</div>
				<div class="form-group">
					<label class="form-label" for="add-email">email <span class="required">*</span></label>
					<input id="add-email" class="form-input" type="email" bind:value={formEmail} required />
				</div>
				<div class="form-group">
					<label class="form-label" for="add-site">site url <span class="required">*</span></label>
					<input id="add-site" class="form-input" type="url" placeholder="https://" bind:value={formSiteUrl} required />
				</div>
				<div class="form-group">
					<label class="form-label" for="add-sanity">sanity project id</label>
					<input id="add-sanity" class="form-input" type="text" bind:value={formSanityProjectId} />
				</div>
				<div class="form-row">
					<div class="form-group">
						<label class="form-label" for="add-tier">tier</label>
						<select id="add-tier" class="form-input" bind:value={formTier}>
							{#each allTiers as t}
								<option value={t}>{t}</option>
							{/each}
						</select>
					</div>
					<div class="form-group">
						<label class="form-label" for="add-status">subscription status</label>
						<select id="add-status" class="form-input" bind:value={formSubscriptionStatus}>
							{#each allSubscriptionStatuses as s}
								<option value={s}>{s === "past_due" ? "past due" : s}</option>
							{/each}
						</select>
					</div>
				</div>
				<div class="form-group">
					<label class="form-label" for="add-admin-emails">admin emails <span class="form-hint">(comma-separated)</span></label>
					<input id="add-admin-emails" class="form-input" type="text" placeholder="email1@example.com, email2@example.com" bind:value={formAdminEmails} />
				</div>
				<div class="form-group">
					<label class="form-label" for="add-notes">notes</label>
					<textarea id="add-notes" class="form-input form-textarea" bind:value={formNotes} rows="3" placeholder="additional notes..."></textarea>
				</div>
				<div class="modal-actions">
					<button type="button" class="btn-cancel" onclick={closeAddModal}>cancel</button>
					<button type="submit" class="btn-save" disabled={saving || !formName || !formEmail || !formSiteUrl}>
						{saving ? "saving..." : "save client"}
					</button>
				</div>
			</form>
		</div>
	</div>
{/if}

<!-- Detail / Edit Modal -->
{#if selectedClient}
	<div class="modal-overlay" role="dialog" tabindex="-1" aria-modal="true" aria-label="Platform client details" onclick={closeDetailModal} onkeydown={(e) => { if (e.key === "Escape") closeDetailModal(); }}>
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
					<div class="form-group">
						<label class="form-label" for="edit-email">email <span class="required">*</span></label>
						<input id="edit-email" class="form-input" type="email" bind:value={formEmail} required />
					</div>
					<div class="form-group">
						<label class="form-label" for="edit-site">site url <span class="required">*</span></label>
						<input id="edit-site" class="form-input" type="url" bind:value={formSiteUrl} required />
					</div>
					<div class="form-group">
						<label class="form-label" for="edit-sanity">sanity project id</label>
						<input id="edit-sanity" class="form-input" type="text" bind:value={formSanityProjectId} />
					</div>
					<div class="form-row">
						<div class="form-group">
							<label class="form-label" for="edit-tier">tier</label>
							<select id="edit-tier" class="form-input" bind:value={formTier}>
								{#each allTiers as t}
									<option value={t}>{t}</option>
								{/each}
							</select>
						</div>
						<div class="form-group">
							<label class="form-label" for="edit-status">subscription status</label>
							<select id="edit-status" class="form-input" bind:value={formSubscriptionStatus}>
								{#each allSubscriptionStatuses as s}
									<option value={s}>{s === "past_due" ? "past due" : s}</option>
								{/each}
							</select>
						</div>
					</div>
					<div class="form-group">
						<label class="form-label" for="edit-admin-emails">admin emails <span class="form-hint">(comma-separated)</span></label>
						<input id="edit-admin-emails" class="form-input" type="text" bind:value={formAdminEmails} />
					</div>
					<div class="form-group">
						<label class="form-label" for="edit-notes">notes</label>
						<textarea id="edit-notes" class="form-input form-textarea" bind:value={formNotes} rows="3"></textarea>
					</div>
					<div class="modal-actions">
						<button type="button" class="btn-cancel" onclick={cancelEdit}>cancel</button>
						<button type="submit" class="btn-save" disabled={saving || !formName || !formEmail || !formSiteUrl}>
							{saving ? "saving..." : "save changes"}
						</button>
					</div>
				</form>
			{:else}
				<div class="detail-body">
					<div class="detail-meta-line">
						<span class="tier-text" class:tier-full={selectedClient.tier === "full"}>{selectedClient.tier} tier</span>
						<span class="meta-sep">&middot;</span>
						<span class="status-indicator">
							<span class="status-dot" style="background: {getSubscriptionColor(selectedClient.subscriptionStatus)}"></span>
							{selectedClient.subscriptionStatus === "past_due" ? "past due" : selectedClient.subscriptionStatus}
						</span>
					</div>

					<div class="detail-fields">
						<div class="detail-field">
							<span class="detail-label">email</span>
							<span class="detail-value">{selectedClient.email}</span>
						</div>
						<div class="detail-field">
							<span class="detail-label">site url</span>
							<a class="detail-link" href={selectedClient.siteUrl} target="_blank" rel="noopener noreferrer">{selectedClient.siteUrl}</a>
						</div>
						{#if selectedClient.sanityProjectId}
							<div class="detail-field">
								<span class="detail-label">sanity project</span>
								<a class="detail-link" href="https://sanity.io/manage/project/{selectedClient.sanityProjectId}" target="_blank" rel="noopener noreferrer">{selectedClient.sanityProjectId}</a>
							</div>
						{/if}
						{#if selectedClient.adminEmails?.length > 0}
							<div class="detail-field">
								<span class="detail-label">admin emails</span>
								<span class="detail-value">{selectedClient.adminEmails.join(", ")}</span>
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

					<!-- Quick tier toggle -->
					<div class="detail-status-row">
						<span class="detail-label">tier</span>
						<div class="status-buttons">
							<button
								class="status-btn"
								class:active={selectedClient.tier === "basic"}
								style={selectedClient.tier === "basic" ? "color: var(--admin-text); border-color: var(--admin-text-muted)" : ""}
								onclick={quickTierToggle}
							>
								basic
							</button>
							<button
								class="status-btn"
								class:active={selectedClient.tier === "full"}
								style={selectedClient.tier === "full" ? "color: var(--admin-accent-hover); border-color: var(--admin-accent)" : ""}
								onclick={quickTierToggle}
							>
								full
							</button>
						</div>
					</div>

					<!-- Quick subscription status -->
					<div class="detail-status-row">
						<span class="detail-label">subscription</span>
						<div class="status-buttons">
							{#each allSubscriptionStatuses as s}
								<button
									class="status-btn"
									class:active={selectedClient.subscriptionStatus === s}
									style={selectedClient.subscriptionStatus === s ? `color: ${getSubscriptionColor(s)}; border-color: ${getSubscriptionColor(s)}` : ""}
									onclick={() => quickStatusUpdate(s)}
								>
									{s === "past_due" ? "past due" : s}
								</button>
							{/each}
						</div>
					</div>

					<div class="modal-actions detail-actions">
						<button class="btn-save" onclick={startEdit}>edit</button>
					</div>
				</div>
			{/if}
		</div>
	</div>
{/if}

<style>
	/* Page layout */
	.platform-page {
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

	.client-count {
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

	.filter-search {
		flex: 1;
		min-width: 180px;
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

	.filter-search:focus {
		border-color: var(--admin-accent);
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

	.td-email,
	.td-site,
	.td-sanity {
		color: var(--admin-text-muted);
		font-size: 0.82rem;
	}

	.td-date {
		color: var(--admin-text-muted);
		font-size: 0.8rem;
	}

	/* Tier text */
	.tier-text {
		font-size: 0.82rem;
		color: var(--admin-text-muted);
	}

	.tier-full {
		color: var(--admin-accent-hover);
	}

	/* Status indicators */
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

	/* Empty states */
	.empty-state {
		padding: 48px 0;
		color: var(--admin-text-subtle);
		font-size: 0.88rem;
	}

	.empty-state-large {
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: 80px 20px;
		text-align: center;
	}

	.empty-icon {
		color: var(--admin-text-subtle);
		margin-bottom: 20px;
		opacity: 0.5;
	}

	.empty-title {
		font-family: "Chillax", sans-serif;
		font-size: 1.1rem;
		color: var(--admin-text-muted);
		margin: 0 0 8px;
	}

	.empty-desc {
		font-size: 0.85rem;
		color: var(--admin-text-subtle);
		max-width: 400px;
		line-height: 1.5;
		margin: 0;
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

	.form-hint {
		color: var(--admin-text-subtle);
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

	.detail-fields {
		display: flex;
		flex-direction: column;
		gap: 12px;
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

	/* Responsive */
	@media (max-width: 768px) {
		.platform-page {
			padding: 20px 16px;
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

		.stats-line {
			flex-direction: column;
			gap: 4px;
		}

		.stat-sep {
			display: none;
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
