<script lang="ts">
import { invalidateAll } from "$app/navigation";
import SEO from "$lib/components/SEO.svelte";
import { formatCents, formatDate, formatTimestamp } from "$lib/utils/format";

let { data }: { data: any } = $props();

// Local copy of the document so we can reflect optimistic state changes after
// accept/decline/sign without mutating the load-function prop (a Svelte 5
// anti-pattern — the prop is not reactively owned by this component and the
// mutation breaks on refresh/invalidation).
//
// We track `data.document` reactively in a $derived; the local $state only
// holds optimistic overrides. `document` reads from the override when present
// and falls back to the fresh prop value.
let optimisticDocument = $state<any>(null);
const document = $derived(optimisticDocument ?? data.document);

// Clear the override whenever the load function produces a new document
// (e.g. after `invalidateAll()` runs). Without this, a stale optimistic copy
// would keep overriding authoritative server state.
$effect(() => {
	// Read data.document to register the dependency, then reset override.
	data.document;
	optimisticDocument = null;
});

let actionLoading = $state(false);
let actionResult = $state<"success" | "error" | null>(null);
let actionMessage = $state("");

// Contract signing
let signerName = $state("");

function getQuoteTotal(packages: { price: number }[]): number {
	return packages.reduce((sum, pkg) => sum + pkg.price, 0);
}

function getInvoiceSubtotal(
	items: { quantity: number; unitPrice: number }[],
): number {
	return items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
}

function getInvoiceTotal(
	items: { quantity: number; unitPrice: number }[],
	taxPercent?: number,
): number {
	const subtotal = getInvoiceSubtotal(items);
	if (taxPercent) {
		return subtotal + subtotal * (taxPercent / 100);
	}
	return subtotal;
}

async function acceptQuote() {
	actionLoading = true;
	actionResult = null;
	try {
		const res = await fetch(`/api/portal/${data.token}/accept`, {
			method: "POST",
		});
		if (res.ok) {
			actionResult = "success";
			actionMessage = "quote accepted! we'll be in touch.";
			optimisticDocument = { ...data.document, status: "accepted" };
			// Refresh load data so navigation reflects the new state; the
			// $effect will clear the optimistic override once fresh data arrives.
			await invalidateAll();
		} else {
			actionResult = "error";
			actionMessage = "something went wrong. please try again.";
		}
	} catch {
		actionResult = "error";
		actionMessage = "something went wrong. please try again.";
	} finally {
		actionLoading = false;
	}
}

async function declineQuote() {
	actionLoading = true;
	actionResult = null;
	try {
		const res = await fetch(`/api/portal/${data.token}/decline`, {
			method: "POST",
		});
		if (res.ok) {
			actionResult = "success";
			actionMessage = "quote declined.";
			optimisticDocument = { ...data.document, status: "declined" };
			await invalidateAll();
		} else {
			actionResult = "error";
			actionMessage = "something went wrong. please try again.";
		}
	} catch {
		actionResult = "error";
		actionMessage = "something went wrong. please try again.";
	} finally {
		actionLoading = false;
	}
}

async function signContract() {
	if (!signerName.trim()) return;
	actionLoading = true;
	actionResult = null;
	try {
		const res = await fetch(`/api/portal/${data.token}/sign`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ signerName: signerName.trim() }),
		});
		if (res.ok) {
			actionResult = "success";
			actionMessage = "contract signed successfully!";
			optimisticDocument = {
				...data.document,
				status: "signed",
				signedAt: Date.now(),
			};
			await invalidateAll();
		} else {
			actionResult = "error";
			actionMessage = "something went wrong. please try again.";
		}
	} catch {
		actionResult = "error";
		actionMessage = "something went wrong. please try again.";
	} finally {
		actionLoading = false;
	}
}
</script>

<SEO title="{data.type === 'invoice' ? 'Invoice' : data.type === 'quote' ? 'Quote' : 'Contract'} from {data.businessName}" description="View your {data.type}" />

<div class="portal">
	<header class="portal-header">
		<span class="business-name">{data.businessName}</span>
	</header>

	<div aria-live="polite">
		{#if actionResult}
			<div class="action-banner" class:success={actionResult === "success"} class:error-banner={actionResult === "error"}>
				{actionMessage}
			</div>
		{/if}
	</div>

	<main class="portal-card">
		{#if data.type === "quote"}
			{@const doc = document}
			<div class="doc-header">
				<div class="doc-type">Quote</div>
				<h1 class="doc-number">{doc.quoteNumber}</h1>
				<div class="doc-meta">
					{#if data.client}
						<div class="meta-row">
							<span class="meta-label">Prepared for</span>
							<span class="meta-value">{data.client.name}</span>
						</div>
					{/if}
					<div class="meta-row">
						<span class="meta-label">Date</span>
						<span class="meta-value">{formatTimestamp(doc._creationTime)}</span>
					</div>
					{#if doc.validUntil}
						<div class="meta-row">
							<span class="meta-label">Valid until</span>
							<span class="meta-value">{formatDate(doc.validUntil)}</span>
						</div>
					{/if}
					<div class="meta-row">
						<span class="meta-label">Status</span>
						<span class="meta-value status-badge status-{doc.status}">{doc.status}</span>
					</div>
				</div>
			</div>

			<div class="doc-body">
				{#each doc.packages as pkg, i}
					<div class="package-card">
						<div class="package-header">
							<h3 class="package-name">{pkg.name}</h3>
							<span class="package-price">{formatCents(pkg.price)}</span>
						</div>
						{#if pkg.description}
							<p class="package-desc">{pkg.description}</p>
						{/if}
						{#if pkg.included?.length}
							<ul class="package-included">
								{#each pkg.included as item}
									<li>{item}</li>
								{/each}
							</ul>
						{/if}
					</div>
				{/each}

				<div class="total-row">
					<span class="total-label">Total</span>
					<span class="total-amount">{formatCents(getQuoteTotal(doc.packages))}</span>
				</div>

				{#if doc.notes}
					<div class="notes-section">
						<h4 class="notes-heading">Notes</h4>
						<p class="notes-text">{doc.notes}</p>
					</div>
				{/if}
			</div>

			{#if doc.status === "sent" && !data.used}
				<div class="doc-actions">
					<button class="btn-secondary" onclick={declineQuote} disabled={actionLoading}>
						{actionLoading ? "..." : "Decline Quote"}
					</button>
					<button class="btn-primary" onclick={acceptQuote} disabled={actionLoading}>
						{actionLoading ? "..." : "Accept Quote"}
					</button>
				</div>
			{:else if doc.status === "accepted"}
				<div class="status-message success-message">
					This quote has been accepted.
				</div>
			{:else if doc.status === "declined"}
				<div class="status-message">
					This quote has been declined.
				</div>
			{/if}

		{:else if data.type === "invoice"}
			{@const doc = document}
			<div class="doc-header">
				<div class="doc-type">Invoice</div>
				<h1 class="doc-number">{doc.invoiceNumber}</h1>
				<div class="doc-meta">
					{#if data.client}
						<div class="meta-row">
							<span class="meta-label">Bill to</span>
							<span class="meta-value">{data.client.name}</span>
						</div>
					{/if}
					<div class="meta-row">
						<span class="meta-label">Date</span>
						<span class="meta-value">{formatTimestamp(doc._creationTime)}</span>
					</div>
					{#if doc.dueDate}
						<div class="meta-row">
							<span class="meta-label">Due date</span>
							<span class="meta-value">{formatDate(doc.dueDate)}</span>
						</div>
					{/if}
					<div class="meta-row">
						<span class="meta-label">Status</span>
						<span class="meta-value status-badge status-{doc.status}">{doc.status}</span>
					</div>
				</div>
			</div>

			<div class="doc-body">
				<table class="line-items">
					<thead>
						<tr>
							<th scope="col" class="th-desc">Description</th>
							<th scope="col" class="th-qty">Qty</th>
							<th scope="col" class="th-price">Unit Price</th>
							<th scope="col" class="th-total">Total</th>
						</tr>
					</thead>
					<tbody>
						{#each doc.items as item}
							<tr>
								<td>{item.description}</td>
								<td class="td-center">{item.quantity}</td>
								<td class="td-right">{formatCents(item.unitPrice)}</td>
								<td class="td-right">{formatCents(item.quantity * item.unitPrice)}</td>
							</tr>
						{/each}
					</tbody>
				</table>

				<div class="invoice-totals">
					<div class="subtotal-row">
						<span>Subtotal</span>
						<span>{formatCents(getInvoiceSubtotal(doc.items))}</span>
					</div>
					{#if doc.taxPercent}
						<div class="subtotal-row">
							<span>Tax ({doc.taxPercent}%)</span>
							<span>{formatCents(getInvoiceSubtotal(doc.items) * (doc.taxPercent / 100))}</span>
						</div>
					{/if}
					<div class="total-row">
						<span class="total-label">Total</span>
						<span class="total-amount">{formatCents(getInvoiceTotal(doc.items, doc.taxPercent))}</span>
					</div>
				</div>

				{#if doc.notes}
					<div class="notes-section">
						<h4 class="notes-heading">Notes</h4>
						<p class="notes-text">{doc.notes}</p>
					</div>
				{/if}
			</div>

			{#if doc.status === "paid"}
				<div class="status-message success-message">
					This invoice has been paid. Thank you!
				</div>
			{:else if doc.status === "sent" || doc.status === "overdue"}
				<div class="doc-actions">
					<button class="btn-primary" disabled>
						Pay Now (coming soon)
					</button>
				</div>
			{/if}

		{:else if data.type === "contract"}
			{@const doc = document}
			<div class="doc-header">
				<div class="doc-type">Contract</div>
				<h1 class="doc-number">{doc.title}</h1>
				<div class="doc-meta">
					{#if data.client}
						<div class="meta-row">
							<span class="meta-label">Prepared for</span>
							<span class="meta-value">{data.client.name}</span>
						</div>
					{/if}
					<div class="meta-row">
						<span class="meta-label">Date</span>
						<span class="meta-value">{formatTimestamp(doc._creationTime)}</span>
					</div>
					{#if doc.eventDate}
						<div class="meta-row">
							<span class="meta-label">Event date</span>
							<span class="meta-value">{formatDate(doc.eventDate)}</span>
						</div>
					{/if}
					{#if doc.eventLocation}
						<div class="meta-row">
							<span class="meta-label">Location</span>
							<span class="meta-value">{doc.eventLocation}</span>
						</div>
					{/if}
					<div class="meta-row">
						<span class="meta-label">Status</span>
						<span class="meta-value status-badge status-{doc.status}">{doc.status}</span>
					</div>
				</div>
			</div>

			<div class="doc-body">
				<div class="contract-body">{doc.body}</div>

				{#if doc.totalPrice || doc.depositAmount}
					<div class="pricing-section">
						{#if doc.totalPrice}
							<div class="pricing-row">
								<span>Total Price</span>
								<span>{formatCents(doc.totalPrice)}</span>
							</div>
						{/if}
						{#if doc.depositAmount}
							<div class="pricing-row">
								<span>Deposit Required</span>
								<span>{formatCents(doc.depositAmount)}</span>
							</div>
						{/if}
					</div>
				{/if}
			</div>

			{#if doc.status === "sent" && !data.used}
				<div class="signature-section">
					<h3 class="sig-heading">Sign this contract</h3>
					<div class="sig-field">
						<label for="signer-name">Your full name</label>
						<input
							id="signer-name"
							type="text"
							bind:value={signerName}
							placeholder="Enter your full name"
						/>
					</div>
					<button class="btn-primary" onclick={signContract} disabled={actionLoading || !signerName.trim()}>
						{actionLoading ? "Signing..." : "Sign Contract"}
					</button>
				</div>
			{:else if doc.status === "signed"}
				<div class="status-message success-message">
					This contract was signed on {formatTimestamp(doc.signedAt)}.
				</div>
			{/if}
		{/if}
	</main>

	<footer class="portal-footer">
		<span>Powered by Angels Rest</span>
	</footer>
</div>

<style>
	@font-face {
		font-family: "Chillax";
		src: url("/fonts/Chillax-Variable.woff2") format("woff2");
		font-weight: 200 700;
		font-display: swap;
	}
	@font-face {
		font-family: "Synonym";
		src: url("/fonts/Synonym-Variable.woff2") format("woff2");
		font-weight: 300 700;
		font-display: swap;
	}

	.portal {
		min-height: 100vh;
		background: #fafafa;
		font-family: "Synonym", system-ui, sans-serif;
		color: #1a1a1a;
		padding: 0;
	}

	.portal-header {
		padding: 24px 32px;
		border-bottom: 1px solid #e5e5e5;
		background: #fff;
	}

	.business-name {
		font-family: "Chillax", system-ui, sans-serif;
		font-weight: 500;
		font-size: 1.125rem;
		color: #1a1a1a;
	}

	.action-banner {
		padding: 14px 32px;
		text-align: center;
		font-size: 0.925rem;
		font-weight: 500;
	}

	.action-banner.success {
		background: #ecfdf5;
		color: #065f46;
		border-bottom: 1px solid #a7f3d0;
	}

	.action-banner.error-banner {
		background: #fef2f2;
		color: #991b1b;
		border-bottom: 1px solid #fecaca;
	}

	.portal-card {
		max-width: 720px;
		margin: 40px auto;
		background: #fff;
		border-radius: 12px;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06), 0 1px 2px rgba(0, 0, 0, 0.04);
		overflow: hidden;
	}

	.doc-header {
		padding: 32px 36px;
		border-bottom: 1px solid #f0f0f0;
	}

	.doc-type {
		font-size: 0.8rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: #4f46e5;
		margin-bottom: 4px;
	}

	.doc-number {
		font-family: "Chillax", system-ui, sans-serif;
		font-size: 1.5rem;
		font-weight: 600;
		margin: 0 0 20px;
		color: #1a1a1a;
	}

	.doc-meta {
		display: grid;
		gap: 10px;
	}

	.meta-row {
		display: flex;
		gap: 12px;
		align-items: baseline;
	}

	.meta-label {
		font-size: 0.825rem;
		color: #6b7280;
		min-width: 100px;
	}

	.meta-value {
		font-size: 0.925rem;
		color: #1a1a1a;
		font-weight: 450;
	}

	.status-badge {
		display: inline-block;
		padding: 2px 10px;
		border-radius: 99px;
		font-size: 0.8rem;
		font-weight: 500;
	}

	.status-draft {
		background: #f3f4f6;
		color: #6b7280;
	}

	.status-sent {
		background: #fef3c7;
		color: #92400e;
	}

	.status-accepted,
	.status-signed,
	.status-paid {
		background: #d1fae5;
		color: #065f46;
	}

	.status-declined,
	.status-expired,
	.status-overdue,
	.status-canceled {
		background: #fee2e2;
		color: #991b1b;
	}

	.doc-body {
		padding: 28px 36px;
	}

	/* Quote packages */
	.package-card {
		border: 1px solid #e5e7eb;
		border-radius: 8px;
		padding: 20px;
		margin-bottom: 16px;
	}

	.package-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 8px;
	}

	.package-name {
		font-family: "Chillax", system-ui, sans-serif;
		font-size: 1.05rem;
		font-weight: 500;
		margin: 0;
		color: #1a1a1a;
	}

	.package-price {
		font-size: 1.1rem;
		font-weight: 600;
		color: #4f46e5;
	}

	.package-desc {
		font-size: 0.9rem;
		color: #6b7280;
		margin: 0 0 12px;
		line-height: 1.5;
	}

	.package-included {
		list-style: none;
		padding: 0;
		margin: 0;
	}

	.package-included li {
		font-size: 0.875rem;
		color: #374151;
		padding: 4px 0 4px 20px;
		position: relative;
	}

	.package-included li::before {
		content: "\2713";
		position: absolute;
		left: 0;
		color: #10b981;
		font-weight: 600;
	}

	/* Invoice line items */
	.line-items {
		width: 100%;
		border-collapse: collapse;
		margin-bottom: 20px;
	}

	.line-items th {
		text-align: left;
		font-size: 0.8rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: #6b7280;
		padding: 8px 12px;
		border-bottom: 2px solid #e5e7eb;
	}

	.th-qty,
	.th-price,
	.th-total {
		text-align: right;
	}

	.line-items td {
		padding: 12px;
		font-size: 0.925rem;
		border-bottom: 1px solid #f3f4f6;
	}

	.td-center {
		text-align: center;
	}

	.td-right {
		text-align: right;
	}

	.invoice-totals {
		border-top: 1px solid #e5e7eb;
		padding-top: 16px;
	}

	.subtotal-row {
		display: flex;
		justify-content: space-between;
		padding: 6px 12px;
		font-size: 0.9rem;
		color: #6b7280;
	}

	.total-row {
		display: flex;
		justify-content: space-between;
		padding: 12px;
		margin-top: 8px;
		border-top: 1px solid #e5e7eb;
	}

	.total-label {
		font-family: "Chillax", system-ui, sans-serif;
		font-weight: 600;
		font-size: 1.05rem;
	}

	.total-amount {
		font-weight: 700;
		font-size: 1.15rem;
		color: #1a1a1a;
	}

	/* Contract body */
	.contract-body {
		font-size: 0.925rem;
		line-height: 1.7;
		color: #374151;
		white-space: pre-wrap;
	}

	.pricing-section {
		margin-top: 24px;
		padding-top: 16px;
		border-top: 1px solid #e5e7eb;
	}

	.pricing-row {
		display: flex;
		justify-content: space-between;
		padding: 8px 0;
		font-size: 0.95rem;
	}

	.pricing-row span:last-child {
		font-weight: 600;
	}

	/* Notes */
	.notes-section {
		margin-top: 24px;
		padding-top: 16px;
		border-top: 1px solid #f0f0f0;
	}

	.notes-heading {
		font-family: "Chillax", system-ui, sans-serif;
		font-size: 0.9rem;
		font-weight: 500;
		color: #6b7280;
		margin: 0 0 8px;
	}

	.notes-text {
		font-size: 0.9rem;
		color: #6b7280;
		line-height: 1.5;
		margin: 0;
	}

	/* Actions */
	.doc-actions {
		padding: 24px 36px;
		border-top: 1px solid #f0f0f0;
		display: flex;
		gap: 12px;
		justify-content: flex-end;
	}

	.btn-primary {
		background: #4f46e5;
		color: #fff;
		border: none;
		border-radius: 8px;
		padding: 10px 24px;
		font-size: 0.925rem;
		font-weight: 500;
		cursor: pointer;
		font-family: "Synonym", system-ui, sans-serif;
		transition: background 0.15s;
	}

	.btn-primary:hover:not(:disabled) {
		background: #4338ca;
	}

	.btn-primary:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.btn-secondary {
		background: #fff;
		color: #374151;
		border: 1px solid #d1d5db;
		border-radius: 8px;
		padding: 10px 24px;
		font-size: 0.925rem;
		font-weight: 500;
		cursor: pointer;
		font-family: "Synonym", system-ui, sans-serif;
		transition: border-color 0.15s;
	}

	.btn-secondary:hover:not(:disabled) {
		border-color: #9ca3af;
	}

	.btn-secondary:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	/* Signature */
	.signature-section {
		padding: 28px 36px;
		border-top: 1px solid #f0f0f0;
		background: #fafafa;
	}

	.sig-heading {
		font-family: "Chillax", system-ui, sans-serif;
		font-size: 1rem;
		font-weight: 500;
		margin: 0 0 16px;
		color: #1a1a1a;
	}

	.sig-field {
		margin-bottom: 16px;
	}

	.sig-field label {
		display: block;
		font-size: 0.825rem;
		color: #6b7280;
		margin-bottom: 6px;
	}

	.sig-field input {
		width: 100%;
		padding: 10px 14px;
		border: 1px solid #d1d5db;
		border-radius: 8px;
		font-size: 0.925rem;
		font-family: "Synonym", system-ui, sans-serif;
		background: #fff;
		box-sizing: border-box;
	}

	.sig-field input:focus {
		outline: none;
		border-color: #4f46e5;
		box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.1);
	}

	/* Status messages */
	.status-message {
		padding: 20px 36px;
		border-top: 1px solid #f0f0f0;
		text-align: center;
		font-size: 0.925rem;
		color: #6b7280;
	}

	.success-message {
		color: #065f46;
		background: #ecfdf5;
	}

	/* Footer */
	.portal-footer {
		text-align: center;
		padding: 32px;
		font-size: 0.8rem;
		color: #9ca3af;
	}

	/* Responsive */
	@media (max-width: 640px) {
		.portal-card {
			margin: 16px;
			border-radius: 10px;
		}

		.doc-header,
		.doc-body,
		.doc-actions,
		.signature-section {
			padding-left: 20px;
			padding-right: 20px;
		}

		.doc-number {
			font-size: 1.25rem;
		}

		.meta-row {
			flex-direction: column;
			gap: 2px;
		}

		.meta-label {
			min-width: 0;
		}

		.doc-actions {
			flex-direction: column;
		}

		.line-items th,
		.line-items td {
			padding: 8px 6px;
			font-size: 0.85rem;
		}
	}
</style>
