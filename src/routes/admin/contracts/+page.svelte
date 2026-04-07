<script lang="ts">
import FeatureGate from "$lib/admin/components/FeatureGate.svelte";
import type { Contract, ContractStatus } from "$lib/admin/types";
import SEO from "$lib/components/SEO.svelte";
import ContractCreateModal from "./ContractCreateModal.svelte";
import ContractDetailModal from "./ContractDetailModal.svelte";
import ContractTable from "./ContractTable.svelte";
import TemplateManager from "./TemplateManager.svelte";

let { data } = $props();

// Tab state
let activeTab = $state<"contracts" | "templates">("contracts");

// Filter state
let statusFilter = $state("all");
let searchQuery = $state("");

// Modal state
let showCreateModal = $state(false);
let selectedContract = $state<Contract | null>(null);
let showTemplateCreate = $state(false);

const allStatuses: ContractStatus[] = ["draft", "sent", "signed", "expired"];

let filteredContracts = $derived(
	data.contracts.filter((c: Contract) => {
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
	draft: data.contracts.filter((c: Contract) => c.status === "draft").length,
	sent: data.contracts.filter((c: Contract) => c.status === "sent").length,
	signed: data.contracts.filter((c: Contract) => c.status === "signed").length,
	expired: data.contracts.filter((c: Contract) => c.status === "expired")
		.length,
});

// Contract CRUD callbacks
async function handleCreateContract(payload: Record<string, unknown>) {
	const res = await fetch("/api/admin/contracts", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(payload),
	});
	if (res.ok) {
		showCreateModal = false;
		window.location.reload();
	}
}

async function handleSaveContract(
	id: string,
	payload: Record<string, unknown>,
) {
	const res = await fetch(`/api/admin/contracts/${id}`, {
		method: "PATCH",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(payload),
	});
	if (res.ok) {
		const idx = data.contracts.findIndex((c: Contract) => c._id === id);
		if (idx !== -1) {
			data.contracts[idx] = { ...data.contracts[idx], ...payload };
			data.contracts = [...data.contracts];
		}
		if (selectedContract && selectedContract._id === id) {
			selectedContract = { ...selectedContract, ...payload } as Contract;
		}
	}
}

async function handleContractAction(id: string, action: string) {
	const res = await fetch(`/api/admin/contracts/${id}`, {
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
					: selectedContract?.status;
		const idx = data.contracts.findIndex((c: Contract) => c._id === id);
		if (idx !== -1) {
			data.contracts[idx] = {
				...data.contracts[idx],
				status: newStatus as ContractStatus,
			};
			data.contracts = [...data.contracts];
		}
		if (selectedContract && selectedContract._id === id) {
			selectedContract = {
				...selectedContract,
				status: newStatus as ContractStatus,
			};
		}
	}
}

async function handleSendEmail(id: string): Promise<boolean> {
	try {
		const res = await fetch(`/api/admin/contracts/${id}/send`, {
			method: "POST",
		});
		if (res.ok) {
			const idx = data.contracts.findIndex((c: Contract) => c._id === id);
			if (idx !== -1) {
				data.contracts[idx] = {
					...data.contracts[idx],
					status: "sent",
				};
				data.contracts = [...data.contracts];
			}
			if (selectedContract && selectedContract._id === id) {
				selectedContract = {
					...selectedContract,
					status: "sent",
				};
			}
			return true;
		}
		return false;
	} catch {
		return false;
	}
}

async function handleDeleteContract(id: string) {
	const res = await fetch(`/api/admin/contracts/${id}`, {
		method: "DELETE",
	});
	if (res.ok) {
		data.contracts = data.contracts.filter((c: Contract) => c._id !== id);
		selectedContract = null;
	}
}

async function handleShareLink(id: string, clientId: string) {
	const res = await fetch("/api/admin/portal", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			type: "contract",
			documentId: id,
			clientId,
		}),
	});
	if (res.ok) {
		const { token } = await res.json();
		await navigator.clipboard.writeText(
			`https://angelsrest.online/portal/${token}`,
		);
	}
}

// Template CRUD callbacks
async function handleSaveTemplate(
	id: string | null,
	payload: Record<string, unknown>,
) {
	if (id) {
		const res = await fetch(`/api/admin/contracts/${id}`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(payload),
		});
		if (res.ok) {
			const idx = data.templates.findIndex(
				(t: { _id: string }) => t._id === id,
			);
			if (idx !== -1) {
				data.templates[idx] = {
					...data.templates[idx],
					...payload,
				};
				data.templates = [...data.templates];
			}
		}
	} else {
		const res = await fetch("/api/admin/contracts", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(payload),
		});
		if (res.ok) {
			window.location.reload();
		}
	}
}

async function handleDeleteTemplate(id: string) {
	const res = await fetch(`/api/admin/contracts/${id}`, {
		method: "DELETE",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ _type: "template" }),
	});
	if (res.ok) {
		data.templates = data.templates.filter(
			(t: { _id: string }) => t._id !== id,
		);
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
					if (activeTab === "templates") showTemplateCreate = true;
					else showCreateModal = true;
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

			<ContractTable
				contracts={filteredContracts}
				onselect={(c) => {
					selectedContract = { ...c };
				}}
			/>
		{:else}
			<TemplateManager
				templates={data.templates}
				showCreateModal={showTemplateCreate}
				onsave={handleSaveTemplate}
				ondelete={handleDeleteTemplate}
				onclosecreate={() => {
					showTemplateCreate = false;
				}}
			/>
		{/if}
	</div>

	{#if showCreateModal}
		<ContractCreateModal
			clients={data.clients}
			templates={data.templates}
			onsave={handleCreateContract}
			onclose={() => {
				showCreateModal = false;
			}}
		/>
	{/if}

	{#if selectedContract}
		<ContractDetailModal
			contract={selectedContract}
			onclose={() => {
				selectedContract = null;
			}}
			onsave={handleSaveContract}
			onaction={handleContractAction}
			onsend={handleSendEmail}
			ondelete={handleDeleteContract}
			onsharelink={handleShareLink}
		/>
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
	}
</style>
