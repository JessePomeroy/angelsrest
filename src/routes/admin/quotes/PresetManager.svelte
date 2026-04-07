<script lang="ts">
import AdminModal from "$lib/admin/components/AdminModal.svelte";
import type { QuotePackage, QuotePreset } from "$lib/admin/types";
import { formatCents } from "$lib/admin/utils";
import PackageEditor from "./PackageEditor.svelte";

interface EditablePackage {
	name: string;
	description: string;
	price: number;
	included: string[];
}

interface Props {
	presets: QuotePreset[];
	showPresetModal: boolean;
	selectedPreset: QuotePreset | null;
	saving: boolean;
	onopen: (preset?: QuotePreset) => void;
	onclose: () => void;
	onsavenew: (data: {
		name: string;
		category: "photography" | "web" | "";
		packages: EditablePackage[];
	}) => Promise<void>;
	onsaveedit: (data: {
		presetId: string;
		name: string;
		category: "photography" | "web" | "";
		packages: EditablePackage[];
	}) => Promise<void>;
	ondelete: (presetId: string) => Promise<void>;
}

let {
	presets,
	showPresetModal,
	selectedPreset,
	saving,
	onopen,
	onclose,
	onsavenew,
	onsaveedit,
	ondelete,
}: Props = $props();

let presetEditMode = $state(false);
let presetName = $state("");
let presetCategory = $state<"photography" | "web" | "">("photography");
let presetPackages = $state<EditablePackage[]>([]);
let presetNewIncludedItem = $state<Record<number, string>>({});
let confirmDeletePreset = $state(false);

let presetTotal = $derived(
	presetPackages.reduce((sum, pkg) => sum + pkg.price, 0),
);

$effect(() => {
	if (showPresetModal && selectedPreset) {
		presetName = selectedPreset.name;
		presetCategory =
			(selectedPreset.category as "photography" | "web" | "") || "";
		presetPackages = selectedPreset.packages.map((pkg: QuotePackage) => ({
			name: pkg.name || "",
			description: pkg.description || "",
			price: pkg.price,
			included: [...(pkg.included || [])],
		}));
		presetEditMode = false;
		presetNewIncludedItem = {};
		confirmDeletePreset = false;
	} else if (showPresetModal && !selectedPreset) {
		presetName = "";
		presetCategory = "photography";
		presetPackages = [{ name: "", description: "", price: 0, included: [] }];
		presetEditMode = true;
		presetNewIncludedItem = {};
		confirmDeletePreset = false;
	}
});

function startPresetEdit() {
	if (!selectedPreset) return;
	presetName = selectedPreset.name;
	presetCategory =
		(selectedPreset.category as "photography" | "web" | "") || "";
	presetPackages = selectedPreset.packages.map((pkg: QuotePackage) => ({
		name: pkg.name || "",
		description: pkg.description || "",
		price: pkg.price,
		included: [...(pkg.included || [])],
	}));
	presetNewIncludedItem = {};
	presetEditMode = true;
}

function handleClose() {
	presetEditMode = false;
	confirmDeletePreset = false;
	onclose();
}

async function handleSave() {
	if (!presetName || presetPackages.length === 0) return;
	const packages = presetPackages.map((pkg) => ({
		name: pkg.name,
		description: pkg.description || "",
		price: pkg.price,
		included: pkg.included,
	}));
	if (selectedPreset) {
		await onsaveedit({
			presetId: selectedPreset._id as string,
			name: presetName,
			category: presetCategory,
			packages,
		});
		presetEditMode = false;
	} else {
		await onsavenew({
			name: presetName,
			category: presetCategory,
			packages,
		});
	}
}

async function handleDelete() {
	if (!selectedPreset) return;
	await ondelete(selectedPreset._id as string);
}
</script>

{#if presets.length === 0}
	<div class="empty-state">no presets yet</div>
{:else}
	<div class="presets-list">
		{#each presets as preset (preset._id)}
			<button
				class="preset-item"
				onclick={() => onopen(preset)}
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

{#if showPresetModal}
	<AdminModal
		title={selectedPreset && !presetEditMode ? selectedPreset.name : selectedPreset ? "edit preset" : "new preset"}
		onclose={handleClose}
		size="wide"
	>
		{#if presetEditMode}
			<form class="modal-form" onsubmit={(e) => { e.preventDefault(); handleSave(); }}>
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

				<PackageEditor
					packages={presetPackages}
					newIncludedItem={presetNewIncludedItem}
					priceLabel="price (cents)"
					onpackageschange={(pkgs) => { presetPackages = pkgs; }}
					onnewincludeditemchange={(items) => { presetNewIncludedItem = items; }}
				/>

				<div class="totals-line">
					<span class="total-amount">total: {formatCents(presetTotal)}</span>
				</div>

				<div class="modal-actions">
					<button type="button" class="btn-cancel" onclick={() => { if (selectedPreset) presetEditMode = false; else handleClose(); }}>cancel</button>
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
						<span class="total-amount">total: {formatCents(selectedPreset.packages.reduce((sum: number, pkg: QuotePackage) => sum + pkg.price, 0))}</span>
					</div>
				</div>

				<div class="modal-actions detail-actions">
					{#if confirmDeletePreset}
						<span class="confirm-text">delete this preset?</span>
						<button class="btn-danger" onclick={handleDelete} disabled={saving}>
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
	</AdminModal>
{/if}

<style>
	.empty-state {
		padding: 48px 0;
		color: var(--admin-text-subtle);
		font-size: 0.88rem;
	}

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

	.meta-sep {
		color: var(--admin-text-subtle);
	}

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

	.totals-line {
		display: flex;
		align-items: baseline;
		gap: 8px;
		font-size: 0.82rem;
		color: var(--admin-text-muted);
		padding-top: 4px;
	}

	.total-amount {
		font-weight: 500;
		color: var(--admin-heading);
	}

	.modal-actions {
		display: flex;
		justify-content: flex-end;
		gap: 10px;
		padding-top: 6px;
	}

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

	.detail-category {
		color: var(--admin-text-muted);
		font-size: 0.82rem;
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

	@media (max-width: 768px) {
		.form-row {
			grid-template-columns: 1fr;
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
