<script lang="ts">
import type { Doc } from "$convex/dataModel";
import { formatCents, formatDate, formatTimestamp } from "$lib/utils/format";
import { getQuoteTotal } from "./portalPageData";

type Props = {
	document: Doc<"quotes">;
	client: { name: string } | null;
	used: boolean;
	status: Doc<"quotes">["status"];
	loading: boolean;
	onAccept: () => void;
	onDecline: () => void;
};

let { document: doc, client, used, status, loading, onAccept, onDecline }: Props = $props();
</script>

<div class="doc-header">
	<div class="doc-type">Quote</div>
	<h1 class="doc-number">{doc.quoteNumber}</h1>
	<div class="doc-meta">
		{#if client}<div class="meta-row"><span class="meta-label">Prepared for</span><span class="meta-value">{client.name}</span></div>{/if}
		<div class="meta-row"><span class="meta-label">Date</span><span class="meta-value">{formatTimestamp(doc._creationTime)}</span></div>
		{#if doc.validUntil}<div class="meta-row"><span class="meta-label">Valid until</span><span class="meta-value">{formatDate(doc.validUntil)}</span></div>{/if}
		<div class="meta-row"><span class="meta-label">Status</span><span class="meta-value status-badge status-{status}">{status}</span></div>
	</div>
</div>

<div class="doc-body">
	{#each doc.packages as pkg, i (pkg.name ?? i)}
		<div class="package-card">
			<div class="package-header"><h3 class="package-name">{pkg.name}</h3><span class="package-price">{formatCents(pkg.price)}</span></div>
			{#if pkg.description}<p class="package-desc">{pkg.description}</p>{/if}
			{#if pkg.included?.length}<ul class="package-included">{#each pkg.included as item (item)}<li>{item}</li>{/each}</ul>{/if}
		</div>
	{/each}
	<div class="total-row"><span class="total-label">Total</span><span class="total-amount">{formatCents(getQuoteTotal(doc.packages))}</span></div>
	{#if doc.notes}<div class="notes-section"><h4 class="notes-heading">Notes</h4><p class="notes-text">{doc.notes}</p></div>{/if}
</div>

{#if status === "sent" && !used}
	<div class="doc-actions">
		<button class="btn-secondary" onclick={onDecline} disabled={loading}>{loading ? "..." : "Decline Quote"}</button>
		<button class="btn-primary" onclick={onAccept} disabled={loading}>{loading ? "..." : "Accept Quote"}</button>
	</div>
{:else if status === "accepted"}
	<div class="status-message success-message">This quote has been accepted.</div>
{:else if status === "declined"}
	<div class="status-message">This quote has been declined.</div>
{/if}
