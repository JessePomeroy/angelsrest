<script lang="ts">
import type { Doc } from "$convex/dataModel";
import { formatCents, formatDate, formatTimestamp } from "$lib/utils/format";
import { getInvoiceSubtotal, getInvoiceTotal } from "./portalPageData";

type Props = {
	document: Doc<"invoices">;
	client: { name: string } | null;
	status: Doc<"invoices">["status"];
	loading: boolean;
	onPay: () => void;
};

let { document: doc, client, status, loading, onPay }: Props = $props();
</script>

<div class="doc-header">
	<div class="doc-type">Invoice</div>
	<h1 class="doc-number">{doc.invoiceNumber}</h1>
	<div class="doc-meta">
		{#if client}<div class="meta-row"><span class="meta-label">Bill to</span><span class="meta-value">{client.name}</span></div>{/if}
		<div class="meta-row"><span class="meta-label">Date</span><span class="meta-value">{formatTimestamp(doc._creationTime)}</span></div>
		{#if doc.dueDate}<div class="meta-row"><span class="meta-label">Due date</span><span class="meta-value">{formatDate(doc.dueDate)}</span></div>{/if}
		<div class="meta-row"><span class="meta-label">Status</span><span class="meta-value status-badge status-{status}">{status}</span></div>
	</div>
</div>

<div class="doc-body">
	<table class="line-items">
		<thead><tr><th scope="col" class="th-desc">Description</th><th scope="col" class="th-qty">Qty</th><th scope="col" class="th-price">Unit Price</th><th scope="col" class="th-total">Total</th></tr></thead>
		<tbody>{#each doc.items as item, i (i)}<tr><td>{item.description}</td><td class="td-center">{item.quantity}</td><td class="td-right">{formatCents(item.unitPrice)}</td><td class="td-right">{formatCents(item.quantity * item.unitPrice)}</td></tr>{/each}</tbody>
	</table>
	<div class="invoice-totals">
		<div class="subtotal-row"><span>Subtotal</span><span>{formatCents(getInvoiceSubtotal(doc.items))}</span></div>
		{#if doc.taxPercent}<div class="subtotal-row"><span>Tax ({doc.taxPercent}%)</span><span>{formatCents(getInvoiceSubtotal(doc.items) * (doc.taxPercent / 100))}</span></div>{/if}
		<div class="total-row"><span class="total-label">Total</span><span class="total-amount">{formatCents(getInvoiceTotal(doc.items, doc.taxPercent))}</span></div>
	</div>
	{#if doc.notes}<div class="notes-section"><h4 class="notes-heading">Notes</h4><p class="notes-text">{doc.notes}</p></div>{/if}
</div>

{#if status === "paid"}
	<div class="status-message success-message">This invoice has been paid. Thank you!</div>
{:else if status === "sent" || status === "overdue"}
	<div class="doc-actions"><button class="btn-primary" onclick={onPay} disabled={loading}>{loading ? "..." : "Pay Now"}</button></div>
{/if}
