<script lang="ts">
import FeatureGate from "$lib/admin/components/FeatureGate.svelte";
import SEO from "$lib/components/SEO.svelte";

let { data } = $props();

// Filter state
let statusFilter = $state("all");
let searchQuery = $state("");

// Modal state
let showCreateModal = $state(false);
let selectedInvoice = $state<any>(null);
let editMode = $state(false);
let confirmDelete = $state(false);
let saving = $state(false);
let sending = $state(false);
let sendResult = $state<"success" | "error" | null>(null);

// Create form state
let formNumber = $state("");
let formClientId = $state("");
let formType = $state<
	"one-time" | "recurring" | "deposit" | "package" | "milestone"
>("one-time");
let formItems = $state<
	{ description: string; quantity: number; unitPrice: number }[]
>([{ description: "", quantity: 1, unitPrice: 0 }]);
let formTaxPercent = $state(0);
let formDueDate = $state("");
let formNotes = $state("");

// Recurring fields
let formRecurringInterval = $state<
	"weekly" | "monthly" | "quarterly" | "yearly"
>("monthly");
let formRecurringNextDue = $state("");
let formRecurringEndDate = $state("");

// Deposit fields
let formDepositPercent = $state(50);
let formTotalProject = $state(0);

// Milestone fields
let formMilestoneName = $state("");
let formMilestoneIndex = $state(1);
let formMilestoneTotal = $state(1);
let formParentInvoiceId = $state("");

// Edit form state
let editItems = $state<
	{ description: string; quantity: number; unitPrice: number }[]
>([]);
let editTaxPercent = $state(0);
let editDueDate = $state("");
let editNotes = $state("");

const allStatuses = ["draft", "sent", "paid", "overdue", "canceled"];
const allTypes = [
	"one-time",
	"recurring",
	"deposit",
	"package",
	"milestone",
] as const;

let filteredInvoices = $derived(
	data.invoices.filter((inv: any) => {
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
	draft: data.invoices.filter((i: any) => i.status === "draft").length,
	sent: data.invoices.filter((i: any) => i.status === "sent").length,
	paid: data.invoices.filter((i: any) => i.status === "paid").length,
	overdue: data.invoices.filter((i: any) => i.status === "overdue").length,
	recurring: data.invoices.filter((i: any) => i.invoiceType === "recurring")
		.length,
	deposits: data.invoices.filter((i: any) => i.invoiceType === "deposit")
		.length,
});

function calcSubtotal(
	items: { quantity: number; unitPrice: number }[],
): number {
	return items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
}

function calcTax(subtotal: number, taxPercent: number): number {
	return Math.round(subtotal * (taxPercent / 100));
}

function formatCents(cents: number): string {
	return `$${(cents / 100).toFixed(2)}`;
}

function getStatusColor(status: string): string {
	const colors: Record<string, string> = {
		draft: "var(--admin-text-subtle)",
		sent: "var(--status-amber)",
		paid: "var(--status-sage)",
		overdue: "var(--status-rose)",
		canceled: "var(--admin-text-subtle)",
	};
	return colors[status] || "var(--admin-text-subtle)";
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

function resetCreateForm() {
	formNumber = data.nextNumber;
	formClientId = "";
	formType = "one-time";
	formItems = [{ description: "", quantity: 1, unitPrice: 0 }];
	formTaxPercent = 0;
	formDueDate = "";
	formNotes = "";
	formRecurringInterval = "monthly";
	formRecurringNextDue = "";
	formRecurringEndDate = "";
	formDepositPercent = 50;
	formTotalProject = 0;
	formMilestoneName = "";
	formMilestoneIndex = 1;
	formMilestoneTotal = 1;
	formParentInvoiceId = "";
}

function openCreateModal() {
	resetCreateForm();
	showCreateModal = true;
}

function closeCreateModal() {
	showCreateModal = false;
}

function addItem() {
	formItems = [...formItems, { description: "", quantity: 1, unitPrice: 0 }];
}

function removeItem(index: number) {
	formItems = formItems.filter((_, i) => i !== index);
}

function addEditItem() {
	editItems = [...editItems, { description: "", quantity: 1, unitPrice: 0 }];
}

function removeEditItem(index: number) {
	editItems = editItems.filter((_, i) => i !== index);
}

function openDetailModal(invoice: any) {
	selectedInvoice = { ...invoice };
	editMode = false;
	confirmDelete = false;
	sendResult = null;
}

function closeDetailModal() {
	selectedInvoice = null;
	editMode = false;
	confirmDelete = false;
	sendResult = null;
}

function startEdit() {
	if (!selectedInvoice) return;
	editItems = selectedInvoice.items.map((it: any) => ({ ...it }));
	editTaxPercent = selectedInvoice.taxPercent || 0;
	editDueDate = selectedInvoice.dueDate || "";
	editNotes = selectedInvoice.notes || "";
	editMode = true;
}

function cancelEdit() {
	editMode = false;
}

let createSubtotal = $derived(calcSubtotal(formItems));
let createTax = $derived(calcTax(createSubtotal, formTaxPercent));
let createTotal = $derived(createSubtotal + createTax);

let depositTotal = $derived(
	Math.round(dollarsToCents(formTotalProject) * (formDepositPercent / 100)),
);

let editSubtotal = $derived(calcSubtotal(editItems));
let editTax = $derived(calcTax(editSubtotal, editTaxPercent));
let editTotal = $derived(editSubtotal + editTax);

function dollarsToCents(dollars: number): number {
	return Math.round(dollars * 100);
}

async function saveNewInvoice() {
	if (!formNumber || !formClientId || formItems.length === 0) return;
	saving = true;
	try {
		const items = formItems.map((item) => ({
			description: item.description,
			quantity: item.quantity,
			unitPrice: dollarsToCents(item.unitPrice),
		}));
		const body: Record<string, unknown> = {
			invoiceNumber: formNumber,
			clientId: formClientId,
			invoiceType: formType,
			items,
		};
		if (formTaxPercent > 0) body.taxPercent = formTaxPercent;
		if (formDueDate) body.dueDate = formDueDate;
		if (formNotes) body.notes = formNotes;

		// Recurring fields
		if (formType === "recurring") {
			body.recurring = {
				interval: formRecurringInterval,
				nextDueDate: formRecurringNextDue || undefined,
				endDate: formRecurringEndDate || undefined,
			};
		}

		// Deposit fields
		if (formType === "deposit") {
			body.depositPercent = formDepositPercent;
			body.totalProject = dollarsToCents(formTotalProject);
		}

		// Milestone fields
		if (formType === "milestone") {
			if (formMilestoneName) body.milestoneName = formMilestoneName;
			body.milestoneIndex = formMilestoneIndex;
			if (formParentInvoiceId) body.parentInvoiceId = formParentInvoiceId;
		}

		const res = await fetch("/api/admin/invoicing", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});
		if (res.ok) {
			closeCreateModal();
			window.location.reload();
		}
	} catch (err) {
		console.error("Failed to create invoice:", err);
	} finally {
		saving = false;
	}
}

async function saveEdit() {
	if (!selectedInvoice || editItems.length === 0) return;
	saving = true;
	try {
		const items = editItems.map((item) => ({
			description: item.description,
			quantity: item.quantity,
			unitPrice: item.unitPrice,
		}));
		const body: Record<string, unknown> = { items };
		if (editTaxPercent > 0) {
			body.taxPercent = editTaxPercent;
		}
		body.dueDate = editDueDate || undefined;
		body.notes = editNotes || undefined;

		const res = await fetch(`/api/admin/invoicing/${selectedInvoice._id}`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});
		if (res.ok) {
			const idx = data.invoices.findIndex(
				(i: any) => i._id === selectedInvoice._id,
			);
			if (idx !== -1) {
				data.invoices[idx] = {
					...data.invoices[idx],
					items,
					taxPercent: editTaxPercent || undefined,
					dueDate: editDueDate || undefined,
					notes: editNotes || undefined,
				};
				data.invoices = [...data.invoices];
			}
			selectedInvoice = {
				...selectedInvoice,
				items,
				taxPercent: editTaxPercent || undefined,
				dueDate: editDueDate || undefined,
				notes: editNotes || undefined,
			};
			editMode = false;
		}
	} catch (err) {
		console.error("Failed to update invoice:", err);
	} finally {
		saving = false;
	}
}

async function sendInvoiceEmail() {
	if (!selectedInvoice) return;
	sending = true;
	sendResult = null;
	try {
		const res = await fetch(`/api/admin/invoicing/${selectedInvoice._id}/send`, {
			method: "POST",
		});
		if (res.ok) {
			sendResult = "success";
			const idx = data.invoices.findIndex(
				(i: any) => i._id === selectedInvoice._id,
			);
			if (idx !== -1) {
				data.invoices[idx] = { ...data.invoices[idx], status: "sent" };
				data.invoices = [...data.invoices];
			}
			selectedInvoice = { ...selectedInvoice, status: "sent" };
		} else {
			sendResult = "error";
		}
	} catch (err) {
		console.error("Failed to send invoice email:", err);
		sendResult = "error";
	} finally {
		sending = false;
	}
}

async function invoiceAction(action: string) {
	if (!selectedInvoice) return;
	saving = true;
	try {
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
				(i: any) => i._id === selectedInvoice._id,
			);
			if (idx !== -1) {
				data.invoices[idx] = { ...data.invoices[idx], status: newStatus };
				data.invoices = [...data.invoices];
			}
			selectedInvoice = { ...selectedInvoice, status: newStatus };
		}
	} catch (err) {
		console.error("Failed to update invoice:", err);
	} finally {
		saving = false;
	}
}

async function deleteInvoice() {
	if (!selectedInvoice) return;
	saving = true;
	try {
		const res = await fetch(`/api/admin/invoicing/${selectedInvoice._id}`, {
			method: "DELETE",
		});
		if (res.ok) {
			data.invoices = data.invoices.filter(
				(i: any) => i._id !== selectedInvoice._id,
			);
			closeDetailModal();
		}
	} catch (err) {
		console.error("Failed to delete invoice:", err);
	} finally {
		saving = false;
	}
}
</script>

<SEO title="Invoicing | Admin" description="Manage invoices" />

<FeatureGate feature="invoicing" tier={data.tier}>
<div class="invoice-page">
	<header class="page-header">
		<div class="header-left">
			<h1>invoicing</h1>
		</div>
		<button class="btn-add" onclick={openCreateModal}>
			<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
			new invoice
		</button>
	</header>

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
			placeholder="search by invoice # or client..."
			bind:value={searchQuery}
		/>
	</div>

	{#if filteredInvoices.length === 0}
		<div class="empty-state">no invoices found</div>
	{:else}
		<div class="table-wrap">
			<table class="inv-table">
				<thead>
					<tr>
						<th>invoice #</th>
						<th>type</th>
						<th>client</th>
						<th>items</th>
						<th>total</th>
						<th>due date</th>
						<th>status</th>
					</tr>
				</thead>
				<tbody>
					{#each filteredInvoices as inv (inv._id)}
						{@const subtotal = calcSubtotal(inv.items)}
						{@const tax = calcTax(subtotal, inv.taxPercent || 0)}
						{@const total = subtotal + tax}
						<tr
							class="inv-row"
							role="button"
							tabindex="0"
							onclick={() => openDetailModal(inv)}
							onkeydown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDetailModal(inv); } }}
						>
							<td class="td-number">{inv.invoiceNumber}</td>
							<td class="td-type">{inv.invoiceType || "one-time"}</td>
							<td class="td-client">{inv.clientName}</td>
							<td class="td-items">{inv.items.length} item{inv.items.length !== 1 ? "s" : ""}</td>
							<td class="td-total">{formatCents(total)}</td>
							<td class="td-date">{inv.dueDate ? formatDate(inv.dueDate) : "\u2014"}</td>
							<td>
								<span class="status-indicator">
									<span class="status-dot" style="background: {getStatusColor(inv.status)}"></span>
									{inv.status}
								</span>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>

<!-- Create Invoice Modal -->
{#if showCreateModal}
	<div class="modal-overlay" role="dialog" tabindex="-1" aria-modal="true" aria-label="Create invoice" onclick={closeCreateModal} onkeydown={(e) => { if (e.key === "Escape") closeCreateModal(); }}>
		<div class="modal-content modal-wide" role="presentation" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()}>
			<div class="modal-header">
				<h2 class="modal-title">new invoice</h2>
				<button class="modal-close" aria-label="Close" onclick={closeCreateModal}>
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
				</button>
			</div>

			<form class="modal-form" onsubmit={(e) => { e.preventDefault(); saveNewInvoice(); }}>
				<div class="form-group">
					<label class="form-label" for="create-type">invoice type</label>
					<select id="create-type" class="form-input" bind:value={formType}>
						{#each allTypes as t}
							<option value={t}>{t}</option>
						{/each}
					</select>
				</div>

				<div class="form-row">
					<div class="form-group">
						<label class="form-label" for="create-number">invoice # <span class="required">*</span></label>
						<input id="create-number" class="form-input" type="text" bind:value={formNumber} required />
					</div>
					<div class="form-group">
						<label class="form-label" for="create-client">client <span class="required">*</span></label>
						<select id="create-client" class="form-input" bind:value={formClientId} required>
							<option value="">select client...</option>
							{#each data.clients as client (client._id)}
								<option value={client._id}>{client.name}</option>
							{/each}
						</select>
					</div>
				</div>

				{#if formType === "recurring"}
					<div class="form-row">
						<div class="form-group">
							<label class="form-label" for="create-interval">interval <span class="required">*</span></label>
							<select id="create-interval" class="form-input" bind:value={formRecurringInterval}>
								<option value="weekly">weekly</option>
								<option value="monthly">monthly</option>
								<option value="quarterly">quarterly</option>
								<option value="yearly">yearly</option>
							</select>
						</div>
						<div class="form-group">
							<label class="form-label" for="create-next-due">next due date</label>
							<input id="create-next-due" class="form-input" type="date" bind:value={formRecurringNextDue} />
						</div>
					</div>
					<div class="form-group">
						<label class="form-label" for="create-end-date">end date</label>
						<input id="create-end-date" class="form-input" type="date" bind:value={formRecurringEndDate} />
					</div>
				{/if}

				{#if formType === "deposit"}
					<div class="form-row">
						<div class="form-group">
							<label class="form-label" for="create-deposit-pct">deposit %</label>
							<input id="create-deposit-pct" class="form-input" type="number" min="1" max="100" step="1" bind:value={formDepositPercent} />
						</div>
						<div class="form-group">
							<label class="form-label" for="create-total-project">total project cost ($)</label>
							<input id="create-total-project" class="form-input" type="number" min="0" step="0.01" bind:value={formTotalProject} />
						</div>
					</div>
					{#if formTotalProject > 0}
						<div class="deposit-calc">
							deposit amount: {formatCents(depositTotal)} of {formatCents(dollarsToCents(formTotalProject))}
						</div>
					{/if}
				{/if}

				{#if formType === "milestone"}
					<div class="form-row">
						<div class="form-group">
							<label class="form-label" for="create-milestone-name">milestone name</label>
							<input id="create-milestone-name" class="form-input" type="text" placeholder="e.g. design phase" bind:value={formMilestoneName} />
						</div>
						<div class="form-group">
							<label class="form-label" for="create-milestone-index">milestone number</label>
							<div class="milestone-row">
								<input id="create-milestone-index" class="form-input milestone-num" type="number" min="1" step="1" bind:value={formMilestoneIndex} />
								<span class="milestone-of">of</span>
								<input class="form-input milestone-num" type="number" min="1" step="1" bind:value={formMilestoneTotal} />
							</div>
						</div>
					</div>
					<div class="form-group">
						<label class="form-label" for="create-parent-invoice">parent invoice</label>
						<select id="create-parent-invoice" class="form-input" bind:value={formParentInvoiceId}>
							<option value="">none</option>
							{#each data.invoices as inv (inv._id)}
								<option value={inv._id}>{inv.invoiceNumber} — {inv.clientName}</option>
							{/each}
						</select>
					</div>
				{/if}

				<div class="items-section">
					<div class="items-header">
						<span class="form-label">line items <span class="required">*</span></span>
					</div>
					{#each formItems as item, i}
						<div class="item-row">
							<input class="form-input item-desc" type="text" placeholder="description" bind:value={item.description} required />
							<input class="form-input item-qty" type="number" min="1" step="1" placeholder="qty" bind:value={item.quantity} required />
							<input class="form-input item-price" type="number" min="0" step="0.01" placeholder="price ($)" bind:value={item.unitPrice} required />
							<span class="item-line-total">{formatCents(dollarsToCents(item.quantity * item.unitPrice))}</span>
							{#if formItems.length > 1}
								<button type="button" class="btn-remove-item" onclick={() => removeItem(i)} aria-label="Remove item">
									<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
								</button>
							{/if}
						</div>
					{/each}
					<button type="button" class="btn-add-item" onclick={addItem}>+ add item</button>
				</div>

				<div class="form-row">
					<div class="form-group">
						<label class="form-label" for="create-tax">tax %</label>
						<input id="create-tax" class="form-input" type="number" min="0" step="0.1" bind:value={formTaxPercent} />
					</div>
					<div class="form-group">
						<label class="form-label" for="create-due">due date</label>
						<input id="create-due" class="form-input" type="date" bind:value={formDueDate} />
					</div>
				</div>

				<div class="form-group">
					<label class="form-label" for="create-notes">notes</label>
					<textarea id="create-notes" class="form-input form-textarea" bind:value={formNotes} rows="2" placeholder="additional notes..."></textarea>
				</div>

				<div class="totals-line">
					{#if formType === "deposit" && formTotalProject > 0}
						<span>deposit ({formDepositPercent}%): {formatCents(depositTotal)}</span>
					{:else}
						<span>subtotal: {formatCents(createSubtotal)}</span>
						{#if formTaxPercent > 0}
							<span class="stat-sep">&middot;</span>
							<span>tax: {formatCents(createTax)}</span>
						{/if}
						<span class="stat-sep">&middot;</span>
						<span class="total-amount">total: {formatCents(createTotal)}</span>
					{/if}
				</div>

				<div class="modal-actions">
					<button type="button" class="btn-cancel" onclick={closeCreateModal}>cancel</button>
					<button type="submit" class="btn-save" disabled={saving || !formNumber || !formClientId || formItems.length === 0}>
						{saving ? "saving..." : "save as draft"}
					</button>
				</div>
			</form>
		</div>
	</div>
{/if}

<!-- Detail / Edit Modal -->
{#if selectedInvoice}
	{@const detailSubtotal = calcSubtotal(selectedInvoice.items)}
	{@const detailTax = calcTax(detailSubtotal, selectedInvoice.taxPercent || 0)}
	{@const detailTotal = detailSubtotal + detailTax}
	<div class="modal-overlay" role="dialog" tabindex="-1" aria-modal="true" aria-label="Invoice details" onclick={closeDetailModal} onkeydown={(e) => { if (e.key === "Escape") closeDetailModal(); }}>
		<div class="modal-content modal-wide" role="presentation" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()}>
			<div class="modal-header">
				<h2 class="modal-title">{editMode ? "edit invoice" : selectedInvoice.invoiceNumber}</h2>
				<button class="modal-close" aria-label="Close" onclick={closeDetailModal}>
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
				</button>
			</div>

			{#if editMode}
				<form class="modal-form" onsubmit={(e) => { e.preventDefault(); saveEdit(); }}>
					<div class="items-section">
						<div class="items-header">
							<span class="form-label">line items</span>
						</div>
						{#each editItems as item, i}
							<div class="item-row">
								<input class="form-input item-desc" type="text" placeholder="description" bind:value={item.description} required />
								<input class="form-input item-qty" type="number" min="1" step="1" placeholder="qty" bind:value={item.quantity} required />
								<input class="form-input item-price" type="number" min="0" step="1" placeholder="price (cents)" bind:value={item.unitPrice} required />
								<span class="item-line-total">{formatCents(item.quantity * item.unitPrice)}</span>
								{#if editItems.length > 1}
									<button type="button" class="btn-remove-item" onclick={() => removeEditItem(i)} aria-label="Remove item">
										<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
									</button>
								{/if}
							</div>
						{/each}
						<button type="button" class="btn-add-item" onclick={addEditItem}>+ add item</button>
					</div>

					<div class="form-row">
						<div class="form-group">
							<label class="form-label" for="edit-tax">tax %</label>
							<input id="edit-tax" class="form-input" type="number" min="0" step="0.1" bind:value={editTaxPercent} />
						</div>
						<div class="form-group">
							<label class="form-label" for="edit-due">due date</label>
							<input id="edit-due" class="form-input" type="date" bind:value={editDueDate} />
						</div>
					</div>

					<div class="form-group">
						<label class="form-label" for="edit-notes">notes</label>
						<textarea id="edit-notes" class="form-input form-textarea" bind:value={editNotes} rows="2"></textarea>
					</div>

					<div class="totals-line">
						<span>subtotal: {formatCents(editSubtotal)}</span>
						{#if editTaxPercent > 0}
							<span class="stat-sep">&middot;</span>
							<span>tax: {formatCents(editTax)}</span>
						{/if}
						<span class="stat-sep">&middot;</span>
						<span class="total-amount">total: {formatCents(editTotal)}</span>
					</div>

					<div class="modal-actions">
						<button type="button" class="btn-cancel" onclick={cancelEdit}>cancel</button>
						<button type="submit" class="btn-save" disabled={saving || editItems.length === 0}>
							{saving ? "saving..." : "save changes"}
						</button>
					</div>
				</form>
			{:else}
				<div class="detail-body">
					<div class="detail-meta-line">
						<span class="status-indicator">
							<span class="status-dot" style="background: {getStatusColor(selectedInvoice.status)}"></span>
							{selectedInvoice.status}
						</span>
						{#if selectedInvoice.invoiceType && selectedInvoice.invoiceType !== "one-time"}
							<span class="meta-sep">&middot;</span>
							<span class="detail-type">{selectedInvoice.invoiceType}</span>
						{/if}
						<span class="meta-sep">&middot;</span>
						<span class="detail-client">{selectedInvoice.clientName}</span>
						{#if selectedInvoice.dueDate}
							<span class="meta-sep">&middot;</span>
							<span class="detail-due">due {formatDate(selectedInvoice.dueDate)}</span>
						{/if}
					</div>

					{#if selectedInvoice.invoiceType === "recurring" && selectedInvoice.recurring}
						<div class="type-info">
							<span class="type-info-item">interval: {selectedInvoice.recurring.interval}</span>
							{#if selectedInvoice.recurring.nextDueDate}
								<span class="stat-sep">&middot;</span>
								<span class="type-info-item">next due: {formatDate(selectedInvoice.recurring.nextDueDate)}</span>
							{/if}
							{#if selectedInvoice.recurring.endDate}
								<span class="stat-sep">&middot;</span>
								<span class="type-info-item">ends: {formatDate(selectedInvoice.recurring.endDate)}</span>
							{/if}
						</div>
					{/if}

					{#if selectedInvoice.invoiceType === "deposit"}
						<div class="type-info">
							{#if selectedInvoice.depositPercent}
								<span class="type-info-item">deposit: {selectedInvoice.depositPercent}%</span>
							{/if}
							{#if selectedInvoice.totalProject}
								<span class="stat-sep">&middot;</span>
								<span class="type-info-item">total project: {formatCents(selectedInvoice.totalProject)}</span>
								<span class="stat-sep">&middot;</span>
								<span class="type-info-item">amount due: {formatCents(Math.round(selectedInvoice.totalProject * (selectedInvoice.depositPercent || 0) / 100))}</span>
								<span class="stat-sep">&middot;</span>
								<span class="type-info-item">remaining: {formatCents(selectedInvoice.totalProject - Math.round(selectedInvoice.totalProject * (selectedInvoice.depositPercent || 0) / 100))}</span>
							{/if}
						</div>
					{/if}

					{#if selectedInvoice.invoiceType === "milestone"}
						<div class="type-info">
							{#if selectedInvoice.milestoneName}
								<span class="type-info-item">{selectedInvoice.milestoneName}</span>
								<span class="stat-sep">&middot;</span>
							{/if}
							{#if selectedInvoice.milestoneIndex}
								<span class="type-info-item">milestone {selectedInvoice.milestoneIndex}</span>
							{/if}
						</div>
					{/if}

					<div class="detail-fields">
						<div class="detail-items-table">
							<div class="items-table-header">
								<span class="itcol-desc">description</span>
								<span class="itcol-qty">qty</span>
								<span class="itcol-price">price</span>
								<span class="itcol-total">total</span>
							</div>
							{#each selectedInvoice.items as item}
								<div class="items-table-row">
									<span class="itcol-desc">{item.description}</span>
									<span class="itcol-qty">{item.quantity}</span>
									<span class="itcol-price">{formatCents(item.unitPrice)}</span>
									<span class="itcol-total">{formatCents(item.quantity * item.unitPrice)}</span>
								</div>
							{/each}
						</div>

						<div class="totals-line">
							<span>subtotal: {formatCents(detailSubtotal)}</span>
							{#if selectedInvoice.taxPercent}
								<span class="stat-sep">&middot;</span>
								<span>tax ({selectedInvoice.taxPercent}%): {formatCents(detailTax)}</span>
							{/if}
							<span class="stat-sep">&middot;</span>
							<span class="total-amount">total: {formatCents(detailTotal)}</span>
						</div>

						{#if selectedInvoice.notes}
							<div class="detail-field">
								<span class="detail-label">notes</span>
								<span class="detail-value detail-notes">{selectedInvoice.notes}</span>
							</div>
						{/if}

						{#if selectedInvoice.sentAt}
							<div class="detail-field">
								<span class="detail-label">sent</span>
								<span class="detail-value">{formatTimestamp(selectedInvoice.sentAt)}</span>
							</div>
						{/if}

						{#if selectedInvoice.paidAt}
							<div class="detail-field">
								<span class="detail-label">paid</span>
								<span class="detail-value">{formatTimestamp(selectedInvoice.paidAt)}</span>
							</div>
						{/if}

						<div class="detail-field">
							<span class="detail-label">created</span>
							<span class="detail-value">{formatTimestamp(selectedInvoice._creationTime)}</span>
						</div>
					</div>

					<div class="modal-actions detail-actions">
						{#if confirmDelete}
							<span class="confirm-text">delete this invoice?</span>
							<button class="btn-danger" onclick={deleteInvoice} disabled={saving}>
								{saving ? "deleting..." : "yes, delete"}
							</button>
							<button class="btn-cancel" onclick={() => { confirmDelete = false; }}>no</button>
						{:else if sendResult === "success"}
							<span class="send-success">email sent</span>
						{:else if sendResult === "error"}
							<span class="send-error">failed to send</span>
							<button class="btn-cancel" onclick={() => { sendResult = null; }}>dismiss</button>
						{:else if selectedInvoice.status === "draft"}
							<button class="btn-danger-outline" onclick={() => { confirmDelete = true; }}>delete</button>
							<button class="btn-cancel" onclick={startEdit}>edit</button>
							<button class="btn-send" onclick={sendInvoiceEmail} disabled={sending}>
								{sending ? "sending..." : "send email"}
							</button>
							<button class="btn-save" onclick={() => invoiceAction("send")} disabled={saving}>
								{saving ? "..." : "mark as sent"}
							</button>
						{:else if selectedInvoice.status === "sent"}
							<button class="btn-action" onclick={() => invoiceAction("overdue")} disabled={saving}>mark overdue</button>
							<button class="btn-save" onclick={() => invoiceAction("pay")} disabled={saving}>
								{saving ? "..." : "mark as paid"}
							</button>
						{:else if selectedInvoice.status === "overdue"}
							<button class="btn-save" onclick={() => invoiceAction("pay")} disabled={saving}>
								{saving ? "..." : "mark as paid"}
							</button>
						{:else if selectedInvoice.status === "paid"}
							<span class="paid-note">paid on {formatTimestamp(selectedInvoice.paidAt)}</span>
						{/if}
					</div>
				</div>
			{/if}
		</div>
	</div>
{/if}
</FeatureGate>

<style>
	.invoice-page {
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

	.inv-table {
		width: 100%;
		border-collapse: collapse;
		text-align: left;
		font-size: 0.85rem;
	}

	.inv-table th {
		padding: 0 16px 12px 0;
		color: var(--admin-text-subtle);
		font-weight: 400;
		font-size: 0.75rem;
		letter-spacing: 0.04em;
		border-bottom: 1px solid var(--admin-border);
		white-space: nowrap;
	}

	.inv-table td {
		padding: 14px 16px 14px 0;
		border-bottom: 1px solid var(--admin-border);
		white-space: nowrap;
	}

	.inv-row {
		cursor: pointer;
		transition: background 0.12s;
	}

	.inv-row:hover {
		background: var(--admin-active);
	}

	.td-number {
		font-weight: 500;
		color: var(--admin-heading);
	}

	.td-type {
		color: var(--admin-text-subtle);
		font-size: 0.8rem;
	}

	.td-client {
		color: var(--admin-text);
	}

	.td-items,
	.td-date {
		color: var(--admin-text-muted);
		font-size: 0.82rem;
	}

	.td-total {
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
		max-width: 620px;
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

	/* Line items */
	.items-section {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.items-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.item-row {
		display: flex;
		gap: 8px;
		align-items: center;
	}

	.item-desc {
		flex: 3;
		min-width: 0;
	}

	.item-qty {
		flex: 0 0 60px;
		text-align: center;
	}

	.item-price {
		flex: 0 0 90px;
		text-align: right;
	}

	.item-line-total {
		flex: 0 0 80px;
		text-align: right;
		font-size: 0.82rem;
		color: var(--admin-text-muted);
		font-variant-numeric: tabular-nums;
	}

	.btn-remove-item {
		background: none;
		border: none;
		color: var(--admin-text-subtle);
		cursor: pointer;
		padding: 4px;
		border-radius: 4px;
		transition: color 0.15s;
		flex-shrink: 0;
	}

	.btn-remove-item:hover {
		color: var(--status-rose);
	}

	.btn-add-item {
		background: none;
		border: none;
		color: var(--admin-text-muted);
		cursor: pointer;
		font-size: 0.8rem;
		font-family: "Synonym", system-ui, sans-serif;
		padding: 4px 0;
		text-align: left;
		transition: color 0.15s;
	}

	.btn-add-item:hover {
		color: var(--admin-heading);
	}

	/* Totals */
	.totals-line {
		display: flex;
		align-items: baseline;
		gap: 8px;
		flex-wrap: wrap;
		font-size: 0.82rem;
		color: var(--admin-text-muted);
		padding-top: 4px;
	}

	.total-amount {
		font-weight: 500;
		color: var(--admin-heading);
	}

	/* Deposit calc */
	.deposit-calc {
		font-size: 0.82rem;
		color: var(--admin-text-muted);
	}

	/* Milestone row */
	.milestone-row {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.milestone-num {
		flex: 0 0 60px;
		text-align: center;
	}

	.milestone-of {
		font-size: 0.8rem;
		color: var(--admin-text-subtle);
	}

	/* Type info in detail modal */
	.type-info {
		display: flex;
		align-items: baseline;
		gap: 8px;
		flex-wrap: wrap;
		font-size: 0.82rem;
		color: var(--admin-text-muted);
	}

	.type-info-item {
		color: var(--admin-text-muted);
	}

	.detail-type {
		color: var(--admin-text-muted);
		font-size: 0.82rem;
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
	.btn-danger-outline,
	.btn-action {
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

	.btn-action {
		background: rgba(212, 160, 83, 0.12);
		border-color: rgba(212, 160, 83, 0.25);
		color: var(--status-amber);
	}

	.btn-action:hover {
		background: rgba(212, 160, 83, 0.2);
	}

	.btn-action:disabled {
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
		flex-wrap: wrap;
	}

	.meta-sep {
		color: var(--admin-text-subtle);
	}

	.detail-client {
		color: var(--admin-text);
	}

	.detail-due {
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

	.detail-notes {
		white-space: pre-wrap;
		line-height: 1.5;
	}

	/* Items detail table */
	.detail-items-table {
		display: flex;
		flex-direction: column;
	}

	.items-table-header {
		display: flex;
		gap: 8px;
		padding-bottom: 8px;
		border-bottom: 1px solid var(--admin-border);
		font-size: 0.72rem;
		color: var(--admin-text-subtle);
		letter-spacing: 0.04em;
	}

	.items-table-row {
		display: flex;
		gap: 8px;
		padding: 8px 0;
		border-bottom: 1px solid var(--admin-border);
		font-size: 0.85rem;
		color: var(--admin-text);
	}

	.itcol-desc {
		flex: 3;
		min-width: 0;
	}

	.itcol-qty {
		flex: 0 0 40px;
		text-align: center;
	}

	.itcol-price {
		flex: 0 0 80px;
		text-align: right;
		font-variant-numeric: tabular-nums;
	}

	.itcol-total {
		flex: 0 0 80px;
		text-align: right;
		font-variant-numeric: tabular-nums;
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

	.paid-note {
		font-size: 0.82rem;
		color: var(--status-sage);
		margin-left: auto;
	}

	/* Responsive */
	@media (max-width: 768px) {
		.invoice-page {
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

		.item-row {
			flex-wrap: wrap;
		}

		.item-desc {
			flex: 1 1 100%;
		}

		.item-line-total {
			flex: 1;
			text-align: left;
		}
	}
</style>
