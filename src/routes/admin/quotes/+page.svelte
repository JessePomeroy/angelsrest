<script lang="ts">
import FeatureGate from "$lib/admin/components/FeatureGate.svelte";
import type { Quote, QuotePreset } from "$lib/admin/types";
import { dollarsToCents } from "$lib/admin/utils";
import SEO from "$lib/components/SEO.svelte";
import PresetManager from "./PresetManager.svelte";
import QuoteCreateModal from "./QuoteCreateModal.svelte";
import QuoteDetailModal from "./QuoteDetailModal.svelte";
import QuoteTable from "./QuoteTable.svelte";

let { data } = $props();

// Tab state
let activeTab = $state<"quotes" | "presets">("quotes");

// Filter state
let statusFilter = $state("all");
let searchQuery = $state("");

// Modal state
let showCreateModal = $state(false);
let selectedQuote = $state<Quote | null>(null);
let saving = $state(false);
let sending = $state(false);
let shareLinkCopied = $state(false);
let sendResult = $state<"success" | "error" | null>(null);
let converting = $state(false);
let convertSuccess = $state(false);

// Preset modal state
let showPresetModal = $state(false);
let selectedPreset = $state<QuotePreset | null>(null);

const allStatuses = ["draft", "sent", "accepted", "declined", "expired"];

let filteredQuotes = $derived(
	data.quotes.filter((q: Quote) => {
		if (statusFilter !== "all" && q.status !== statusFilter) return false;
		if (searchQuery) {
			const s = searchQuery.toLowerCase();
			const matchNumber = q.quoteNumber?.toLowerCase().includes(s);
			const matchClient = q.clientName?.toLowerCase().includes(s);
			if (!matchNumber && !matchClient) return false;
		}
		return true;
	}),
);

let stats = $derived({
	total: data.quotes.length,
	draft: data.quotes.filter((q: Quote) => q.status === "draft").length,
	sent: data.quotes.filter((q: Quote) => q.status === "sent").length,
	accepted: data.quotes.filter((q: Quote) => q.status === "accepted").length,
	declined: data.quotes.filter((q: Quote) => q.status === "declined").length,
	expired: data.quotes.filter((q: Quote) => q.status === "expired").length,
});

// --- API handlers ---

async function saveNewQuote(formData: {
	quoteNumber: string;
	clientId: string;
	category: string;
	packages: {
		name: string;
		description: string;
		price: number;
		included: string[];
	}[];
	validUntil: string;
	notes: string;
}) {
	saving = true;
	try {
		const packages = formData.packages.map((pkg) => ({
			name: pkg.name,
			description: pkg.description || undefined,
			price: dollarsToCents(pkg.price),
			included: pkg.included.length > 0 ? pkg.included : undefined,
		}));
		const body: Record<string, unknown> = {
			quoteNumber: formData.quoteNumber,
			clientId: formData.clientId,
			category: formData.category,
			packages,
		};
		if (formData.validUntil) body.validUntil = formData.validUntil;
		if (formData.notes) body.notes = formData.notes;

		const res = await fetch("/api/admin/quotes", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});
		if (res.ok) {
			showCreateModal = false;
			window.location.reload();
		}
	} catch (err) {
		console.error("Failed to create quote:", err);
	} finally {
		saving = false;
	}
}

async function saveAsPreset(presetData: {
	name: string;
	category: string;
	packages: {
		name: string;
		description: string;
		price: number;
		included: string[];
	}[];
}) {
	saving = true;
	try {
		const packages = presetData.packages.map((pkg) => ({
			name: pkg.name,
			description: pkg.description || undefined,
			price: dollarsToCents(pkg.price),
			included: pkg.included.length > 0 ? pkg.included : undefined,
		}));
		const res = await fetch("/api/admin/quotes", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				_type: "preset",
				name: presetData.name,
				category: presetData.category,
				packages,
			}),
		});
		if (res.ok) {
			window.location.reload();
		}
	} catch (err) {
		console.error("Failed to save preset:", err);
	} finally {
		saving = false;
	}
}

async function saveQuoteEdit(editData: {
	packages: {
		name: string;
		description: string;
		price: number;
		included: string[];
	}[];
	category: "photography" | "web";
	validUntil: string;
	notes: string;
}) {
	if (!selectedQuote) return;
	saving = true;
	try {
		const packages = editData.packages.map((pkg) => ({
			name: pkg.name,
			description: pkg.description || undefined,
			price: pkg.price,
			included: pkg.included.length > 0 ? pkg.included : undefined,
		}));
		const body: Record<string, unknown> = {
			packages,
			category: editData.category,
		};
		body.validUntil = editData.validUntil || undefined;
		body.notes = editData.notes || undefined;

		const res = await fetch(`/api/admin/quotes/${selectedQuote._id}`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});
		if (res.ok) {
			const idx = data.quotes.findIndex(
				(q: Quote) => q._id === selectedQuote!._id,
			);
			if (idx !== -1) {
				data.quotes[idx] = {
					...data.quotes[idx],
					packages,
					category: editData.category,
					validUntil: editData.validUntil || undefined,
					notes: editData.notes || undefined,
				};
				data.quotes = [...data.quotes];
			}
			selectedQuote = {
				...selectedQuote,
				packages,
				category: editData.category,
				validUntil: editData.validUntil || undefined,
				notes: editData.notes || undefined,
			} as Quote;
		}
	} catch (err) {
		console.error("Failed to update quote:", err);
	} finally {
		saving = false;
	}
}

async function sendQuoteEmail() {
	if (!selectedQuote) return;
	sending = true;
	sendResult = null;
	try {
		const res = await fetch(`/api/admin/quotes/${selectedQuote._id}/send`, {
			method: "POST",
		});
		if (res.ok) {
			sendResult = "success";
			const idx = data.quotes.findIndex(
				(q: Quote) => q._id === selectedQuote!._id,
			);
			if (idx !== -1) {
				data.quotes[idx] = { ...data.quotes[idx], status: "sent" };
				data.quotes = [...data.quotes];
			}
			selectedQuote = { ...selectedQuote, status: "sent" } as Quote;
		} else {
			sendResult = "error";
		}
	} catch (err) {
		console.error("Failed to send quote email:", err);
		sendResult = "error";
	} finally {
		sending = false;
	}
}

async function quoteAction(action: string) {
	if (!selectedQuote) return;
	saving = true;
	try {
		const res = await fetch(`/api/admin/quotes/${selectedQuote._id}`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ action }),
		});
		if (res.ok) {
			const newStatus =
				action === "send"
					? "sent"
					: action === "accept"
						? "accepted"
						: action === "decline"
							? "declined"
							: action === "expire"
								? "expired"
								: selectedQuote.status;
			const idx = data.quotes.findIndex(
				(q: Quote) => q._id === selectedQuote!._id,
			);
			if (idx !== -1) {
				data.quotes[idx] = { ...data.quotes[idx], status: newStatus };
				data.quotes = [...data.quotes];
			}
			selectedQuote = { ...selectedQuote, status: newStatus } as Quote;
		}
	} catch (err) {
		console.error("Failed to update quote:", err);
	} finally {
		saving = false;
	}
}

async function deleteQuote() {
	if (!selectedQuote) return;
	saving = true;
	try {
		const res = await fetch(`/api/admin/quotes/${selectedQuote._id}`, {
			method: "DELETE",
		});
		if (res.ok) {
			data.quotes = data.quotes.filter(
				(q: Quote) => q._id !== selectedQuote!._id,
			);
			selectedQuote = null;
		}
	} catch (err) {
		console.error("Failed to delete quote:", err);
	} finally {
		saving = false;
	}
}

async function convertToInvoice(convertData: {
	invoiceNumber: string;
	invoiceType: string;
	dueDate: string;
	notes: string;
}) {
	if (!selectedQuote) return;
	converting = true;
	try {
		const body: Record<string, unknown> = {
			action: "convert",
			invoiceNumber: convertData.invoiceNumber,
			invoiceType: convertData.invoiceType,
		};
		if (convertData.dueDate) body.dueDate = convertData.dueDate;
		if (convertData.notes) body.notes = convertData.notes;

		const res = await fetch(`/api/admin/quotes/${selectedQuote._id}`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});
		if (res.ok) {
			const result = await res.json();
			const invoiceId = result.invoiceId || "converted";
			const idx = data.quotes.findIndex(
				(q: Quote) => q._id === selectedQuote!._id,
			);
			if (idx !== -1) {
				data.quotes[idx] = {
					...data.quotes[idx],
					convertedToInvoice: invoiceId,
				};
				data.quotes = [...data.quotes];
			}
			selectedQuote = {
				...selectedQuote,
				convertedToInvoice: invoiceId,
			} as Quote;
			convertSuccess = true;
		}
	} catch (err) {
		console.error("Failed to convert quote to invoice:", err);
	} finally {
		converting = false;
	}
}

async function copyShareLink() {
	if (!selectedQuote) return;
	shareLinkCopied = false;
	try {
		const res = await fetch("/api/admin/portal", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				type: "quote",
				documentId: selectedQuote._id,
				clientId: selectedQuote.clientId,
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
	} catch (err) {
		console.error("Failed to create share link:", err);
	}
}

// Preset API handlers

async function saveNewPreset(presetData: {
	name: string;
	category: "photography" | "web" | "";
	packages: {
		name: string;
		description: string;
		price: number;
		included: string[];
	}[];
}) {
	saving = true;
	try {
		const packages = presetData.packages.map((pkg) => ({
			name: pkg.name,
			description: pkg.description || undefined,
			price: pkg.price,
			included: pkg.included.length > 0 ? pkg.included : undefined,
		}));
		const body: Record<string, unknown> = {
			_type: "preset",
			name: presetData.name,
			packages,
		};
		if (presetData.category) body.category = presetData.category;
		const res = await fetch("/api/admin/quotes", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});
		if (res.ok) {
			window.location.reload();
		}
	} catch (err) {
		console.error("Failed to create preset:", err);
	} finally {
		saving = false;
	}
}

async function savePresetEdit(editData: {
	presetId: string;
	name: string;
	category: "photography" | "web" | "";
	packages: {
		name: string;
		description: string;
		price: number;
		included: string[];
	}[];
}) {
	saving = true;
	try {
		const packages = editData.packages.map((pkg) => ({
			name: pkg.name,
			description: pkg.description || undefined,
			price: pkg.price,
			included: pkg.included.length > 0 ? pkg.included : undefined,
		}));
		const body: Record<string, unknown> = {
			_type: "preset",
			name: editData.name,
			packages,
		};
		if (editData.category) body.category = editData.category;
		else body.category = undefined;
		const res = await fetch(`/api/admin/quotes/${editData.presetId}`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});
		if (res.ok) {
			const idx = data.presets.findIndex(
				(p: QuotePreset) => p._id === editData.presetId,
			);
			if (idx !== -1) {
				data.presets[idx] = {
					...data.presets[idx],
					name: editData.name,
					category: editData.category || undefined,
					packages,
				};
				data.presets = [...data.presets];
			}
			selectedPreset = {
				...selectedPreset!,
				name: editData.name,
				category: editData.category || undefined,
				packages,
			} as QuotePreset;
		}
	} catch (err) {
		console.error("Failed to update preset:", err);
	} finally {
		saving = false;
	}
}

async function deletePreset(presetId: string) {
	saving = true;
	try {
		const res = await fetch(`/api/admin/quotes/${presetId}`, {
			method: "DELETE",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ _type: "preset" }),
		});
		if (res.ok) {
			data.presets = data.presets.filter(
				(p: QuotePreset) => p._id !== presetId,
			);
			showPresetModal = false;
			selectedPreset = null;
		}
	} catch (err) {
		console.error("Failed to delete preset:", err);
	} finally {
		saving = false;
	}
}

function openDetailModal(quote: Quote) {
	selectedQuote = { ...quote };
	sendResult = null;
	shareLinkCopied = false;
	converting = false;
	convertSuccess = false;
}

function openPresetModal(preset?: QuotePreset) {
	selectedPreset = preset ? ({ ...preset } as QuotePreset) : null;
	showPresetModal = true;
}

function closePresetModal() {
	showPresetModal = false;
	selectedPreset = null;
}
</script>

<SEO title="Quotes | Admin" description="Manage quotes" />

<FeatureGate feature="quotes" tier={data.tier}>
<div class="quote-page">
	<header class="page-header">
		<div class="header-left">
			<h1>quotes</h1>
		</div>
		<button class="btn-add" onclick={() => { if (activeTab === "presets") openPresetModal(); else showCreateModal = true; }}>
			<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
			{activeTab === "presets" ? "new preset" : "new quote"}
		</button>
	</header>

	<div class="stats-line">
		<span>{stats.total} total</span>
		<span class="stat-sep">&middot;</span>
		<span>{stats.draft} draft</span>
		<span class="stat-sep">&middot;</span>
		<span>{stats.sent} sent</span>
		<span class="stat-sep">&middot;</span>
		<span>{stats.accepted} accepted</span>
		<span class="stat-sep">&middot;</span>
		<span>{stats.declined} declined</span>
		{#if stats.expired > 0}
			<span class="stat-sep">&middot;</span>
			<span>{stats.expired} expired</span>
		{/if}
	</div>

	<div class="tab-bar">
		<button class="tab-btn" class:tab-active={activeTab === "quotes"} onclick={() => { activeTab = "quotes"; }}>quotes</button>
		<button class="tab-btn" class:tab-active={activeTab === "presets"} onclick={() => { activeTab = "presets"; }}>presets</button>
	</div>

	{#if activeTab === "quotes"}
		<div class="filter-bar">
			<select class="filter-select" bind:value={statusFilter}>
				<option value="all">all statuses</option>
				{#each allStatuses as s}
					<option value={s}>{s}</option>
				{/each}
			</select>
			<input class="filter-search" type="text" placeholder="search by quote # or client..." bind:value={searchQuery} />
		</div>

		<QuoteTable quotes={filteredQuotes} onselect={openDetailModal} />
	{:else}
		<PresetManager
			presets={data.presets}
			{showPresetModal}
			{selectedPreset}
			{saving}
			onopen={openPresetModal}
			onclose={closePresetModal}
			onsavenew={saveNewPreset}
			onsaveedit={savePresetEdit}
			ondelete={deletePreset}
		/>
	{/if}
</div>

{#if showCreateModal}
	<QuoteCreateModal
		clients={data.clients}
		presets={data.presets}
		nextNumber={data.nextNumber}
		{saving}
		onsave={saveNewQuote}
		onsaveaspreset={saveAsPreset}
		onclose={() => { showCreateModal = false; }}
	/>
{/if}

{#if selectedQuote}
	<QuoteDetailModal
		quote={selectedQuote}
		nextInvoiceNumber={data.nextInvoiceNumber}
		{saving}
		{sending}
		{shareLinkCopied}
		{sendResult}
		{convertSuccess}
		{converting}
		onclose={() => { selectedQuote = null; sendResult = null; convertSuccess = false; }}
		onsaveedit={saveQuoteEdit}
		onsendquoteemail={sendQuoteEmail}
		onquoteaction={quoteAction}
		ondeletequote={deleteQuote}
		oncopysharelink={copyShareLink}
		onconverttoinvoice={convertToInvoice}
		onsendresultclear={() => { sendResult = null; }}
	/>
{/if}
</FeatureGate>

<style>
	.quote-page {
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
		color: var(--admin-text-muted);
		font-size: 0.85rem;
		font-family: "Synonym", system-ui, sans-serif;
		padding: 8px 16px;
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
		.quote-page {
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
