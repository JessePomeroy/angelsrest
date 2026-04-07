<script lang="ts">
import FeatureGate from "$lib/admin/components/FeatureGate.svelte";
import SEO from "$lib/components/SEO.svelte";

let { data } = $props();

// Tab state
let activeTab = $state<"quotes" | "presets">("quotes");

// Filter state
let statusFilter = $state("all");
let searchQuery = $state("");

// Modal state
let showCreateModal = $state(false);
let selectedQuote = $state<any>(null);
let editMode = $state(false);
let confirmDelete = $state(false);
let saving = $state(false);

// Create form state
let formNumber = $state("");
let formClientId = $state("");
let formCategory = $state<"photography" | "web">("photography");
let formValidUntil = $state("");
let formNotes = $state("");
let formPackages = $state<
	{
		name: string;
		description: string;
		price: number;
		included: string[];
	}[]
>([{ name: "", description: "", price: 0, included: [] }]);
let newIncludedItem = $state<Record<number, string>>({});
let formPresetId = $state("");

// Edit form state
let editPackages = $state<
	{
		name: string;
		description: string;
		price: number;
		included: string[];
	}[]
>([]);
let editValidUntil = $state("");
let editNotes = $state("");
let editCategory = $state<"photography" | "web">("photography");
let editNewIncludedItem = $state<Record<number, string>>({});

// Preset modal state
let selectedPreset = $state<any>(null);
let presetEditMode = $state(false);
let presetName = $state("");
let presetCategory = $state<"photography" | "web" | "">("photography");
let presetPackages = $state<
	{
		name: string;
		description: string;
		price: number;
		included: string[];
	}[]
>([]);
let presetNewIncludedItem = $state<Record<number, string>>({});
let confirmDeletePreset = $state(false);

// Convert to invoice state
let showConvertForm = $state(false);
let convertInvoiceNumber = $state("");
let convertInvoiceType = $state("one-time");
let convertDueDate = $state("");
let convertNotes = $state("");
let converting = $state(false);
let convertSuccess = $state(false);

const allStatuses = ["draft", "sent", "accepted", "declined", "expired"];

let filteredQuotes = $derived(
	data.quotes.filter((q: any) => {
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
	draft: data.quotes.filter((q: any) => q.status === "draft").length,
	sent: data.quotes.filter((q: any) => q.status === "sent").length,
	accepted: data.quotes.filter((q: any) => q.status === "accepted").length,
	declined: data.quotes.filter((q: any) => q.status === "declined").length,
	expired: data.quotes.filter((q: any) => q.status === "expired").length,
});

function formatCents(cents: number): string {
	return `$${(cents / 100).toFixed(2)}`;
}

function dollarsToCents(dollars: number): number {
	return Math.round(dollars * 100);
}

function getStatusColor(status: string): string {
	const colors: Record<string, string> = {
		draft: "var(--admin-text-subtle)",
		sent: "var(--status-amber)",
		accepted: "var(--status-sage)",
		declined: "var(--status-rose)",
		expired: "var(--admin-text-subtle)",
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

function calcPackagesTotal(pkgs: { price: number }[]): number {
	return pkgs.reduce((sum, pkg) => sum + pkg.price, 0);
}

function resetCreateForm() {
	formNumber = data.nextNumber;
	formClientId = "";
	formCategory = "photography";
	formValidUntil = "";
	formNotes = "";
	formPackages = [{ name: "", description: "", price: 0, included: [] }];
	newIncludedItem = {};
	formPresetId = "";
}

function openCreateModal() {
	resetCreateForm();
	showCreateModal = true;
}

function closeCreateModal() {
	showCreateModal = false;
}

function addPackage() {
	formPackages = [
		...formPackages,
		{ name: "", description: "", price: 0, included: [] },
	];
}

function removePackage(index: number) {
	formPackages = formPackages.filter((_, i) => i !== index);
}

function addIncludedItem(pkgIndex: number) {
	const text = (newIncludedItem[pkgIndex] || "").trim();
	if (!text) return;
	formPackages[pkgIndex].included = [...formPackages[pkgIndex].included, text];
	formPackages = [...formPackages];
	newIncludedItem = { ...newIncludedItem, [pkgIndex]: "" };
}

function removeIncludedItem(pkgIndex: number, itemIndex: number) {
	formPackages[pkgIndex].included = formPackages[pkgIndex].included.filter(
		(_, i) => i !== itemIndex,
	);
	formPackages = [...formPackages];
}

function loadPreset() {
	if (!formPresetId) return;
	const preset = data.presets.find((p: any) => p._id === formPresetId);
	if (!preset) return;
	formPackages = preset.packages.map((pkg: any) => ({
		name: pkg.name || "",
		description: pkg.description || "",
		price: pkg.price / 100,
		included: [...(pkg.included || [])],
	}));
	if (preset.category) {
		formCategory = preset.category;
	}
	newIncludedItem = {};
}

async function saveAsPreset() {
	const name = prompt("preset name:");
	if (!name) return;
	saving = true;
	try {
		const packages = formPackages.map((pkg) => ({
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
				name,
				category: formCategory,
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

function addEditPackage() {
	editPackages = [
		...editPackages,
		{ name: "", description: "", price: 0, included: [] },
	];
}

function removeEditPackage(index: number) {
	editPackages = editPackages.filter((_, i) => i !== index);
}

function addEditIncludedItem(pkgIndex: number) {
	const text = (editNewIncludedItem[pkgIndex] || "").trim();
	if (!text) return;
	editPackages[pkgIndex].included = [...editPackages[pkgIndex].included, text];
	editPackages = [...editPackages];
	editNewIncludedItem = { ...editNewIncludedItem, [pkgIndex]: "" };
}

function removeEditIncludedItem(pkgIndex: number, itemIndex: number) {
	editPackages[pkgIndex].included = editPackages[pkgIndex].included.filter(
		(_, i) => i !== itemIndex,
	);
	editPackages = [...editPackages];
}

function openDetailModal(quote: any) {
	selectedQuote = { ...quote };
	editMode = false;
	confirmDelete = false;
	showConvertForm = false;
	convertInvoiceNumber = data.nextInvoiceNumber;
	convertInvoiceType = "one-time";
	convertDueDate = "";
	convertNotes = quote.notes || "";
	converting = false;
	convertSuccess = false;
}

function closeDetailModal() {
	selectedQuote = null;
	editMode = false;
	confirmDelete = false;
	showConvertForm = false;
	convertSuccess = false;
}

function startEdit() {
	if (!selectedQuote) return;
	editPackages = selectedQuote.packages.map((pkg: any) => ({
		name: pkg.name || "",
		description: pkg.description || "",
		price: pkg.price,
		included: [...(pkg.included || [])],
	}));
	editValidUntil = selectedQuote.validUntil || "";
	editNotes = selectedQuote.notes || "";
	editCategory = selectedQuote.category || "photography";
	editNewIncludedItem = {};
	editMode = true;
}

function cancelEdit() {
	editMode = false;
}

let createTotal = $derived(
	formPackages.reduce((sum, pkg) => sum + dollarsToCents(pkg.price), 0),
);

let editTotal = $derived(calcPackagesTotal(editPackages));

async function saveNewQuote() {
	if (!formNumber || !formClientId || formPackages.length === 0) return;
	saving = true;
	try {
		const packages = formPackages.map((pkg) => ({
			name: pkg.name,
			description: pkg.description || undefined,
			price: dollarsToCents(pkg.price),
			included: pkg.included.length > 0 ? pkg.included : undefined,
		}));
		const body: Record<string, unknown> = {
			quoteNumber: formNumber,
			clientId: formClientId,
			category: formCategory,
			packages,
		};
		if (formValidUntil) body.validUntil = formValidUntil;
		if (formNotes) body.notes = formNotes;

		const res = await fetch("/api/admin/quotes", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});
		if (res.ok) {
			closeCreateModal();
			window.location.reload();
		}
	} catch (err) {
		console.error("Failed to create quote:", err);
	} finally {
		saving = false;
	}
}

async function saveEdit() {
	if (!selectedQuote || editPackages.length === 0) return;
	saving = true;
	try {
		const packages = editPackages.map((pkg) => ({
			name: pkg.name,
			description: pkg.description || undefined,
			price: pkg.price,
			included: pkg.included.length > 0 ? pkg.included : undefined,
		}));
		const body: Record<string, unknown> = {
			packages,
			category: editCategory,
		};
		body.validUntil = editValidUntil || undefined;
		body.notes = editNotes || undefined;

		const res = await fetch(`/api/admin/quotes/${selectedQuote._id}`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});
		if (res.ok) {
			const idx = data.quotes.findIndex(
				(q: any) => q._id === selectedQuote._id,
			);
			if (idx !== -1) {
				data.quotes[idx] = {
					...data.quotes[idx],
					packages,
					category: editCategory,
					validUntil: editValidUntil || undefined,
					notes: editNotes || undefined,
				};
				data.quotes = [...data.quotes];
			}
			selectedQuote = {
				...selectedQuote,
				packages,
				category: editCategory,
				validUntil: editValidUntil || undefined,
				notes: editNotes || undefined,
			};
			editMode = false;
		}
	} catch (err) {
		console.error("Failed to update quote:", err);
	} finally {
		saving = false;
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
				(q: any) => q._id === selectedQuote._id,
			);
			if (idx !== -1) {
				data.quotes[idx] = { ...data.quotes[idx], status: newStatus };
				data.quotes = [...data.quotes];
			}
			selectedQuote = { ...selectedQuote, status: newStatus };
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
			data.quotes = data.quotes.filter((q: any) => q._id !== selectedQuote._id);
			closeDetailModal();
		}
	} catch (err) {
		console.error("Failed to delete quote:", err);
	} finally {
		saving = false;
	}
}

async function convertToInvoice() {
	if (!selectedQuote || !convertInvoiceNumber) return;
	converting = true;
	try {
		const body: Record<string, unknown> = {
			action: "convert",
			invoiceNumber: convertInvoiceNumber,
			invoiceType: convertInvoiceType,
		};
		if (convertDueDate) body.dueDate = convertDueDate;
		if (convertNotes) body.notes = convertNotes;

		const res = await fetch(`/api/admin/quotes/${selectedQuote._id}`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});
		if (res.ok) {
			const result = await res.json();
			const invoiceId = result.invoiceId || "converted";
			const idx = data.quotes.findIndex(
				(q: any) => q._id === selectedQuote._id,
			);
			if (idx !== -1) {
				data.quotes[idx] = {
					...data.quotes[idx],
					convertedToInvoice: invoiceId,
				};
				data.quotes = [...data.quotes];
			}
			selectedQuote = { ...selectedQuote, convertedToInvoice: invoiceId };
			showConvertForm = false;
			convertSuccess = true;
		}
	} catch (err) {
		console.error("Failed to convert quote to invoice:", err);
	} finally {
		converting = false;
	}
}

// Preset functions
function openPresetModal(preset?: any) {
	if (preset) {
		selectedPreset = { ...preset };
		presetName = preset.name;
		presetCategory = preset.category || "";
		presetPackages = preset.packages.map((pkg: any) => ({
			name: pkg.name || "",
			description: pkg.description || "",
			price: pkg.price,
			included: [...(pkg.included || [])],
		}));
		presetEditMode = false;
	} else {
		selectedPreset = null;
		presetName = "";
		presetCategory = "photography";
		presetPackages = [{ name: "", description: "", price: 0, included: [] }];
		presetEditMode = true;
	}
	presetNewIncludedItem = {};
	confirmDeletePreset = false;
}

function closePresetModal() {
	selectedPreset = null;
	presetEditMode = false;
	confirmDeletePreset = false;
}

function startPresetEdit() {
	if (!selectedPreset) return;
	presetName = selectedPreset.name;
	presetCategory = selectedPreset.category || "";
	presetPackages = selectedPreset.packages.map((pkg: any) => ({
		name: pkg.name || "",
		description: pkg.description || "",
		price: pkg.price,
		included: [...(pkg.included || [])],
	}));
	presetNewIncludedItem = {};
	presetEditMode = true;
}

function addPresetPackage() {
	presetPackages = [
		...presetPackages,
		{ name: "", description: "", price: 0, included: [] },
	];
}

function removePresetPackage(index: number) {
	presetPackages = presetPackages.filter((_, i) => i !== index);
}

function addPresetIncludedItem(pkgIndex: number) {
	const text = (presetNewIncludedItem[pkgIndex] || "").trim();
	if (!text) return;
	presetPackages[pkgIndex].included = [
		...presetPackages[pkgIndex].included,
		text,
	];
	presetPackages = [...presetPackages];
	presetNewIncludedItem = { ...presetNewIncludedItem, [pkgIndex]: "" };
}

function removePresetIncludedItem(pkgIndex: number, itemIndex: number) {
	presetPackages[pkgIndex].included = presetPackages[pkgIndex].included.filter(
		(_, i) => i !== itemIndex,
	);
	presetPackages = [...presetPackages];
}

let presetTotal = $derived(calcPackagesTotal(presetPackages));

async function saveNewPreset() {
	if (!presetName || presetPackages.length === 0) return;
	saving = true;
	try {
		const packages = presetPackages.map((pkg) => ({
			name: pkg.name,
			description: pkg.description || undefined,
			price: pkg.price,
			included: pkg.included.length > 0 ? pkg.included : undefined,
		}));
		const body: Record<string, unknown> = {
			_type: "preset",
			name: presetName,
			packages,
		};
		if (presetCategory) body.category = presetCategory;

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

async function savePresetEdit() {
	if (!selectedPreset || !presetName || presetPackages.length === 0) return;
	saving = true;
	try {
		const packages = presetPackages.map((pkg) => ({
			name: pkg.name,
			description: pkg.description || undefined,
			price: pkg.price,
			included: pkg.included.length > 0 ? pkg.included : undefined,
		}));
		const body: Record<string, unknown> = {
			_type: "preset",
			name: presetName,
			packages,
		};
		if (presetCategory) body.category = presetCategory;
		else body.category = undefined;

		const res = await fetch(`/api/admin/quotes/${selectedPreset._id}`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});
		if (res.ok) {
			const idx = data.presets.findIndex(
				(p: any) => p._id === selectedPreset._id,
			);
			if (idx !== -1) {
				data.presets[idx] = {
					...data.presets[idx],
					name: presetName,
					category: presetCategory || undefined,
					packages,
				};
				data.presets = [...data.presets];
			}
			selectedPreset = {
				...selectedPreset,
				name: presetName,
				category: presetCategory || undefined,
				packages,
			};
			presetEditMode = false;
		}
	} catch (err) {
		console.error("Failed to update preset:", err);
	} finally {
		saving = false;
	}
}

async function deletePreset() {
	if (!selectedPreset) return;
	saving = true;
	try {
		const res = await fetch(`/api/admin/quotes/${selectedPreset._id}`, {
			method: "DELETE",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ _type: "preset" }),
		});
		if (res.ok) {
			data.presets = data.presets.filter(
				(p: any) => p._id !== selectedPreset._id,
			);
			closePresetModal();
		}
	} catch (err) {
		console.error("Failed to delete preset:", err);
	} finally {
		saving = false;
	}
}
</script>

<SEO title="Quotes | Admin" description="Manage quotes" />

<FeatureGate feature="quotes" tier={data.tier}>
<div class="quote-page">
	<header class="page-header">
		<div class="header-left">
			<h1>quotes</h1>
		</div>
		<button class="btn-add" onclick={() => { if (activeTab === "presets") openPresetModal(); else openCreateModal(); }}>
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

	<!-- Tab toggle -->
	<div class="tab-bar">
		<button
			class="tab-btn"
			class:tab-active={activeTab === "quotes"}
			onclick={() => { activeTab = "quotes"; }}
		>quotes</button>
		<button
			class="tab-btn"
			class:tab-active={activeTab === "presets"}
			onclick={() => { activeTab = "presets"; }}
		>presets</button>
	</div>

	{#if activeTab === "quotes"}
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
				placeholder="search by quote # or client..."
				bind:value={searchQuery}
			/>
		</div>

		{#if filteredQuotes.length === 0}
			<div class="empty-state">no quotes found</div>
		{:else}
			<div class="table-wrap">
				<table class="q-table">
					<thead>
						<tr>
							<th>quote #</th>
							<th>client</th>
							<th>category</th>
							<th>packages</th>
							<th>total</th>
							<th>valid until</th>
							<th>status</th>
						</tr>
					</thead>
					<tbody>
						{#each filteredQuotes as q (q._id)}
							{@const total = calcPackagesTotal(q.packages)}
							<tr
								class="q-row"
								role="button"
								tabindex="0"
								onclick={() => openDetailModal(q)}
								onkeydown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDetailModal(q); } }}
							>
								<td class="td-number">{q.quoteNumber}</td>
								<td class="td-client">{q.clientName}</td>
								<td class="td-category">{q.category || "\u2014"}</td>
								<td class="td-packages">{q.packages.length} package{q.packages.length !== 1 ? "s" : ""}</td>
								<td class="td-total">{formatCents(total)}</td>
								<td class="td-date">{q.validUntil ? formatDate(q.validUntil) : "\u2014"}</td>
								<td>
									<span class="status-indicator">
										<span class="status-dot" style="background: {getStatusColor(q.status)}"></span>
										{q.status}
									</span>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	{:else}
		<!-- Presets tab -->
		{#if data.presets.length === 0}
			<div class="empty-state">no presets yet</div>
		{:else}
			<div class="presets-list">
				{#each data.presets as preset (preset._id)}
					<button
						class="preset-item"
						onclick={() => openPresetModal(preset)}
					>
						<span class="preset-name">{preset.name}</span>
						<span class="preset-meta">
							{#if preset.category}
								<span class="preset-category">{preset.category}</span>
								<span class="meta-sep">&middot;</span>
							{/if}
							<span>{preset.packages.length} package{preset.packages.length !== 1 ? "s" : ""}</span>
						</span>
					</button>
				{/each}
			</div>
		{/if}
	{/if}
</div>

<!-- Create Quote Modal -->
{#if showCreateModal}
	<div class="modal-overlay" role="dialog" tabindex="-1" aria-modal="true" aria-label="Create quote" onclick={closeCreateModal} onkeydown={(e) => { if (e.key === "Escape") closeCreateModal(); }}>
		<div class="modal-content modal-wide" role="presentation" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()}>
			<div class="modal-header">
				<h2 class="modal-title">new quote</h2>
				<button class="modal-close" aria-label="Close" onclick={closeCreateModal}>
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
				</button>
			</div>

			<form class="modal-form" onsubmit={(e) => { e.preventDefault(); saveNewQuote(); }}>
				<div class="form-row">
					<div class="form-group">
						<label class="form-label" for="create-number">quote # <span class="required">*</span></label>
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

				<div class="form-row">
					<div class="form-group">
						<label class="form-label" for="create-category">category</label>
						<select id="create-category" class="form-input" bind:value={formCategory}>
							<option value="photography">photography</option>
							<option value="web">web</option>
						</select>
					</div>
					<div class="form-group">
						<label class="form-label" for="create-valid">valid until</label>
						<input id="create-valid" class="form-input" type="date" bind:value={formValidUntil} />
					</div>
				</div>

				<div class="form-group">
					<label class="form-label" for="create-notes">notes</label>
					<textarea id="create-notes" class="form-input form-textarea" bind:value={formNotes} rows="2" placeholder="additional notes..."></textarea>
				</div>

				<div class="packages-section">
					<div class="packages-header">
						<span class="form-label">packages <span class="required">*</span></span>
					</div>

					{#if data.presets.length > 0}
						<div class="preset-load-row">
							<select class="form-input" bind:value={formPresetId} onchange={loadPreset}>
								<option value="">load preset...</option>
								{#each data.presets as p (p._id)}
									<option value={p._id}>{p.name}</option>
								{/each}
							</select>
						</div>
					{/if}

					{#each formPackages as pkg, i}
						<div class="package-block">
							<div class="package-block-header">
								<span class="package-num">package {i + 1}</span>
								{#if formPackages.length > 1}
									<button type="button" class="btn-remove-item" onclick={() => removePackage(i)} aria-label="Remove package">
										<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
									</button>
								{/if}
							</div>
							<div class="form-row">
								<div class="form-group">
									<label class="form-label" for="pkg-name-{i}">name <span class="required">*</span></label>
									<input id="pkg-name-{i}" class="form-input" type="text" placeholder="e.g. basic" bind:value={pkg.name} required />
								</div>
								<div class="form-group">
									<label class="form-label" for="pkg-price-{i}">price ($) <span class="required">*</span></label>
									<input id="pkg-price-{i}" class="form-input" type="number" min="0" step="0.01" bind:value={pkg.price} required />
								</div>
							</div>
							<div class="form-group">
								<label class="form-label" for="pkg-desc-{i}">description</label>
								<input id="pkg-desc-{i}" class="form-input" type="text" placeholder="package description..." bind:value={pkg.description} />
							</div>
							<div class="form-group">
								<span class="form-label">included items</span>
								{#if pkg.included.length > 0}
									<div class="included-list">
										{#each pkg.included as item, j}
											<div class="included-item">
												<span>{item}</span>
												<button type="button" class="btn-remove-included" onclick={() => removeIncludedItem(i, j)} aria-label="Remove item">
													<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
												</button>
											</div>
										{/each}
									</div>
								{/if}
								<div class="included-add-row">
									<input class="form-input included-input" type="text" placeholder="add included item..." bind:value={newIncludedItem[i]} onkeydown={(e) => { if (e.key === "Enter") { e.preventDefault(); addIncludedItem(i); } }} />
									<button type="button" class="btn-add-included" onclick={() => addIncludedItem(i)}>+</button>
								</div>
							</div>
						</div>
					{/each}
					<div class="packages-actions-row">
						<button type="button" class="btn-add-item" onclick={addPackage}>+ add package</button>
						<button type="button" class="btn-add-item" onclick={saveAsPreset} disabled={saving || formPackages.length === 0}>save as preset</button>
					</div>
				</div>

				<div class="totals-line">
					<span class="total-amount">total: {formatCents(createTotal)}</span>
				</div>

				<div class="modal-actions">
					<button type="button" class="btn-cancel" onclick={closeCreateModal}>cancel</button>
					<button type="submit" class="btn-save" disabled={saving || !formNumber || !formClientId || formPackages.length === 0}>
						{saving ? "saving..." : "save as draft"}
					</button>
				</div>
			</form>
		</div>
	</div>
{/if}

<!-- Detail / Edit Modal -->
{#if selectedQuote}
	{@const detailTotal = calcPackagesTotal(selectedQuote.packages)}
	<div class="modal-overlay" role="dialog" tabindex="-1" aria-modal="true" aria-label="Quote details" onclick={closeDetailModal} onkeydown={(e) => { if (e.key === "Escape") closeDetailModal(); }}>
		<div class="modal-content modal-wide" role="presentation" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()}>
			<div class="modal-header">
				<h2 class="modal-title">{editMode ? "edit quote" : selectedQuote.quoteNumber}</h2>
				<button class="modal-close" aria-label="Close" onclick={closeDetailModal}>
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
				</button>
			</div>

			{#if editMode}
				<form class="modal-form" onsubmit={(e) => { e.preventDefault(); saveEdit(); }}>
					<div class="form-row">
						<div class="form-group">
							<label class="form-label" for="edit-category">category</label>
							<select id="edit-category" class="form-input" bind:value={editCategory}>
								<option value="photography">photography</option>
								<option value="web">web</option>
							</select>
						</div>
						<div class="form-group">
							<label class="form-label" for="edit-valid">valid until</label>
							<input id="edit-valid" class="form-input" type="date" bind:value={editValidUntil} />
						</div>
					</div>

					<div class="form-group">
						<label class="form-label" for="edit-notes">notes</label>
						<textarea id="edit-notes" class="form-input form-textarea" bind:value={editNotes} rows="2"></textarea>
					</div>

					<div class="packages-section">
						<div class="packages-header">
							<span class="form-label">packages</span>
						</div>

						{#each editPackages as pkg, i}
							<div class="package-block">
								<div class="package-block-header">
									<span class="package-num">package {i + 1}</span>
									{#if editPackages.length > 1}
										<button type="button" class="btn-remove-item" onclick={() => removeEditPackage(i)} aria-label="Remove package">
											<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
										</button>
									{/if}
								</div>
								<div class="form-row">
									<div class="form-group">
										<label class="form-label" for="edit-pkg-name-{i}">name</label>
										<input id="edit-pkg-name-{i}" class="form-input" type="text" bind:value={pkg.name} required />
									</div>
									<div class="form-group">
										<label class="form-label" for="edit-pkg-price-{i}">price (cents)</label>
										<input id="edit-pkg-price-{i}" class="form-input" type="number" min="0" step="1" bind:value={pkg.price} required />
									</div>
								</div>
								<div class="form-group">
									<label class="form-label" for="edit-pkg-desc-{i}">description</label>
									<input id="edit-pkg-desc-{i}" class="form-input" type="text" bind:value={pkg.description} />
								</div>
								<div class="form-group">
									<span class="form-label">included items</span>
									{#if pkg.included.length > 0}
										<div class="included-list">
											{#each pkg.included as item, j}
												<div class="included-item">
													<span>{item}</span>
													<button type="button" class="btn-remove-included" onclick={() => removeEditIncludedItem(i, j)} aria-label="Remove item">
														<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
													</button>
												</div>
											{/each}
										</div>
									{/if}
									<div class="included-add-row">
										<input class="form-input included-input" type="text" placeholder="add included item..." bind:value={editNewIncludedItem[i]} onkeydown={(e) => { if (e.key === "Enter") { e.preventDefault(); addEditIncludedItem(i); } }} />
										<button type="button" class="btn-add-included" onclick={() => addEditIncludedItem(i)}>+</button>
									</div>
								</div>
							</div>
						{/each}
						<button type="button" class="btn-add-item" onclick={addEditPackage}>+ add package</button>
					</div>

					<div class="totals-line">
						<span class="total-amount">total: {formatCents(editTotal)}</span>
					</div>

					<div class="modal-actions">
						<button type="button" class="btn-cancel" onclick={cancelEdit}>cancel</button>
						<button type="submit" class="btn-save" disabled={saving || editPackages.length === 0}>
							{saving ? "saving..." : "save changes"}
						</button>
					</div>
				</form>
			{:else}
				<div class="detail-body">
					<div class="detail-meta-line">
						<span class="status-indicator">
							<span class="status-dot" style="background: {getStatusColor(selectedQuote.status)}"></span>
							{selectedQuote.status}
						</span>
						{#if selectedQuote.category}
							<span class="meta-sep">&middot;</span>
							<span class="detail-category">{selectedQuote.category}</span>
						{/if}
						<span class="meta-sep">&middot;</span>
						<span class="detail-client">{selectedQuote.clientName}</span>
						{#if selectedQuote.validUntil}
							<span class="meta-sep">&middot;</span>
							<span class="detail-due">valid until {formatDate(selectedQuote.validUntil)}</span>
						{/if}
					</div>

					<div class="detail-fields">
						{#each selectedQuote.packages as pkg, i}
							<div class="detail-package">
								<div class="detail-package-header">
									<span class="detail-package-name">{pkg.name}</span>
									<span class="detail-package-price">{formatCents(pkg.price)}</span>
								</div>
								{#if pkg.description}
									<p class="detail-package-desc">{pkg.description}</p>
								{/if}
								{#if pkg.included && pkg.included.length > 0}
									<ul class="detail-included-list">
										{#each pkg.included as item}
											<li>{item}</li>
										{/each}
									</ul>
								{/if}
							</div>
						{/each}

						<div class="totals-line">
							<span class="total-amount">total: {formatCents(detailTotal)}</span>
						</div>

						{#if selectedQuote.notes}
							<div class="detail-field">
								<span class="detail-label">notes</span>
								<span class="detail-value detail-notes">{selectedQuote.notes}</span>
							</div>
						{/if}

						{#if selectedQuote.sentAt}
							<div class="detail-field">
								<span class="detail-label">sent</span>
								<span class="detail-value">{formatTimestamp(selectedQuote.sentAt)}</span>
							</div>
						{/if}

						{#if selectedQuote.acceptedAt}
							<div class="detail-field">
								<span class="detail-label">accepted</span>
								<span class="detail-value">{formatTimestamp(selectedQuote.acceptedAt)}</span>
							</div>
						{/if}

						<div class="detail-field">
							<span class="detail-label">created</span>
							<span class="detail-value">{formatTimestamp(selectedQuote._creationTime)}</span>
						</div>
					</div>

					<div class="modal-actions detail-actions">
						{#if confirmDelete}
							<span class="confirm-text">delete this quote?</span>
							<button class="btn-danger" onclick={deleteQuote} disabled={saving}>
								{saving ? "deleting..." : "yes, delete"}
							</button>
							<button class="btn-cancel" onclick={() => { confirmDelete = false; }}>no</button>
						{:else if selectedQuote.status === "draft"}
							<button class="btn-danger-outline" onclick={() => { confirmDelete = true; }}>delete</button>
							<button class="btn-cancel" onclick={startEdit}>edit</button>
							<button class="btn-save" onclick={() => quoteAction("send")} disabled={saving}>
								{saving ? "..." : "mark as sent"}
							</button>
						{:else if selectedQuote.status === "sent"}
							<button class="btn-danger-outline" onclick={() => quoteAction("decline")} disabled={saving}>decline</button>
							<button class="btn-save" onclick={() => quoteAction("accept")} disabled={saving}>
								{saving ? "..." : "mark accepted"}
							</button>
						{:else if selectedQuote.status === "accepted"}
							<span class="accepted-note">accepted on {formatTimestamp(selectedQuote.acceptedAt)}</span>
							{#if !selectedQuote.convertedToInvoice && !convertSuccess}
								<button class="btn-save" onclick={() => { showConvertForm = !showConvertForm; }} disabled={converting}>
									convert to invoice
								</button>
							{/if}
						{:else if selectedQuote.status === "declined"}
							<span class="declined-note">declined</span>
						{:else if selectedQuote.status === "expired"}
							<span class="expired-note">expired</span>
						{/if}
					</div>

					{#if selectedQuote.status === "accepted"}
						{#if convertSuccess || selectedQuote.convertedToInvoice}
							<div class="convert-status">
								<span class="status-indicator">
									<span class="status-dot" style="background: var(--status-sage)"></span>
									invoice created — <a class="convert-link" href="/admin/invoicing">view invoices</a>
								</span>
							</div>
						{:else if showConvertForm}
							<div class="convert-section">
								<div class="convert-section-header">
									<span class="form-label">convert to invoice</span>
								</div>
								<form class="convert-form" onsubmit={(e) => { e.preventDefault(); convertToInvoice(); }}>
									<div class="form-row">
										<div class="form-group">
											<label class="form-label" for="convert-number">invoice number</label>
											<input id="convert-number" class="form-input" type="text" bind:value={convertInvoiceNumber} required />
										</div>
										<div class="form-group">
											<label class="form-label" for="convert-type">invoice type</label>
											<select id="convert-type" class="form-input" bind:value={convertInvoiceType}>
												<option value="one-time">one-time</option>
												<option value="package">package</option>
												<option value="deposit">deposit</option>
												<option value="milestone">milestone</option>
												<option value="recurring">recurring</option>
											</select>
										</div>
									</div>
									<div class="form-group">
										<label class="form-label" for="convert-due">due date</label>
										<input id="convert-due" class="form-input" type="date" bind:value={convertDueDate} />
									</div>
									<div class="form-group">
										<label class="form-label" for="convert-notes">notes</label>
										<textarea id="convert-notes" class="form-input form-textarea" bind:value={convertNotes} rows="2"></textarea>
									</div>
									<div class="convert-actions">
										<button type="button" class="btn-cancel" onclick={() => { showConvertForm = false; }}>cancel</button>
										<button type="submit" class="btn-save" disabled={converting || !convertInvoiceNumber}>
											{converting ? "creating..." : "create invoice"}
										</button>
									</div>
								</form>
							</div>
						{/if}
					{/if}
				</div>
			{/if}
		</div>
	</div>
{/if}

<!-- Preset Modal (create / view / edit) -->
{#if presetEditMode || selectedPreset}
	<div class="modal-overlay" role="dialog" tabindex="-1" aria-modal="true" aria-label="Preset" onclick={closePresetModal} onkeydown={(e) => { if (e.key === "Escape") closePresetModal(); }}>
		<div class="modal-content modal-wide" role="presentation" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()}>
			<div class="modal-header">
				<h2 class="modal-title">{selectedPreset && !presetEditMode ? selectedPreset.name : selectedPreset ? "edit preset" : "new preset"}</h2>
				<button class="modal-close" aria-label="Close" onclick={closePresetModal}>
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
				</button>
			</div>

			{#if presetEditMode}
				<form class="modal-form" onsubmit={(e) => { e.preventDefault(); selectedPreset ? savePresetEdit() : saveNewPreset(); }}>
					<div class="form-row">
						<div class="form-group">
							<label class="form-label" for="preset-name">name <span class="required">*</span></label>
							<input id="preset-name" class="form-input" type="text" placeholder="e.g. wedding basic" bind:value={presetName} required />
						</div>
						<div class="form-group">
							<label class="form-label" for="preset-category">category</label>
							<select id="preset-category" class="form-input" bind:value={presetCategory}>
								<option value="">none</option>
								<option value="photography">photography</option>
								<option value="web">web</option>
							</select>
						</div>
					</div>

					<div class="packages-section">
						<div class="packages-header">
							<span class="form-label">packages <span class="required">*</span></span>
						</div>

						{#each presetPackages as pkg, i}
							<div class="package-block">
								<div class="package-block-header">
									<span class="package-num">package {i + 1}</span>
									{#if presetPackages.length > 1}
										<button type="button" class="btn-remove-item" onclick={() => removePresetPackage(i)} aria-label="Remove package">
											<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
										</button>
									{/if}
								</div>
								<div class="form-row">
									<div class="form-group">
										<label class="form-label" for="preset-pkg-name-{i}">name <span class="required">*</span></label>
										<input id="preset-pkg-name-{i}" class="form-input" type="text" placeholder="e.g. basic" bind:value={pkg.name} required />
									</div>
									<div class="form-group">
										<label class="form-label" for="preset-pkg-price-{i}">price (cents) <span class="required">*</span></label>
										<input id="preset-pkg-price-{i}" class="form-input" type="number" min="0" step="1" bind:value={pkg.price} required />
									</div>
								</div>
								<div class="form-group">
									<label class="form-label" for="preset-pkg-desc-{i}">description</label>
									<input id="preset-pkg-desc-{i}" class="form-input" type="text" placeholder="package description..." bind:value={pkg.description} />
								</div>
								<div class="form-group">
									<span class="form-label">included items</span>
									{#if pkg.included.length > 0}
										<div class="included-list">
											{#each pkg.included as item, j}
												<div class="included-item">
													<span>{item}</span>
													<button type="button" class="btn-remove-included" onclick={() => removePresetIncludedItem(i, j)} aria-label="Remove item">
														<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
													</button>
												</div>
											{/each}
										</div>
									{/if}
									<div class="included-add-row">
										<input class="form-input included-input" type="text" placeholder="add included item..." bind:value={presetNewIncludedItem[i]} onkeydown={(e) => { if (e.key === "Enter") { e.preventDefault(); addPresetIncludedItem(i); } }} />
										<button type="button" class="btn-add-included" onclick={() => addPresetIncludedItem(i)}>+</button>
									</div>
								</div>
							</div>
						{/each}
						<button type="button" class="btn-add-item" onclick={addPresetPackage}>+ add package</button>
					</div>

					<div class="totals-line">
						<span class="total-amount">total: {formatCents(presetTotal)}</span>
					</div>

					<div class="modal-actions">
						<button type="button" class="btn-cancel" onclick={() => { if (selectedPreset) presetEditMode = false; else closePresetModal(); }}>cancel</button>
						<button type="submit" class="btn-save" disabled={saving || !presetName || presetPackages.length === 0}>
							{saving ? "saving..." : selectedPreset ? "save changes" : "create preset"}
						</button>
					</div>
				</form>
			{:else if selectedPreset}
				<div class="detail-body">
					<div class="detail-meta-line">
						{#if selectedPreset.category}
							<span class="detail-category">{selectedPreset.category}</span>
							<span class="meta-sep">&middot;</span>
						{/if}
						<span>{selectedPreset.packages.length} package{selectedPreset.packages.length !== 1 ? "s" : ""}</span>
					</div>

					<div class="detail-fields">
						{#each selectedPreset.packages as pkg}
							<div class="detail-package">
								<div class="detail-package-header">
									<span class="detail-package-name">{pkg.name}</span>
									<span class="detail-package-price">{formatCents(pkg.price)}</span>
								</div>
								{#if pkg.description}
									<p class="detail-package-desc">{pkg.description}</p>
								{/if}
								{#if pkg.included && pkg.included.length > 0}
									<ul class="detail-included-list">
										{#each pkg.included as item}
											<li>{item}</li>
										{/each}
									</ul>
								{/if}
							</div>
						{/each}

						<div class="totals-line">
							<span class="total-amount">total: {formatCents(calcPackagesTotal(selectedPreset.packages))}</span>
						</div>
					</div>

					<div class="modal-actions detail-actions">
						{#if confirmDeletePreset}
							<span class="confirm-text">delete this preset?</span>
							<button class="btn-danger" onclick={deletePreset} disabled={saving}>
								{saving ? "deleting..." : "yes, delete"}
							</button>
							<button class="btn-cancel" onclick={() => { confirmDeletePreset = false; }}>no</button>
						{:else}
							<button class="btn-danger-outline" onclick={() => { confirmDeletePreset = true; }}>delete</button>
							<button class="btn-cancel" onclick={startPresetEdit}>edit</button>
						{/if}
					</div>
				</div>
			{/if}
		</div>
	</div>
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

	.q-table {
		width: 100%;
		border-collapse: collapse;
		text-align: left;
		font-size: 0.85rem;
	}

	.q-table th {
		padding: 0 16px 12px 0;
		color: var(--admin-text-subtle);
		font-weight: 400;
		font-size: 0.75rem;
		letter-spacing: 0.04em;
		border-bottom: 1px solid var(--admin-border);
		white-space: nowrap;
	}

	.q-table td {
		padding: 14px 16px 14px 0;
		border-bottom: 1px solid var(--admin-border);
		white-space: nowrap;
	}

	.q-row {
		cursor: pointer;
		transition: background 0.12s;
	}

	.q-row:hover {
		background: var(--admin-active);
	}

	.td-number {
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

	.td-packages,
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

	/* Presets list */
	.presets-list {
		display: flex;
		flex-direction: column;
		gap: 1px;
	}

	.preset-item {
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

	.preset-item:hover {
		background: var(--admin-active);
	}

	.preset-name {
		font-size: 0.88rem;
		color: var(--admin-heading);
		font-weight: 500;
	}

	.preset-meta {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 0.8rem;
		color: var(--admin-text-muted);
	}

	.preset-category {
		color: var(--admin-text-subtle);
	}

	/* Preset load row in create modal */
	.preset-load-row {
		margin-bottom: 4px;
	}

	/* Packages actions row */
	.packages-actions-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
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

	/* Packages section */
	.packages-section {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.packages-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.package-block {
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 16px;
		border: 1px solid var(--admin-border);
		border-radius: 8px;
	}

	.package-block-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.package-num {
		font-size: 0.76rem;
		color: var(--admin-text-subtle);
		letter-spacing: 0.02em;
	}

	/* Included items */
	.included-list {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.included-item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		padding: 4px 8px;
		background: rgba(255, 255, 255, 0.02);
		border-radius: 4px;
		font-size: 0.82rem;
		color: var(--admin-text);
	}

	.btn-remove-included {
		background: none;
		border: none;
		color: var(--admin-text-subtle);
		cursor: pointer;
		padding: 2px;
		border-radius: 3px;
		transition: color 0.15s;
		flex-shrink: 0;
	}

	.btn-remove-included:hover {
		color: var(--status-rose);
	}

	.included-add-row {
		display: flex;
		gap: 6px;
		align-items: center;
	}

	.included-input {
		flex: 1;
		min-width: 0;
	}

	.btn-add-included {
		padding: 6px 10px;
		background: transparent;
		color: var(--admin-text-muted);
		border: 1px solid var(--admin-border-strong);
		border-radius: 6px;
		font-size: 0.85rem;
		cursor: pointer;
		transition: color 0.15s, border-color 0.15s;
		flex-shrink: 0;
	}

	.btn-add-included:hover {
		color: var(--admin-heading);
		border-color: var(--admin-text-muted);
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

	.btn-add-item:disabled {
		opacity: 0.4;
		cursor: not-allowed;
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

	.btn-danger-outline:disabled {
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

	.detail-package {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding-bottom: 12px;
		border-bottom: 1px solid var(--admin-border);
	}

	.detail-package:last-of-type {
		border-bottom: none;
		padding-bottom: 0;
	}

	.detail-package-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.detail-package-name {
		font-weight: 500;
		color: var(--admin-heading);
		font-size: 0.9rem;
	}

	.detail-package-price {
		font-weight: 500;
		color: var(--admin-heading);
		font-variant-numeric: tabular-nums;
		font-size: 0.9rem;
	}

	.detail-package-desc {
		font-size: 0.82rem;
		color: var(--admin-text-muted);
		margin: 0;
		line-height: 1.4;
	}

	.detail-included-list {
		list-style: none;
		padding: 0;
		margin: 4px 0 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.detail-included-list li {
		font-size: 0.8rem;
		color: var(--admin-text);
		padding-left: 14px;
		position: relative;
	}

	.detail-included-list li::before {
		content: "\2022";
		position: absolute;
		left: 0;
		color: var(--admin-text-subtle);
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

	.accepted-note {
		font-size: 0.82rem;
		color: var(--status-sage);
		margin-left: auto;
	}

	.declined-note {
		font-size: 0.82rem;
		color: var(--status-rose);
		margin-left: auto;
	}

	.expired-note {
		font-size: 0.82rem;
		color: var(--admin-text-subtle);
		margin-left: auto;
	}

	/* Convert to invoice */
	.convert-section {
		border-top: 1px solid var(--admin-border);
		padding-top: 16px;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.convert-section-header {
		margin-bottom: 2px;
	}

	.convert-form {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.convert-actions {
		display: flex;
		justify-content: flex-end;
		gap: 10px;
		padding-top: 4px;
	}

	.convert-status {
		border-top: 1px solid var(--admin-border);
		padding-top: 16px;
	}

	.convert-link {
		color: var(--admin-accent);
		text-decoration: none;
		font-size: 0.8rem;
	}

	.convert-link:hover {
		text-decoration: underline;
	}

	/* Responsive */
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

		.preset-item {
			flex-direction: column;
			align-items: flex-start;
			gap: 6px;
		}
	}
</style>
