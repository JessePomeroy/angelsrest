<script lang="ts">
import FeatureGate from "$lib/admin/components/FeatureGate.svelte";
import type { ActivityLogEntry, Client, ClientTag } from "$lib/admin/types";
import SEO from "$lib/components/SEO.svelte";
import ClientCreateModal from "./ClientCreateModal.svelte";
import ClientDetailModal from "./ClientDetailModal.svelte";
import ClientTable from "./ClientTable.svelte";
import TagManager from "./TagManager.svelte";

let { data } = $props();

// Filter state
let categoryFilter = $state("all");
let statusFilter = $state("all");
let tagFilter = $state("all");
let searchQuery = $state("");

// Modal state
let showAddModal = $state(false);
let selectedClient = $state<Client | null>(null);
let showTagManager = $state(false);
let saving = $state(false);

// Detail modal data
let clientTags = $state<ClientTag[]>([]);
let clientActivity = $state<ActivityLogEntry[]>([]);
let loadingTags = $state(false);
let loadingActivity = $state(false);

// Tag assignments cache: clientId -> tags
let tagAssignments = $state<Record<string, ClientTag[]>>({});

const allStatuses = ["lead", "booked", "in-progress", "completed", "archived"];

let filteredClients = $derived(
	data.clients.filter((client: Client) => {
		if (categoryFilter !== "all" && client.category !== categoryFilter)
			return false;
		if (statusFilter !== "all" && client.status !== statusFilter) return false;
		if (tagFilter !== "all") {
			const assignments = tagAssignments[client._id];
			if (!assignments || !assignments.some((t) => t._id === tagFilter))
				return false;
		}
		if (searchQuery) {
			const q = searchQuery.toLowerCase();
			if (
				!client.name?.toLowerCase().includes(q) &&
				!client.email?.toLowerCase().includes(q)
			)
				return false;
		}
		return true;
	}),
);

// Load tags for all clients on mount
async function loadAllClientTags() {
	for (const client of data.clients) {
		try {
			const res = await fetch(`/api/admin/crm/${client._id}/tags`);
			if (res.ok) {
				const result = await res.json();
				tagAssignments[client._id] = result.tags || [];
			}
		} catch {
			// ignore individual failures
		}
	}
	tagAssignments = { ...tagAssignments };
}

$effect(() => {
	if (data.clients.length > 0) {
		loadAllClientTags();
	}
});

async function loadClientTags(clientId: string) {
	loadingTags = true;
	try {
		const res = await fetch(`/api/admin/crm/${clientId}/tags`);
		if (res.ok) {
			const result = await res.json();
			clientTags = result.tags || [];
			tagAssignments[clientId] = clientTags;
			tagAssignments = { ...tagAssignments };
		}
	} catch (err) {
		console.error("Failed to load client tags:", err);
	} finally {
		loadingTags = false;
	}
}

async function loadClientActivity(clientId: string) {
	loadingActivity = true;
	try {
		const res = await fetch(`/api/admin/crm/${clientId}/activity`);
		if (res.ok) {
			const result = await res.json();
			clientActivity = result.activity || [];
		}
	} catch (err) {
		console.error("Failed to load client activity:", err);
	} finally {
		loadingActivity = false;
	}
}

async function openDetailModal(client: Client) {
	selectedClient = { ...client } as Client;
	await Promise.all([
		loadClientTags(client._id),
		loadClientActivity(client._id),
	]);
}

function closeDetailModal() {
	selectedClient = null;
	clientTags = [];
	clientActivity = [];
}

async function saveNewClient(body: Record<string, string | undefined>) {
	saving = true;
	try {
		const res = await fetch("/api/admin/crm", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});
		if (res.ok) {
			showAddModal = false;
			window.location.reload();
		}
	} catch (err) {
		console.error("Failed to create client:", err);
	} finally {
		saving = false;
	}
}

async function saveEdit(body: Record<string, string | undefined>) {
	if (!selectedClient) return;
	saving = true;
	try {
		const res = await fetch(`/api/admin/crm/${selectedClient._id}`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});
		if (res.ok) {
			const idx = data.clients.findIndex(
				(c: Client) => c._id === selectedClient!._id,
			);
			if (idx !== -1) {
				data.clients[idx] = { ...data.clients[idx], ...body } as Client;
				data.clients = [...data.clients];
			}
			selectedClient = { ...selectedClient, ...body } as Client;
			await loadClientActivity(selectedClient._id);
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
				(c: Client) => c._id !== selectedClient!._id,
			);
			closeDetailModal();
		}
	} catch (err) {
		console.error("Failed to delete client:", err);
	} finally {
		saving = false;
	}
}

async function quickStatusUpdate(newStatus: string) {
	if (!selectedClient) return;
	const clientId = selectedClient._id;
	try {
		const res = await fetch(`/api/admin/crm/${clientId}`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ status: newStatus }),
		});
		if (res.ok) {
			const idx = data.clients.findIndex((c: Client) => c._id === clientId);
			if (idx !== -1) {
				data.clients[idx] = {
					...data.clients[idx],
					status: newStatus,
				} as Client;
				data.clients = [...data.clients];
			}
			selectedClient = { ...selectedClient, status: newStatus } as Client;
			await loadClientActivity(clientId);
		}
	} catch (err) {
		console.error("Failed to update status:", err);
	}
}

async function assignTagToClient(tagId: string) {
	if (!selectedClient) return;
	try {
		const res = await fetch(`/api/admin/tags/${tagId}`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ clientId: selectedClient._id }),
		});
		if (res.ok) {
			await loadClientTags(selectedClient._id);
			await loadClientActivity(selectedClient._id);
		}
	} catch (err) {
		console.error("Failed to assign tag:", err);
	}
}

async function removeTagFromClient(tagId: string) {
	if (!selectedClient) return;
	try {
		const res = await fetch(`/api/admin/tags/${tagId}/remove`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ clientId: selectedClient._id }),
		});
		if (res.ok) {
			await loadClientTags(selectedClient._id);
			await loadClientActivity(selectedClient._id);
		}
	} catch (err) {
		console.error("Failed to remove tag:", err);
	}
}

async function createTag(name: string, color: string) {
	saving = true;
	try {
		const res = await fetch("/api/admin/tags", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ name, color }),
		});
		if (res.ok) {
			const result = await res.json();
			data.tags = [
				...data.tags,
				{ _id: result.id, name, color, _creationTime: Date.now(), siteUrl: "" },
			] as typeof data.tags;
		}
	} catch (err) {
		console.error("Failed to create tag:", err);
	} finally {
		saving = false;
	}
}

async function deleteTag(tagId: string) {
	try {
		const res = await fetch(`/api/admin/tags/${tagId}`, { method: "DELETE" });
		if (res.ok) {
			data.tags = data.tags.filter((t: ClientTag) => t._id !== tagId);
			for (const clientId of Object.keys(tagAssignments)) {
				tagAssignments[clientId] = tagAssignments[clientId].filter(
					(t) => t._id !== tagId,
				);
			}
			tagAssignments = { ...tagAssignments };
		}
	} catch (err) {
		console.error("Failed to delete tag:", err);
	}
}

function formatStatus(status: string) {
	return status
		.split("-")
		.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
		.join(" ");
}
</script>

<SEO title="Clients | Admin" description="Manage clients" />

<FeatureGate feature="crm" tier={data.tier}>
<div class="crm-page">
	<header class="page-header">
		<div class="header-left">
			<h1>clients</h1>
		</div>
		<button class="btn-add" onclick={() => { showAddModal = true; }}>
			<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
			add client
		</button>
	</header>

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
		{#if data.tags.length > 0}
			<select class="filter-select" bind:value={tagFilter}>
				<option value="all">all tags</option>
				{#each data.tags as tag (tag._id)}
					<option value={tag._id}>{tag.name}</option>
				{/each}
			</select>
		{/if}
		<input class="filter-search" type="text" placeholder="search by name or email..." bind:value={searchQuery} />
		<button class="btn-manage-tags" onclick={() => { showTagManager = true; }}>manage tags</button>
	</div>

	<ClientTable clients={filteredClients} {tagAssignments} onselect={openDetailModal} />
</div>

{#if showAddModal}
	<ClientCreateModal {saving} onsave={saveNewClient} onclose={() => { showAddModal = false; }} />
{/if}

{#if selectedClient}
	<ClientDetailModal
		client={selectedClient}
		{clientTags}
		{clientActivity}
		availableTags={data.tags}
		{loadingTags}
		{loadingActivity}
		{saving}
		onclose={closeDetailModal}
		onsave={saveEdit}
		ondelete={deleteClient}
		onstatuschange={quickStatusUpdate}
		ontagassign={assignTagToClient}
		ontagremove={removeTagFromClient}
	/>
{/if}

{#if showTagManager}
	<TagManager tags={data.tags} {saving} oncreate={createTag} ondelete={deleteTag} onclose={() => { showTagManager = false; }} />
{/if}
</FeatureGate>

<style>
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

	.filter-bar {
		display: flex;
		gap: 10px;
		margin-bottom: 24px;
		flex-wrap: wrap;
		align-items: center;
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

	.btn-manage-tags {
		padding: 7px 12px;
		background: transparent;
		color: var(--admin-text-muted);
		border: 1px solid var(--admin-border);
		border-radius: 6px;
		font-size: 0.78rem;
		font-family: "Synonym", system-ui, sans-serif;
		cursor: pointer;
		transition: color 0.15s, border-color 0.15s;
		white-space: nowrap;
	}

	.btn-manage-tags:hover {
		color: var(--admin-text);
		border-color: var(--admin-border-strong);
	}

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
	}
</style>
