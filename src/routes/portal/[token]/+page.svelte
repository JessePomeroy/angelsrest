<script lang="ts">
import { invalidateAll } from "$app/navigation";
import SEO from "$lib/components/SEO.svelte";
import type { PageData } from "./$types";
import ContractDocument from "./ContractDocument.svelte";
import InvoiceDocument from "./InvoiceDocument.svelte";
import QuoteDocument from "./QuoteDocument.svelte";

let { data }: { data: PageData } = $props();

// Keep only the transient fields changed by portal actions. The authoritative,
// discriminated document remains the load-function prop and is never mutated.
let optimisticQuoteStatus = $state<"accepted" | "declined" | null>(null);
let optimisticContractStatus = $state<"signed" | null>(null);
let optimisticSignedAt = $state<number | null>(null);

// Clear the override whenever the load function produces a new document
// (e.g. after `invalidateAll()` runs). Without this, stale optimistic fields
// would keep overriding authoritative server state.
$effect(() => {
	// Read data.document to register the dependency, then reset override.
	data.document;
	optimisticQuoteStatus = null;
	optimisticContractStatus = null;
	optimisticSignedAt = null;
});

let actionLoading = $state(false);
let actionResult = $state<"success" | "error" | null>(null);
let actionMessage = $state("");

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
			optimisticQuoteStatus = "accepted";
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
			optimisticQuoteStatus = "declined";
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

async function signContract(signerName: string) {
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
			optimisticContractStatus = "signed";
			optimisticSignedAt = Date.now();
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

async function payInvoice() {
	actionLoading = true;
	actionResult = null;
	try {
		const res = await fetch("/api/invoice/checkout", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ token: data.token }),
		});
		const result = await res.json().catch(() => ({}));
		if (res.ok && typeof result.url === "string") {
			window.location.href = result.url;
			return;
		}
		actionResult = "error";
		actionMessage = result.message || "something went wrong. please try again.";
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
			<QuoteDocument
				document={data.document}
				client={data.client}
				used={data.used}
				status={optimisticQuoteStatus ?? data.document.status}
				loading={actionLoading}
				onAccept={acceptQuote}
				onDecline={declineQuote}
			/>
		{:else if data.type === "invoice"}
			<InvoiceDocument
				document={data.document}
				client={data.client}
				status={data.document.status}
				loading={actionLoading}
				onPay={payInvoice}
			/>
		{:else if data.type === "contract"}
			<ContractDocument
				document={data.document}
				client={data.client}
				used={data.used}
				status={optimisticContractStatus ?? data.document.status}
				signedAt={optimisticSignedAt ?? data.document.signedAt}
				loading={actionLoading}
				onSign={signContract}
			/>
		{/if}
	</main>

	<footer class="portal-footer">
		<span>Powered by Angels Rest</span>
	</footer>
</div>

<style>
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

	.portal :global(.doc-header) {
		padding: 32px 36px;
		border-bottom: 1px solid #f0f0f0;
	}

	.portal :global(.doc-type) {
		font-size: 0.8rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: #4f46e5;
		margin-bottom: 4px;
	}

	.portal :global(.doc-number) {
		font-family: "Chillax", system-ui, sans-serif;
		font-size: 1.5rem;
		font-weight: 600;
		margin: 0 0 20px;
		color: #1a1a1a;
	}

	.portal :global(.doc-meta) {
		display: grid;
		gap: 10px;
	}

	.portal :global(.meta-row) {
		display: flex;
		gap: 12px;
		align-items: baseline;
	}

	.portal :global(.meta-label) {
		font-size: 0.825rem;
		color: #6b7280;
		min-width: 100px;
	}

	.portal :global(.meta-value) {
		font-size: 0.925rem;
		color: #1a1a1a;
		font-weight: 450;
	}

	.portal :global(.status-badge) {
		display: inline-block;
		padding: 2px 10px;
		border-radius: 99px;
		font-size: 0.8rem;
		font-weight: 500;
	}

	.portal :global(.status-draft) {
		background: #f3f4f6;
		color: #6b7280;
	}

	.portal :global(.status-sent) {
		background: #fef3c7;
		color: #92400e;
	}

	.portal :global(.status-accepted),
	.portal :global(.status-signed),
	.portal :global(.status-paid) {
		background: #d1fae5;
		color: #065f46;
	}

	.portal :global(.status-declined),
	.portal :global(.status-expired),
	.portal :global(.status-overdue),
	.portal :global(.status-canceled) {
		background: #fee2e2;
		color: #991b1b;
	}

	.portal :global(.doc-body) {
		padding: 28px 36px;
	}

	/* Quote packages */
	.portal :global(.package-card) {
		border: 1px solid #e5e7eb;
		border-radius: 8px;
		padding: 20px;
		margin-bottom: 16px;
	}

	.portal :global(.package-header) {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 8px;
	}

	.portal :global(.package-name) {
		font-family: "Chillax", system-ui, sans-serif;
		font-size: 1.05rem;
		font-weight: 500;
		margin: 0;
		color: #1a1a1a;
	}

	.portal :global(.package-price) {
		font-size: 1.1rem;
		font-weight: 600;
		color: #4f46e5;
	}

	.portal :global(.package-desc) {
		font-size: 0.9rem;
		color: #6b7280;
		margin: 0 0 12px;
		line-height: 1.5;
	}

	.portal :global(.package-included) {
		list-style: none;
		padding: 0;
		margin: 0;
	}

	.portal :global(.package-included li) {
		font-size: 0.875rem;
		color: #374151;
		padding: 4px 0 4px 20px;
		position: relative;
	}

	.portal :global(.package-included li::before) {
		content: "\2713";
		position: absolute;
		left: 0;
		color: #10b981;
		font-weight: 600;
	}

	/* Invoice line items */
	.portal :global(.line-items) {
		width: 100%;
		border-collapse: collapse;
		margin-bottom: 20px;
	}

	.portal :global(.line-items th) {
		text-align: left;
		font-size: 0.8rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: #6b7280;
		padding: 8px 12px;
		border-bottom: 2px solid #e5e7eb;
	}

	.portal :global(.th-qty),
	.portal :global(.th-price),
	.portal :global(.th-total) {
		text-align: right;
	}

	.portal :global(.line-items td) {
		padding: 12px;
		font-size: 0.925rem;
		border-bottom: 1px solid #f3f4f6;
	}

	.portal :global(.td-center) {
		text-align: center;
	}

	.portal :global(.td-right) {
		text-align: right;
	}

	.portal :global(.invoice-totals) {
		border-top: 1px solid #e5e7eb;
		padding-top: 16px;
	}

	.portal :global(.subtotal-row) {
		display: flex;
		justify-content: space-between;
		padding: 6px 12px;
		font-size: 0.9rem;
		color: #6b7280;
	}

	.portal :global(.total-row) {
		display: flex;
		justify-content: space-between;
		padding: 12px;
		margin-top: 8px;
		border-top: 1px solid #e5e7eb;
	}

	.portal :global(.total-label) {
		font-family: "Chillax", system-ui, sans-serif;
		font-weight: 600;
		font-size: 1.05rem;
	}

	.portal :global(.total-amount) {
		font-weight: 700;
		font-size: 1.15rem;
		color: #1a1a1a;
	}

	/* Contract body */
	.portal :global(.contract-body) {
		font-size: 0.925rem;
		line-height: 1.7;
		color: #374151;
		white-space: pre-wrap;
	}

	.portal :global(.pricing-section) {
		margin-top: 24px;
		padding-top: 16px;
		border-top: 1px solid #e5e7eb;
	}

	.portal :global(.pricing-row) {
		display: flex;
		justify-content: space-between;
		padding: 8px 0;
		font-size: 0.95rem;
	}

	.portal :global(.pricing-row span:last-child) {
		font-weight: 600;
	}

	/* Notes */
	.portal :global(.notes-section) {
		margin-top: 24px;
		padding-top: 16px;
		border-top: 1px solid #f0f0f0;
	}

	.portal :global(.notes-heading) {
		font-family: "Chillax", system-ui, sans-serif;
		font-size: 0.9rem;
		font-weight: 500;
		color: #6b7280;
		margin: 0 0 8px;
	}

	.portal :global(.notes-text) {
		font-size: 0.9rem;
		color: #6b7280;
		line-height: 1.5;
		margin: 0;
	}

	/* Actions */
	.portal :global(.doc-actions) {
		padding: 24px 36px;
		border-top: 1px solid #f0f0f0;
		display: flex;
		gap: 12px;
		justify-content: flex-end;
	}

	.portal :global(.btn-primary) {
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

	.portal :global(.btn-primary:hover:not(:disabled)) {
		background: #4338ca;
	}

	.portal :global(.btn-primary:disabled) {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.portal :global(.btn-secondary) {
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

	.portal :global(.btn-secondary:hover:not(:disabled)) {
		border-color: #9ca3af;
	}

	.portal :global(.btn-secondary:disabled) {
		opacity: 0.6;
		cursor: not-allowed;
	}

	/* Signature */
	.portal :global(.signature-section) {
		padding: 28px 36px;
		border-top: 1px solid #f0f0f0;
		background: #fafafa;
	}

	.portal :global(.sig-heading) {
		font-family: "Chillax", system-ui, sans-serif;
		font-size: 1rem;
		font-weight: 500;
		margin: 0 0 16px;
		color: #1a1a1a;
	}

	.portal :global(.sig-field) {
		margin-bottom: 16px;
	}

	.portal :global(.sig-field label) {
		display: block;
		font-size: 0.825rem;
		color: #6b7280;
		margin-bottom: 6px;
	}

	.portal :global(.sig-field input) {
		width: 100%;
		padding: 10px 14px;
		border: 1px solid #d1d5db;
		border-radius: 8px;
		font-size: 0.925rem;
		font-family: "Synonym", system-ui, sans-serif;
		background: #fff;
		box-sizing: border-box;
	}

	.portal :global(.sig-field input:focus) {
		outline: none;
		border-color: #4f46e5;
		box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.1);
	}

	/* Status messages */
	.portal :global(.status-message) {
		padding: 20px 36px;
		border-top: 1px solid #f0f0f0;
		text-align: center;
		font-size: 0.925rem;
		color: #6b7280;
	}

	.portal :global(.success-message) {
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

		.portal :global(.doc-header),
		.portal :global(.doc-body),
		.portal :global(.doc-actions),
		.portal :global(.signature-section) {
			padding-left: 20px;
			padding-right: 20px;
		}

		.portal :global(.doc-number) {
			font-size: 1.25rem;
		}

		.portal :global(.meta-row) {
			flex-direction: column;
			gap: 2px;
		}

		.portal :global(.meta-label) {
			min-width: 0;
		}

		.portal :global(.doc-actions) {
			flex-direction: column;
		}

		.portal :global(.line-items th),
		.portal :global(.line-items td) {
			padding: 8px 6px;
			font-size: 0.85rem;
		}
	}
</style>
