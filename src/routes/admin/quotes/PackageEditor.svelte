<script lang="ts">
interface EditablePackage {
	name: string;
	description: string;
	price: number;
	included: string[];
}

interface Props {
	packages: EditablePackage[];
	newIncludedItem: Record<number, string>;
	priceLabel?: string;
	onpackageschange: (packages: EditablePackage[]) => void;
	onnewincludeditemchange: (items: Record<number, string>) => void;
}

let {
	packages,
	newIncludedItem,
	priceLabel = "price ($)",
	onpackageschange,
	onnewincludeditemchange,
}: Props = $props();

function addPackage() {
	onpackageschange([
		...packages,
		{ name: "", description: "", price: 0, included: [] },
	]);
}

function removePackage(index: number) {
	onpackageschange(packages.filter((_, i) => i !== index));
}

function addIncludedItem(pkgIndex: number) {
	const text = (newIncludedItem[pkgIndex] || "").trim();
	if (!text) return;
	const updated = [...packages];
	updated[pkgIndex] = {
		...updated[pkgIndex],
		included: [...updated[pkgIndex].included, text],
	};
	onpackageschange(updated);
	onnewincludeditemchange({ ...newIncludedItem, [pkgIndex]: "" });
}

function removeIncludedItem(pkgIndex: number, itemIndex: number) {
	const updated = [...packages];
	updated[pkgIndex] = {
		...updated[pkgIndex],
		included: updated[pkgIndex].included.filter((_, i) => i !== itemIndex),
	};
	onpackageschange(updated);
}
</script>

<div class="packages-section">
	<div class="packages-header">
		<span class="form-label">packages <span class="required">*</span></span>
	</div>

	{#each packages as pkg, i}
		<div class="package-block">
			<div class="package-block-header">
				<span class="package-num">package {i + 1}</span>
				{#if packages.length > 1}
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
					<label class="form-label" for="pkg-price-{i}">{priceLabel} <span class="required">*</span></label>
					<input id="pkg-price-{i}" class="form-input" type="number" min="0" step={priceLabel.includes("cents") ? "1" : "0.01"} bind:value={pkg.price} required />
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
	<button type="button" class="btn-add-item" onclick={addPackage}>+ add package</button>
</div>

<style>
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

	@media (max-width: 768px) {
		.form-row {
			grid-template-columns: 1fr;
		}
	}
</style>
