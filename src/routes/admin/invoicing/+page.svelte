<script lang="ts">
import FeatureGate from "$lib/admin/components/FeatureGate.svelte";
import FilterBar from "$lib/admin/components/FilterBar.svelte";
import PageHeader from "$lib/admin/components/PageHeader.svelte";
import type { Invoice, InvoiceStatus } from "$lib/admin/types";
import SEO from "$lib/components/SEO.svelte";
import InvoiceCreateModal from "./InvoiceCreateModal.svelte";
import InvoiceDetailModal from "./InvoiceDetailModal.svelte";
import InvoiceTable from "./InvoiceTable.svelte";

let { data } = $props();

let statusFilter = $state("all");
let searchQuery = $state("");
let showCreateModal = $state(false);
let selectedInvoice = $state<Invoice | null>(null);
let shareLinkCopied = $state(false);

const allStatuses: InvoiceStatus[] = [
	"draft",
	"sent",
	"paid",
	"overdue",
	"canceled",
];

let filteredInvoices = $derived(
	data.invoices.filter((inv: Invoice) => {
		if (statusFilter !== "all" && inv.status !== statusFilter) return false;
		if (searchQuery) {
			const q = searchQuery.toLowerCase();
			const matchNumber = inv.invoiceNumber?.toLowerCase().includes(q);
			const matchClient = inv.clientName?.toLowerCase().includes(q);
			if (!matchNumber && !matchClient) return false;
		}
		return true;
	}),
);

let stats = $derived({
	total: data.invoices.length,
	draft: data.invoices.filter((i: Invoice) => i.status === "draft").length,
	sent: data.invoices.filter((i: Invoice) => i.status === "sent").length,
	paid: data.invoices.filter((i: Invoice) => i.status === "paid").length,
	overdue: data.invoices.filter((i: Invoice) => i.status === "overdue").length,
	recurring: data.invoices.filter((i: Invoice) => i.invoiceType === "recurring")
		.length,
	deposits: data.invoices.filter((i: Invoice) => i.invoiceType === "deposit")
		.length,
});

async function handleCreate(body: Record<string, unknown>) {
	const res = await fetch("/api/admin/invoicing", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
	if (res.ok) {
		showCreateModal = false;
		window.location.reload();
	}
}

async function handleSave(body: Record<string, unknown>) {
	if (!selectedInvoice) return;
	const res = await fetch(`/api/admin/invoicing/${selectedInvoice._id}`, {
		method: "PATCH",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
	if (res.ok) {
		const idx = data.invoices.findIndex(
			(i: Invoice) => i._id === selectedInvoice!._id,
		);
		if (idx !== -1) {
			data.invoices[idx] = { ...data.invoices[idx], ...body };
			data.invoices = [...data.invoices];
		}
		selectedInvoice = { ...selectedInvoice, ...body } as Invoice;
	}
}

async function handleAction(action: string) {
	if (!selectedInvoice) return;
	const res = await fetch(`/api/admin/invoicing/${selectedInvoice._id}`, {
		method: "PATCH",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ action }),
	});
	if (res.ok) {
		const newStatus =
			action === "send"
				? "sent"
				: action === "pay"
					? "paid"
					: action === "overdue"
						? "overdue"
						: action === "cancel"
							? "canceled"
							: selectedInvoice.status;
		const idx = data.invoices.findIndex(
			(i: Invoice) => i._id === selectedInvoice!._id,
		);
		if (idx !== -1) {
			data.invoices[idx] = {
				...data.invoices[idx],
				status: newStatus,
			};
			data.invoices = [...data.invoices];
		}
		selectedInvoice = { ...selectedInvoice, status: newStatus } as Invoice;
	}
}

async function handleSendEmail() {
	if (!selectedInvoice) return;
	const res = await fetch(`/api/admin/invoicing/${selectedInvoice._id}/send`, {
		method: "POST",
	});
	if (!res.ok) throw new Error("Failed to send");
	const idx = data.invoices.findIndex(
		(i: Invoice) => i._id === selectedInvoice!._id,
	);
	if (idx !== -1) {
		data.invoices[idx] = { ...data.invoices[idx], status: "sent" };
		data.invoices = [...data.invoices];
	}
	selectedInvoice = { ...selectedInvoice, status: "sent" } as Invoice;
}

async function handleDelete() {
	if (!selectedInvoice) return;
	const res = await fetch(`/api/admin/invoicing/${selectedInvoice._id}`, {
		method: "DELETE",
	});
	if (res.ok) {
		data.invoices = data.invoices.filter(
			(i: Invoice) => i._id !== selectedInvoice!._id,
		);
		selectedInvoice = null;
	}
}

async function handleShareLink() {
	if (!selectedInvoice) return;
	shareLinkCopied = false;
	const res = await fetch("/api/admin/portal", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			type: "invoice",
			documentId: selectedInvoice._id,
			clientId: selectedInvoice.clientId,
		}),
	});
	if (res.ok) {
		const { token } = await res.json();
		await navigator.clipboard.writeText(
			`https://angelsrest.online/portal/${token}`,
		);
		shareLinkCopied = true;
		setTimeout(() => {
			shareLinkCopied = false;
		}, 3000);
	}
}
</script>

<SEO title="Invoicing | Admin" description="Manage invoices" />

<FeatureGate feature="invoicing" tier={data.tier}>
	<div class="invoice-page">
		<PageHeader title="invoicing">
			{#snippet actions()}
				<button
					class="btn-add"
					onclick={() => {
						showCreateModal = true;
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
					new invoice
				</button>
			{/snippet}
		</PageHeader>

		<div class="stats-line">
			<span>{stats.total} total</span>
			<span class="stat-sep">&middot;</span>
			<span>{stats.draft} draft</span>
			<span class="stat-sep">&middot;</span>
			<span>{stats.sent} sent</span>
			<span class="stat-sep">&middot;</span>
			<span>{stats.paid} paid</span>
			<span class="stat-sep">&middot;</span>
			<span>{stats.overdue} overdue</span>
			{#if stats.recurring > 0}
				<span class="stat-sep">&middot;</span>
				<span>{stats.recurring} recurring</span>
			{/if}
			{#if stats.deposits > 0}
				<span class="stat-sep">&middot;</span>
				<span>{stats.deposits} deposits</span>
			{/if}
		</div>

		<FilterBar
			filters={[
				{
					options: allStatuses.map((s) => ({
						value: s,
						label: s,
					})),
					value: statusFilter,
					allLabel: "all statuses",
					onchange: (v) => {
						statusFilter = v;
					},
				},
			]}
			{searchQuery}
			searchPlaceholder="search by invoice # or client..."
			onsearch={(q) => {
				searchQuery = q;
			}}
		/>

		<InvoiceTable
			invoices={filteredInvoices}
			onselect={(inv) => {
				selectedInvoice = { ...inv };
			}}
		/>
	</div>

	{#if showCreateModal}
		<InvoiceCreateModal
			clients={data.clients}
			invoices={data.invoices}
			nextNumber={data.nextNumber}
			oncreate={handleCreate}
			onclose={() => {
				showCreateModal = false;
			}}
		/>
	{/if}

	{#if selectedInvoice}
		<InvoiceDetailModal
			invoice={selectedInvoice}
			onsave={handleSave}
			onaction={handleAction}
			onsend={handleSendEmail}
			ondelete={handleDelete}
			onshare={handleShareLink}
			{shareLinkCopied}
			onclose={() => {
				selectedInvoice = null;
			}}
		/>
	{/if}
</FeatureGate>

<style>
	.invoice-page {
		padding: 48px 40px;
		max-width: 1200px;
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

	@media (max-width: 768px) {
		.invoice-page {
			padding: 20px 16px;
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
	}
</style>
