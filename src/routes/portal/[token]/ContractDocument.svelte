<script lang="ts">
import type { Doc } from "$convex/dataModel";
import { formatCents, formatDate, formatTimestamp } from "$lib/utils/format";

type Props = {
	document: Doc<"contracts">;
	client: { name: string } | null;
	used: boolean;
	status: Doc<"contracts">["status"];
	signedAt: number | undefined;
	loading: boolean;
	onSign: (signerName: string) => void;
};

let { document: doc, client, used, status, signedAt, loading, onSign }: Props = $props();
let signerName = $state("");
</script>

<div class="doc-header">
	<div class="doc-type">Contract</div>
	<h1 class="doc-number">{doc.title}</h1>
	<div class="doc-meta">
		{#if client}<div class="meta-row"><span class="meta-label">Prepared for</span><span class="meta-value">{client.name}</span></div>{/if}
		<div class="meta-row"><span class="meta-label">Date</span><span class="meta-value">{formatTimestamp(doc._creationTime)}</span></div>
		{#if doc.eventDate}<div class="meta-row"><span class="meta-label">Event date</span><span class="meta-value">{formatDate(doc.eventDate)}</span></div>{/if}
		{#if doc.eventLocation}<div class="meta-row"><span class="meta-label">Location</span><span class="meta-value">{doc.eventLocation}</span></div>{/if}
		<div class="meta-row"><span class="meta-label">Status</span><span class="meta-value status-badge status-{status}">{status}</span></div>
	</div>
</div>

<div class="doc-body">
	<div class="contract-body">{doc.body}</div>
	{#if doc.totalPrice || doc.depositAmount}
		<div class="pricing-section">
			{#if doc.totalPrice}<div class="pricing-row"><span>Total Price</span><span>{formatCents(doc.totalPrice)}</span></div>{/if}
			{#if doc.depositAmount}<div class="pricing-row"><span>Deposit Required</span><span>{formatCents(doc.depositAmount)}</span></div>{/if}
		</div>
	{/if}
</div>

{#if status === "sent" && !used}
	<div class="signature-section">
		<h3 class="sig-heading">Sign this contract</h3>
		<div class="sig-field"><label for="signer-name">Your full name</label><input id="signer-name" type="text" bind:value={signerName} placeholder="Enter your full name" /></div>
		<button class="btn-primary" onclick={() => onSign(signerName)} disabled={loading || !signerName.trim()}>{loading ? "Signing..." : "Sign Contract"}</button>
	</div>
{:else if status === "signed"}
	<div class="status-message success-message">This contract was signed{#if signedAt} on {formatTimestamp(signedAt)}{/if}.</div>
{/if}
